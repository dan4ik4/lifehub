"""Durable push -> (at least one second) -> pull calendar state machine."""
from __future__ import annotations

import uuid
from datetime import timedelta

from sqlalchemy import delete, or_, select, update

from app.core.database import utcnow
from app.core.errors import AppError
from app.modules.planning.providers.base import ProviderError, default_provider_factory, fingerprint
from app.modules.planning.sync import decrypt_credentials, encrypt_credentials, enqueue_job
from app.modules.planning.sync_models import (
    AppleInboundBatch, AppleOutboundChange, CalendarConnection, CalendarSyncCursor,
    CalendarSyncJobRecord, ExternalEventLink,
)
from app.modules.planning.sync_schemas import NormalizedEvent


class LostLease(Exception):
    pass


def _entitled(session, connection, now):
    from app.modules.auth.models import User
    user = session.get(User, connection.user_id)
    return bool(user and not user.deleted_at and (user.plan == "pro" or
                (user.plan == "trial" and user.trial_ends and user.trial_ends > now)))


def schedule_due_connections(session, settings, now=None):
    now = now or utcnow()
    connections = session.scalars(select(CalendarConnection).where(
        CalendarConnection.status == "active", CalendarConnection.sync_enabled.is_(True),
        CalendarConnection.active_job_id.is_(None), CalendarConnection.next_sync_at <= now).limit(100)).all()
    count = 0
    for connection in connections:
        if _entitled(session, connection, now) and enqueue_job(session, connection, now, conflict=False):
            count += 1
    return count


def claim_job(session, settings, now=None):
    """Compare-and-set claiming works across processes and on both supported DBs."""
    now = now or utcnow()
    eligible = or_(CalendarSyncJobRecord.status == "queued",
                   (CalendarSyncJobRecord.status == "running") & (CalendarSyncJobRecord.lease_until <= now))
    candidates = session.scalars(select(CalendarSyncJobRecord.id).where(eligible,
                                 CalendarSyncJobRecord.available_at <= now)
                                 .order_by(CalendarSyncJobRecord.available_at, CalendarSyncJobRecord.id).limit(20)).all()
    for job_id in candidates:
        owner = uuid.uuid4().hex
        result = session.execute(update(CalendarSyncJobRecord).where(CalendarSyncJobRecord.id == job_id, eligible,
                                 CalendarSyncJobRecord.available_at <= now).values(
                                 status="running", lease_owner=owner,
                                 lease_until=now + timedelta(seconds=getattr(settings, "calendar_sync_lease_seconds", 120))))
        session.commit()
        if result.rowcount == 1:
            return job_id, owner
    return None


class CalendarSyncJob:
    def __init__(self, session, settings, job_id, lease_owner, provider_factory=None, now=None):
        self.session, self.settings = session, settings
        self.job_id, self.owner = job_id, lease_owner
        self.clock = (lambda: now) if now is not None else utcnow
        self.provider_factory = provider_factory or default_provider_factory
        self.adapter = None

    def heartbeat(self):
        now = self.clock()
        result = self.session.execute(update(CalendarSyncJobRecord).where(CalendarSyncJobRecord.id == self.job_id,
                                      CalendarSyncJobRecord.lease_owner == self.owner,
                                      CalendarSyncJobRecord.status == "running").values(
                                      lease_until=now + timedelta(seconds=getattr(self.settings, "calendar_sync_lease_seconds", 120))))
        if result.rowcount != 1:
            self.session.rollback()
            raise LostLease()
        self.session.commit()

    def _transition(self, **values):
        result = self.session.execute(update(CalendarSyncJobRecord).where(CalendarSyncJobRecord.id == self.job_id,
                                      CalendarSyncJobRecord.lease_owner == self.owner,
                                      CalendarSyncJobRecord.status == "running").values(**values, lease_owner=None, lease_until=None))
        if result.rowcount != 1:
            self.session.rollback()
            raise LostLease()
        self.session.commit()

    def _credentials_saved(self, connection, credentials):
        result = self.session.execute(update(CalendarConnection).where(CalendarConnection.id == connection.id,
                                      CalendarConnection.active_job_id == self.job_id,
                                      CalendarConnection.status == "active").values(
                                      encrypted_credentials=encrypt_credentials(self.settings, credentials)))
        if result.rowcount != 1:
            self.session.rollback()
            raise LostLease()

    def run(self):
        try:
            self.heartbeat()
            job = self.session.get(CalendarSyncJobRecord, self.job_id)
            connection = self.session.get(CalendarConnection, job.connection_id)
            if not connection or connection.status != "active" or not connection.sync_enabled or connection.active_job_id != job.id:
                raise ProviderError("connection_unavailable", retryable=False)
            if not _entitled(self.session, connection, self.clock()):
                raise ProviderError("pro_required", retryable=False)
            if connection.provider == "google":
                self.adapter = self.provider_factory("google", self.settings)
                credentials = decrypt_credentials(self.settings, connection.encrypted_credentials)
                if job.phase == "push":
                    self._google_push(connection, credentials)
                    self._push_completed()
                elif job.phase == "pull":
                    if not job.push_completed_at or self.clock() < job.push_completed_at + timedelta(seconds=1):
                        self._transition(status="queued", available_at=(job.push_completed_at or self.clock()) + timedelta(seconds=1))
                        return "waiting"
                    self._google_pull(connection, credentials)
                    self._done(connection)
            elif connection.provider == "apple":
                if job.phase == "push":
                    self._apple_push(connection)
                elif job.phase == "wait_device":
                    pending = self.session.scalar(select(AppleOutboundChange.id).where(AppleOutboundChange.job_id == job.id,
                                                  AppleOutboundChange.acknowledged_at.is_(None)).limit(1))
                    if pending:
                        self._device_wait(job)
                    else:
                        self._push_completed()
                elif job.phase == "pull":
                    self._apple_pull(connection, job)
            return "processed"
        except LostLease:
            self.session.rollback()
            return "lease_lost"
        except ProviderError as exc:
            terminal = self._failed(exc)
            return "failed" if terminal else "retry"
        except Exception:
            # Do not put provider payloads, credentials or SQL values in the job error.
            self.session.rollback()
            terminal = self._failed(ProviderError("calendar_sync_error"))
            return "failed" if terminal else "retry"
        finally:
            if self.adapter and hasattr(self.adapter, "close"):
                self.adapter.close()

    def _device_wait(self, job):
        if self.clock() - job.accepted_at > timedelta(days=1):
            raise ProviderError("device_unavailable", retryable=False)
        self._transition(status="queued", available_at=self.clock() + timedelta(seconds=5))

    def _push_completed(self):
        now = self.clock()
        self._transition(status="queued", phase="pull", available_at=now + timedelta(seconds=1),
                         push_completed_at=now, attempts=0, error_code=None)

    def _done(self, connection):
        now = self.clock()
        self.session.execute(update(CalendarConnection).where(CalendarConnection.id == connection.id,
                             CalendarConnection.active_job_id == self.job_id)
                             .values(active_job_id=None, last_synced_at=now,
                                     next_sync_at=now + timedelta(seconds=self.settings.calendar_sync_interval_seconds)))
        self._transition(status="done", completed_at=now, error_code=None)

    def _failed(self, error):
        self.session.rollback()
        job = self.session.get(CalendarSyncJobRecord, self.job_id)
        if not job or job.lease_owner != self.owner or job.status != "running":
            return
        attempts = job.attempts + 1
        terminal = not error.retryable or attempts >= 5
        now = self.clock()
        if terminal:
            values = {"active_job_id": None, "next_sync_at": now + timedelta(seconds=self.settings.calendar_sync_interval_seconds)}
            if error.reauth:
                values["status"] = "reauth_required"
            self.session.execute(update(CalendarConnection).where(CalendarConnection.id == job.connection_id,
                                 CalendarConnection.active_job_id == job.id).values(**values))
        self._transition(status="failed" if terminal else "queued", attempts=attempts, error_code=error.code,
                         completed_at=now if terminal else None,
                         available_at=now + timedelta(seconds=min(300, 2 ** attempts)))
        return terminal

    def _events(self, connection):
        from app.modules.planning.models import CalendarEvent
        # Imported events only return to their source calendar. Local and AI events
        # are sent to every connected provider without creating cross-provider loops.
        return self.session.scalars(select(CalendarEvent).where(CalendarEvent.user_id == connection.user_id,
                                    CalendarEvent.external_read_only.is_(False), or_(
                                    CalendarEvent.connection_id == connection.id,
                                    (CalendarEvent.connection_id.is_(None)) & CalendarEvent.source.in_(["local", "ai"])))
                                    .order_by(CalendarEvent.id)).all()

    def _payload(self, event):
        from app.modules.planning.models import EventException
        exclusions = self.session.scalars(select(EventException.occurrence_at).where(EventException.event_id == event.id)
                                          .order_by(EventException.occurrence_at)).all()
        return {"event_id": str(event.id), "deleted": event.deleted_at is not None, "title": event.title,
                "notes": event.notes, "start_at": event.start_at.isoformat(), "end_at": event.end_at.isoformat(),
                "timezone": event.timezone, "all_day": event.all_day, "rrule": event.rrule,
                "excluded_occurrences": [value.isoformat() for value in exclusions]}

    def _link(self, connection, event):
        return self.session.scalar(select(ExternalEventLink).where(ExternalEventLink.connection_id == connection.id,
                                  ExternalEventLink.event_id == event.id))

    def _google_push(self, connection, credentials):
        for event in self._events(connection):
            self.heartbeat()
            self.session.refresh(event)
            link = self._link(connection, event)
            if link and link.synced_version == event.version:
                continue
            if not link and event.deleted_at:
                continue
            payload, version = self._payload(event), event.version
            if not link:
                # UUID hex is within Google's base32hex alphabet; stable before I/O.
                link = ExternalEventLink(connection_id=connection.id, event_id=event.id,
                                         external_id="1" + uuid.uuid5(connection.id, str(event.id)).hex)
                self.session.add(link)
                self.session.commit()
            try:
                pushed = self.adapter.push_change(credentials, connection.calendar_id, link.external_id,
                                                   payload, link.etag, link.remote_exists)
            except ProviderError as exc:
                if exc.code != "external_event_deleted" or payload["deleted"]:
                    raise
                # Google tombstones cannot be reused. Persist a deterministic new id
                # before restoring the pending local edit, so retries remain idempotent.
                self.heartbeat()
                link.external_id = "1" + uuid.uuid5(connection.id, f"{event.id}:restore:{version}").hex
                link.etag, link.remote_exists = None, False
                self.session.commit()
                pushed = self.adapter.push_change(credentials, connection.calendar_id, link.external_id,
                                                   payload, None, False)
            self.heartbeat()
            link.external_id, link.etag = pushed.external_id, pushed.etag
            link.synced_version, link.fingerprint, link.remote_exists = version, fingerprint(payload), not payload["deleted"]
            self._credentials_saved(connection, credentials)
            self.session.commit()

    def _google_pull(self, connection, credentials):
        cursor = self.session.get(CalendarSyncCursor, connection.id)
        result = self.adapter.pull_changes(credentials, connection.calendar_id, cursor.cursor if cursor else None, self.heartbeat)
        self.heartbeat()
        # Masters must exist before their recurring exceptions are applied.
        for change in sorted(result.changes, key=lambda item: item.recurring_parent_id is not None):
            self._apply_remote(connection, change)
        if result.full_sync:
            observed = {item.external_id for item in result.changes}
            for link in self.session.scalars(select(ExternalEventLink).where(ExternalEventLink.connection_id == connection.id)).all():
                if link.external_id not in observed and link.remote_exists:
                    self._apply_remote(connection, NormalizedEvent(external_id=link.external_id, deleted=True))
        if not cursor:
            cursor = CalendarSyncCursor(connection_id=connection.id)
            self.session.add(cursor)
        cursor.cursor = result.cursor
        self._credentials_saved(connection, credentials)
        self.session.commit()

    def _apply_remote(self, connection, change):
        from app.modules.planning.models import CalendarEvent, EventException
        if change.recurring_parent_id:
            parent_link = self.session.scalar(select(ExternalEventLink).where(ExternalEventLink.connection_id == connection.id,
                                              ExternalEventLink.external_id == change.recurring_parent_id))
            if parent_link:
                parent = self.session.get(CalendarEvent, parent_link.event_id)
                if parent and parent.version == parent_link.synced_version:
                    existing = self.session.scalar(select(EventException).where(EventException.event_id == parent.id,
                                                   EventException.occurrence_at == change.original_start_at))
                    if not existing:
                        self.session.add(EventException(event_id=parent.id, user_id=connection.user_id,
                                                        occurrence_at=change.original_start_at, kind="cancelled"))
                    # Bump the parent version for the local calendar view, but this
                    # provider's exception is already synchronized.
                    parent.updated_at = self.clock()
                    self.session.flush()
                    parent_link.synced_version = parent.version
                elif parent:
                    return  # A newer local series change wins the next push.
        link = self.session.scalar(select(ExternalEventLink).where(ExternalEventLink.connection_id == connection.id,
                                   ExternalEventLink.external_id == change.external_id))
        event = self.session.get(CalendarEvent, link.event_id) if link else None
        previous_reminder_target = event.start_at if event else None
        if event and event.user_id != connection.user_id:
            raise ProviderError("calendar_mapping_error", retryable=False)
        if event and event.version != link.synced_version:
            return  # User edited after the push snapshot. Preserve that edit.
        payload = change.model_dump(mode="json")
        digest = fingerprint(payload)
        if event and link.fingerprint == digest:
            link.etag, link.remote_exists = change.etag, not change.deleted
            return  # Ignore the echo of our own outbound write.
        if not event and change.deleted:
            return
        values = {"deleted_at": self.clock() if change.deleted else None, "updated_at": self.clock()}
        if not change.deleted:
            values.update(title=change.title, notes=change.notes, start_at=change.start_at, end_at=change.end_at,
                          timezone=change.timezone, all_day=change.all_day, rrule=change.rrule,
                          external_read_only=change.read_only)
        if event:
            expected = event.version
            result = self.session.execute(update(CalendarEvent).where(CalendarEvent.id == event.id,
                                          CalendarEvent.user_id == connection.user_id, CalendarEvent.version == expected)
                                          .values(**values, version=expected + 1))
            if result.rowcount != 1:
                return
            self.session.refresh(event)
        else:
            event = CalendarEvent(user_id=connection.user_id, source=connection.provider, connection_id=connection.id, **values)
            self.session.add(event)
            self.session.flush()
            link = ExternalEventLink(connection_id=connection.id, event_id=event.id, external_id=change.external_id)
            self.session.add(link)
        if not change.deleted:
            self.session.execute(delete(EventException).where(EventException.event_id == event.id))
            for occurrence in set(change.excluded_occurrences):
                self.session.add(EventException(event_id=event.id, user_id=connection.user_id, occurrence_at=occurrence, kind="cancelled"))
        link.etag, link.synced_version, link.fingerprint = change.etag, event.version, digest
        link.remote_exists = not change.deleted
        self.session.flush()
        from app.modules.planning.reminders import ReminderService
        ReminderService(self.session).replace("event", event, definitions=[] if change.deleted else None,
                                             rearm=previous_reminder_target is not None and previous_reminder_target != event.start_at)

    def _apple_push(self, connection):
        for event in self._events(connection):
            link = self._link(connection, event)
            if (link and link.synced_version == event.version) or (not link and event.deleted_at):
                continue
            previous = self.session.scalar(select(AppleOutboundChange).where(AppleOutboundChange.connection_id == connection.id,
                                           AppleOutboundChange.event_id == event.id, AppleOutboundChange.event_version == event.version))
            if previous:
                if not previous.acknowledged_at:
                    previous.job_id = self.job_id
                continue
            payload = self._payload(event)
            self.session.add(AppleOutboundChange(connection_id=connection.id, job_id=self.job_id,
                             event_id=event.id, event_version=event.version, operation="delete" if event.deleted_at else "upsert",
                             payload=payload, fingerprint=fingerprint(payload), external_id=link.external_id if link else None))
        self.session.flush()
        pending = self.session.scalar(select(AppleOutboundChange.id).where(AppleOutboundChange.job_id == self.job_id,
                                      AppleOutboundChange.acknowledged_at.is_(None)).limit(1))
        if pending:
            self._transition(status="queued", phase="wait_device", available_at=self.clock() + timedelta(seconds=1))
        else:
            self._push_completed()

    def _apple_pull(self, connection, job):
        if not job.push_completed_at or self.clock() < job.push_completed_at + timedelta(seconds=1):
            self._transition(status="queued", available_at=(job.push_completed_at or self.clock()) + timedelta(seconds=1))
            return
        batches = self.session.scalars(select(AppleInboundBatch).where(AppleInboundBatch.job_id == job.id,
                                      AppleInboundBatch.processed_at.is_(None)).order_by(AppleInboundBatch.id)).all()
        final = False
        for batch in batches:
            for payload in sorted(batch.payload, key=lambda item: bool(item.get("recurring_parent_id"))):
                self._apply_remote(connection, NormalizedEvent.model_validate(payload))
            batch.processed_at = self.clock()
            final = batch.final
            if final:
                cursor = self.session.get(CalendarSyncCursor, connection.id)
                if not cursor:
                    cursor = CalendarSyncCursor(connection_id=connection.id)
                    self.session.add(cursor)
                cursor.cursor = batch.cursor
        if final:
            self._done(connection)
        else:
            self._device_wait(job)


def run_calendar_sync(session_factory, settings, provider_factory=None, now=None, batch_size=20):
    counts = {"scheduled": 0, "processed": 0, "retry": 0, "failed": 0, "lease_lost": 0, "waiting": 0}
    with session_factory() as session:
        counts["scheduled"] = schedule_due_connections(session, settings, now)
    for _ in range(batch_size):
        with session_factory() as session:
            claimed = claim_job(session, settings, now)
        if not claimed:
            break
        with session_factory() as session:
            outcome = CalendarSyncJob(session, settings, *claimed, provider_factory=provider_factory, now=now).run()
            counts[outcome] += 1
    return counts
