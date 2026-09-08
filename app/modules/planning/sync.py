"""Owner-scoped connection and device bridge services.

The scheduler owns provider I/O. HTTP sync requests only enqueue durable work.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import secrets
import uuid
from datetime import timedelta
from urllib.parse import urlencode

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError

from app.core.database import utcnow
from app.core.errors import AppError
from app.modules.planning.providers.base import ProviderError, default_provider_factory
from app.modules.planning.sync_models import (
    AppleInboundBatch, AppleOutboundChange, CalendarConnection, CalendarOAuthState,
    CalendarSyncCursor, CalendarSyncJobRecord, ExternalEventLink,
)
from app.modules.planning.sync_schemas import CalendarSyncJobResponse


def encrypt_credentials(settings, credentials):
    if not settings.encryption_key:
        raise AppError(503, "provider_unavailable", "Calendar encryption is not configured")
    return Fernet(settings.encryption_key.encode()).encrypt(json.dumps(credentials).encode()).decode()


def decrypt_credentials(settings, value):
    if not value:
        raise ProviderError("calendar_reauth_required", retryable=False, reauth=True)
    try:
        return json.loads(Fernet(settings.encryption_key.encode()).decrypt(value.encode()))
    except (InvalidToken, ValueError, TypeError) as exc:
        raise ProviderError("calendar_reauth_required", retryable=False, reauth=True) from exc


def provider_http_error(error):
    status = 503 if error.code == "provider_unavailable" else 401 if error.reauth else 502 if error.retryable else 400
    return AppError(status, error.code, "The calendar provider could not complete the request")


def job_response(job):
    return CalendarSyncJobResponse(job_id=job.id, status=job.status, accepted_at=job.accepted_at,
                                   phase=job.phase, available_at=job.available_at,
                                   push_completed_at=job.push_completed_at, error_code=job.error_code)


def enqueue_job(session, connection, now=None, *, conflict=True):
    now = now or utcnow()
    job_id = uuid.uuid4()
    result = session.execute(update(CalendarConnection).where(
        CalendarConnection.id == connection.id, CalendarConnection.active_job_id.is_(None),
        CalendarConnection.status == "active", CalendarConnection.sync_enabled.is_(True),
    ).values(active_job_id=job_id))
    if result.rowcount != 1:
        session.rollback()
        if conflict:
            raise AppError(409, "sync_running", "A sync is already running or the connection is unavailable")
        return None
    job = CalendarSyncJobRecord(id=job_id, connection_id=connection.id, accepted_at=now, available_at=now)
    session.add(job)
    session.commit()
    return job


class CalendarSyncService:
    def __init__(self, session, settings, provider_factory=None):
        self.session = session
        self.settings = settings
        self.provider_factory = provider_factory or default_provider_factory

    def _provider_call(self, provider, method, *args):
        adapter = self.provider_factory(provider, self.settings)
        try:
            return getattr(adapter, method)(*args)
        finally:
            if hasattr(adapter, "close"):
                adapter.close()

    def connection(self, user_id, connection_id, *, apple=False):
        connection = self.session.scalar(select(CalendarConnection).where(
            CalendarConnection.id == connection_id, CalendarConnection.user_id == user_id,
            CalendarConnection.status != "disconnected"))
        if not connection or (apple and connection.provider != "apple"):
            raise AppError(404, "connection_not_found", "Calendar connection not found")
        return connection

    def list_connections(self, user_id):
        return self.session.scalars(select(CalendarConnection).where(CalendarConnection.user_id == user_id,
               CalendarConnection.status != "disconnected").order_by(CalendarConnection.created_at)).all()

    def start(self, user_id, provider, body):
        if body.redirect_uri not in self.settings.calendar_redirect_uris:
            raise AppError(422, "invalid_redirect_uri", "Use a configured calendar redirect URI")
        existing = self.session.scalar(select(CalendarConnection).where(CalendarConnection.user_id == user_id,
                                      CalendarConnection.provider == provider))
        if existing and existing.status == "active":
            raise AppError(409, "already_connected", "This provider is already connected")
        if provider == "apple" and not body.device_id:
            raise AppError(422, "device_id_required", "Apple Calendar requires a device identifier")
        state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(64)
        expires = utcnow() + timedelta(minutes=10)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        if provider == "google":
            try:
                authorize_url = self._provider_call(provider, "authorize", state, body.redirect_uri, challenge)
            except ProviderError as exc:
                raise provider_http_error(exc) from exc
            encrypted_verifier = encrypt_credentials(self.settings, {"verifier": verifier})
        else:
            authorize_url = "lifehub://calendar/request-access?" + urlencode({"state": state})
            encrypted_verifier = None
        self.session.add(CalendarOAuthState(state_hash=hashlib.sha256(state.encode()).hexdigest(), user_id=user_id,
                         provider=provider, redirect_uri=body.redirect_uri, device_id=body.device_id,
                         encrypted_verifier=encrypted_verifier, expires_at=expires))
        self.session.commit()
        return {"authorize_url": authorize_url, "state": state, "expires_at": expires}

    def callback(self, user_id, provider, body):
        now = utcnow()
        state_hash = hashlib.sha256(body.state.encode()).hexdigest()
        state = self.session.get(CalendarOAuthState, state_hash)
        if not state or state.user_id != user_id or state.provider != provider or state.used_at or state.expires_at <= now:
            raise AppError(409, "invalid_calendar_state", "Calendar state is invalid, expired or already used")
        if provider == "google" and not body.code:
            raise AppError(422, "authorization_code_required", "Google authorization code is required")
        if provider == "apple" and (body.device_id != state.device_id or not body.calendar_id or not body.permission_granted):
            raise AppError(422, "device_permission_required", "Confirm calendar access on the initiating device")
        consumed = self.session.execute(update(CalendarOAuthState).where(CalendarOAuthState.state_hash == state_hash,
                            CalendarOAuthState.used_at.is_(None), CalendarOAuthState.expires_at > now).values(used_at=now))
        if consumed.rowcount != 1:
            self.session.rollback()
            raise AppError(409, "invalid_calendar_state", "Calendar state was already used")
        # Commit before exchanging a one-use code. A failed exchange requires a new start.
        self.session.commit()
        credentials = None
        if provider == "google":
            try:
                verifier = decrypt_credentials(self.settings, state.encrypted_verifier)["verifier"]
                account = self._provider_call(provider, "exchange", body.code, state.redirect_uri, verifier)
                calendar_id, label = account.calendar_id, account.account_label
                credentials = encrypt_credentials(self.settings, account.credentials)
            except ProviderError as exc:
                # Only our stable code: never log provider bodies, OAuth codes or credentials.
                logging.getLogger(__name__).warning("Calendar connection failed: %s", exc.code)
                raise provider_http_error(exc) from exc
        else:
            calendar_id, label = body.calendar_id, body.account_label or "Apple Calendar"
        connection = self.session.scalar(select(CalendarConnection).where(CalendarConnection.user_id == user_id,
                                          CalendarConnection.provider == provider).with_for_update())
        if connection and connection.status == "active":
            raise AppError(409, "already_connected", "This provider is already connected")
        if connection:
            # Preserve mappings on same-calendar reauthorization; changing accounts
            # keeps old imports as read-only historical copies, never exports them
            # into the newly selected account.
            from app.modules.planning.models import CalendarEvent
            if connection.calendar_id != calendar_id or (provider == "apple" and connection.device_id != body.device_id):
                self.session.execute(update(CalendarEvent).where(CalendarEvent.connection_id == connection.id)
                                     .values(connection_id=None, external_read_only=True,
                                             version=CalendarEvent.version + 1, updated_at=now))
                for model in (ExternalEventLink, CalendarSyncCursor, AppleOutboundChange, AppleInboundBatch):
                    self.session.execute(delete(model).where(model.connection_id == connection.id))
            connection.calendar_id, connection.account_label = calendar_id, label
            connection.encrypted_credentials, connection.device_id = credentials, body.device_id if provider == "apple" else None
            connection.status, connection.sync_enabled, connection.active_job_id = "active", True, None
            connection.next_sync_at = now
        else:
            connection = CalendarConnection(user_id=user_id, provider=provider, calendar_id=calendar_id,
                                            account_label=label, encrypted_credentials=credentials,
                                            device_id=body.device_id if provider == "apple" else None)
            self.session.add(connection)
        try:
            self.session.commit()
        except IntegrityError as exc:
            self.session.rollback()
            raise AppError(409, "calendar_account_conflict", "This provider has already been connected") from exc
        return connection

    def enqueue(self, user_id, connection_id):
        connection = self.connection(user_id, connection_id)
        if connection.status != "active":
            raise AppError(409, "calendar_reauth_required", "Reconnect this calendar before syncing")
        return enqueue_job(self.session, connection)

    def job(self, user_id, connection_id, job_id):
        self.connection(user_id, connection_id)
        job = self.session.scalar(select(CalendarSyncJobRecord).where(CalendarSyncJobRecord.id == job_id,
                                 CalendarSyncJobRecord.connection_id == connection_id))
        if not job:
            raise AppError(404, "sync_job_not_found", "Sync job not found")
        return job

    def disconnect(self, user_id, connection_id):
        connection = self.connection(user_id, connection_id)
        if connection.provider == "google" and connection.encrypted_credentials:
            try:
                self._provider_call("google", "revoke", decrypt_credentials(self.settings, connection.encrypted_credentials))
            except ProviderError:
                # Always honor local disconnection. No provider token remains usable here.
                pass
        self.session.execute(update(CalendarSyncJobRecord).where(CalendarSyncJobRecord.connection_id == connection.id,
                             CalendarSyncJobRecord.status.in_(["queued", "running"]))
                             .values(status="failed", error_code="connection_disconnected", completed_at=utcnow(), lease_owner=None, lease_until=None))
        connection.status, connection.sync_enabled, connection.encrypted_credentials = "disconnected", False, None
        connection.active_job_id = None
        self.session.commit()

    def _device(self, user_id, connection_id, device_id):
        connection = self.connection(user_id, connection_id, apple=True)
        if connection.device_id != device_id:
            raise AppError(403, "device_mismatch", "This connection belongs to a different device")
        if connection.status != "active":
            raise AppError(409, "calendar_reauth_required", "Reconnect this calendar")
        return connection

    def outbox(self, user_id, connection_id, device_id):
        connection = self._device(user_id, connection_id, device_id)
        job = self.session.get(CalendarSyncJobRecord, connection.active_job_id) if connection.active_job_id else None
        changes = []
        if job:
            changes = self.session.scalars(select(AppleOutboundChange).where(AppleOutboundChange.connection_id == connection.id,
                                           AppleOutboundChange.job_id == job.id, AppleOutboundChange.acknowledged_at.is_(None))
                                           .order_by(AppleOutboundChange.created_at, AppleOutboundChange.id).limit(501)).all()
        return {"job": job_response(job) if job else None, "calendar_id": connection.calendar_id,
                "changes": [{"operation_id": change.id, "event_id": change.event_id, "event_version": change.event_version,
                             "operation": change.operation, "external_id": change.external_id, "payload": change.payload} for change in changes[:500]],
                "more": len(changes) > 500,
                "pull_allowed_at": job.push_completed_at + timedelta(seconds=1) if job and job.push_completed_at else None}

    def acknowledge(self, user_id, connection_id, body):
        connection = self._device(user_id, connection_id, body.device_id)
        job = self.job(user_id, connection_id, body.job_id)
        now = utcnow()
        for ack in sorted(body.acknowledgements, key=lambda item: item.operation_id):
            change = self.session.scalar(select(AppleOutboundChange).where(AppleOutboundChange.id == ack.operation_id,
                                         AppleOutboundChange.connection_id == connection.id, AppleOutboundChange.job_id == job.id).with_for_update())
            if not change:
                raise AppError(404, "device_operation_not_found", "Device operation not found")
            if change.acknowledged_at:
                if change.external_id != ack.external_id:
                    raise AppError(409, "acknowledgement_conflict", "Operation was acknowledged with another event identifier")
                continue
            if connection.active_job_id != job.id or job.status not in ("queued", "running"):
                raise AppError(409, "sync_not_active", "The device sync job is no longer active")
            link = self.session.scalar(select(ExternalEventLink).where(ExternalEventLink.connection_id == connection.id,
                                       ExternalEventLink.event_id == change.event_id).with_for_update())
            if link is None:
                link = ExternalEventLink(connection_id=connection.id, event_id=change.event_id, external_id=ack.external_id)
                self.session.add(link)
            link.external_id, link.etag = ack.external_id, ack.etag
            link.synced_version, link.fingerprint = change.event_version, change.fingerprint
            link.remote_exists = change.operation != "delete"
            change.acknowledged_at, change.external_id = now, ack.external_id
        try:
            self.session.commit()
        except IntegrityError as exc:
            self.session.rollback()
            raise AppError(409, "external_id_conflict", "An external event is already mapped to another local event") from exc
        # The worker records completion only after all operations have been acknowledged.
        return {"accepted": True}

    def receive_deltas(self, user_id, connection_id, body):
        connection = self._device(user_id, connection_id, body.device_id)
        job = self.job(user_id, connection_id, body.job_id)
        self.session.refresh(job, with_for_update=True)
        payload = [change.model_dump(mode="json") for change in body.changes]
        previous = self.session.scalar(select(AppleInboundBatch).where(AppleInboundBatch.connection_id == connection.id,
                                       AppleInboundBatch.batch_id == body.batch_id))
        if previous:
            if previous.job_id != job.id or previous.payload != payload or previous.cursor != body.cursor or previous.final != body.final:
                raise AppError(409, "idempotency_conflict", "Batch identifier was reused with different data")
            return {"accepted": True}
        if connection.active_job_id != job.id or job.status not in ("queued", "running") or job.phase != "pull":
            raise AppError(409, "push_not_completed", "Wait until the outbound phase is completed")
        if not job.push_completed_at or utcnow() < job.push_completed_at + timedelta(seconds=1):
            raise AppError(409, "pull_not_ready", "Pull starts at least one second after the outbound phase")
        if self.session.scalar(select(AppleInboundBatch.id).where(AppleInboundBatch.job_id == job.id, AppleInboundBatch.final.is_(True))):
            raise AppError(409, "batch_stream_closed", "The final delta batch has already been received")
        self.session.add(AppleInboundBatch(connection_id=connection.id, job_id=job.id, batch_id=body.batch_id,
                                          payload=payload, cursor=body.cursor, final=body.final))
        try:
            self.session.commit()
        except IntegrityError as exc:
            self.session.rollback()
            # Retry through the normal idempotency check after a concurrent insertion.
            return self.receive_deltas(user_id, connection_id, body)
        return {"accepted": True}
