"""Resume encrypted PDF proposals a section at a time without holding database locks during AI calls."""
import json
import logging
from datetime import timedelta

from sqlalchemy import or_, select

from app.core.database import utcnow
from app.core.errors import AppError
from app.core.security import decrypt_secret, encrypt_secret
from app.modules.finance.csv_import import finish_preview, locked_import_owner
from app.modules.finance.import_models import CsvImport
from app.modules.finance.pdf_import import PdfBlock, document_header, generate_pdf_mapping, map_section, normalize_pdf

log = logging.getLogger(__name__)
MAX_SECTIONS = 128


def run_pdf_section(session_factory, settings, provider=None):
    now = utcnow()
    lease = now + timedelta(minutes=3)
    with session_factory() as db:
        item = db.scalar(select(CsvImport).where(CsvImport.status == 'processing',
            CsvImport.pdf_payload.is_not(None), CsvImport.created_at >= now - timedelta(hours=24),
            or_(CsvImport.pdf_claim_until.is_(None), CsvImport.pdf_claim_until <= now))
            .order_by(CsvImport.created_at).limit(1).with_for_update(skip_locked=True))
        if item is None:
            return False
        item_id, user_id, encrypted = item.id, item.user_id, item.pdf_payload
        item.pdf_claim_until = lease
        db.commit()

    try:
        with session_factory() as db:
            locked_import_owner(db, user_id)
        payload = json.loads(decrypt_secret(encrypted, settings.encryption_key))
        lines, blocks = payload['lines'], payload['blocks']
        offset = blocks[-1]['last_line'] + 1 if blocks else 0
        sections = payload.get('sections', 0)
        if sections >= MAX_SECTIONS:
            raise AppError(422, 'pdf_content_too_large', 'Текст выписки превышает предел обработки PDF.')
        header = document_header(lines) if offset else ()
        mapped = map_section(lines, offset, provider or (lambda window: generate_pdf_mapping(settings, window, header=header)))
        blocks.extend(block.model_dump(mode='json') for block in mapped)
        with session_factory() as db:
            user = locked_import_owner(db, user_id)
            item = db.get(CsvImport, item_id, with_for_update=True)
            if not item or item.pdf_claim_until != lease or item.status != 'processing':
                return True
            if mapped[-1].last_line == len(lines) - 1:
                rows = normalize_pdf(lines, [PdfBlock.model_validate(block) for block in blocks], payload['currency'], user)
                finish_preview(item, rows)
            else:
                payload['sections'] = sections + 1
                item.pdf_payload = encrypt_secret(json.dumps(payload), settings.encryption_key)
                item.pdf_claim_until = None
            db.commit()
    except Exception as exc:
        with session_factory() as db:
            item = db.get(CsvImport, item_id, with_for_update=True)
            if item and item.pdf_claim_until == lease and item.status == 'processing':
                item.status = 'failed'
                item.result = {'error_code': exc.code if isinstance(exc, AppError) else 'model_error'}
                item.pdf_payload = None
                item.pdf_claim_until = None
                db.commit()
        if not isinstance(exc, AppError):
            log.warning('PDF section could not be processed')
    return True


def pdf_loop(session_factory, settings, stopped):
    while not stopped.is_set():
        try:
            if run_pdf_section(session_factory, settings):
                continue
        except Exception:
            log.warning('PDF worker tick failed; deferred previews will be retried')
        stopped.wait(settings.worker_poll_seconds)
