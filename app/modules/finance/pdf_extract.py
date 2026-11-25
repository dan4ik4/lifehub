"""Short-lived PDF text worker. No files, network, JavaScript or attachments are opened."""
import io
import json
import re
import sys

MAX_BYTES = 25_000_000
MAX_ENCODED_BYTES = 4 * ((MAX_BYTES + 2) // 3)
MAX_REQUEST_BYTES = MAX_ENCODED_BYTES + 4096
MAX_PAGES = 100
MAX_CHARS = 450_000
MAX_LINES = 5000
MAX_LINE_CHARS = 12_000
MAX_OPERATIONS = 1500
MAX_CONFIRM_BYTES = 4_000_000


def extract(raw):
    from pypdf import PdfReader
    if len(raw) > MAX_BYTES:
        return {'error': 'pdf_too_large'}
    if not raw.startswith(b'%PDF-'):
        return {'error': 'invalid_pdf'}
    reader = PdfReader(io.BytesIO(raw), strict=False)
    if reader.is_encrypted:
        return {'error': 'pdf_encrypted'}
    if not reader.pages:
        return {'error': 'pdf_no_text'}
    if len(reader.pages) > MAX_PAGES:
        return {'error': 'pdf_too_many_pages'}
    lines, chars = [], 0
    for number, page in enumerate(reader.pages, 1):
        stream = page.get_contents()
        if stream is not None and len(stream.get_data()) > 10_000_000:
            return {'error': 'pdf_content_too_large'}
        text = page.extract_text(extraction_mode='layout', layout_mode_space_vertically=False) or ''
        values = [re.sub(r'[ \t]{2,}', '  ', line.strip()) for line in text.splitlines() if line.strip()]
        # Never silently drop an unreadable page from a multi-page statement.
        if not values or '\ufffd' in text or '\x00' in text:
            return {'error': 'pdf_no_text'}
        chars += sum(map(len, values))
        if chars > MAX_CHARS or len(lines) + len(values) > MAX_LINES or any(len(line) > MAX_LINE_CHARS for line in values):
            return {'error': 'pdf_content_too_large'}
        lines.extend({'page': number, 'text': value} for value in values)
    return {'lines': lines}


def main():
    # Production Linux: bound even compressed/object-stream bombs in a disposable worker.
    if sys.platform != 'win32':
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024**2, 512 * 1024**2))
        resource.setrlimit(resource.RLIMIT_CPU, (25, 25))
    try:
        result = extract(sys.stdin.buffer.read(MAX_BYTES + 1))
    except Exception:
        result = {'error': 'invalid_pdf'}
    sys.stdout.write(json.dumps(result, ensure_ascii=True))


if __name__ == '__main__':
    main()
