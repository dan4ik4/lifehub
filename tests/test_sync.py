from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from app.core.database import utcnow
from app.modules.planning.models import CalendarEvent
from app.modules.planning.providers.base import ProviderAccount, ProviderError, PullResult, PushResult
from app.modules.planning.sync import CalendarSyncService, encrypt_credentials
from app.modules.planning.sync_models import CalendarConnection, CalendarSyncJobRecord, ExternalEventLink
from app.modules.planning.sync_schemas import NormalizedEvent
from app.workers.jobs.calendar_sync import CalendarSyncJob, LostLease, claim_job, run_calendar_sync


class FakeGoogle:
    def __init__(self):
        self.remote = {}
        self.calls = []
        self.failures = 0

    def authorize(self, state, redirect_uri, challenge):
        return f"https://accounts.google.com/auth?state={state}&code_challenge={challenge}"

    def exchange(self, code, redirect_uri, verifier):
        assert verifier
        return ProviderAccount({"access_token": "SECRET", "refresh_token": "REFRESH"}, "primary", "Calendar account")

    def revoke(self, credentials):
        self.calls.append("revoke")

    def push_change(self, credentials, calendar_id, external_id, event, etag, exists):
        self.calls.append(("push", external_id, event.copy()))
        if self.failures:
            self.failures -= 1
            raise ProviderError("provider_unavailable")
        payload = {key: value for key, value in event.items() if key != "event_id"}
        self.remote[external_id] = NormalizedEvent(external_id=external_id, etag='"new"', **payload)
        return PushResult(external_id, '"new"')

    def pull_changes(self, credentials, calendar_id, cursor, heartbeat=None):
        self.calls.append(("pull", cursor))
        return PullResult(list(self.remote.values()), "cursor-next", full_sync=cursor is None)


@pytest.fixture
def google(app):
    provider = FakeGoogle()
    app.state.calendar_provider_factory = lambda *_: provider
    return provider


def create_connection(db, settings, user, provider="google"):
    connection = CalendarConnection(user_id=user.id, provider=provider, account_label="Test calendar", calendar_id="primary",
                                    encrypted_credentials=encrypt_credentials(settings, {"access_token": "SECRET"}) if provider == "google" else None,
                                    device_id="phone-1" if provider == "apple" else None)
    db.add(connection)
    db.commit()
    return connection


def create_event(db, user, **values):
    now = utcnow()
    event = CalendarEvent(user_id=user.id, title="Local appointment", start_at=now + timedelta(days=1),
                          end_at=now + timedelta(days=1, hours=1), timezone="UTC", **values)
    db.add(event)
    db.commit()
    return event


def tick(app, settings, google, at):
    return run_calendar_sync(app.state.session_factory, settings, lambda *_: google, now=at)


def test_push_then_pull_waits_one_second_and_does_not_echo(app, db, settings, make_user, google):
    user = make_user()
    connection = create_connection(db, settings, user)
    event = create_event(db, user)
    initial_version = event.version
    at = utcnow() + timedelta(seconds=1)
    tick(app, settings, google, at)
    db.expire_all()
    job = db.scalar(select(CalendarSyncJobRecord))
    assert job.phase == "pull" and job.status == "queued"
    assert job.push_completed_at == at
    assert job.available_at == at + timedelta(seconds=1)
    assert [call[0] for call in google.calls] == ["push"]
    tick(app, settings, google, at + timedelta(milliseconds=999))
    assert len(google.calls) == 1
    tick(app, settings, google, at + timedelta(seconds=1))
    db.expire_all()
    assert db.get(CalendarSyncJobRecord, job.id).status == "done"
    assert db.get(CalendarEvent, event.id).version == initial_version
    assert db.scalar(select(func.count()).select_from(CalendarEvent)) == 1
    assert db.get(CalendarConnection, connection.id).last_synced_at == at + timedelta(seconds=1)


def test_local_edit_between_phases_survives_external_pull(app, db, settings, make_user, google):
    user = make_user()
    connection = create_connection(db, settings, user)
    event = create_event(db, user)
    at = utcnow() + timedelta(seconds=1)
    tick(app, settings, google, at)
    db.expire_all()
    event.title = "Edited while syncing"
    db.commit()
    tick(app, settings, google, at + timedelta(seconds=1))
    db.expire_all()
    assert db.get(CalendarEvent, event.id).title == "Edited while syncing"
    CalendarSyncService(db, settings).enqueue(user.id, connection.id)
    tick(app, settings, google, at + timedelta(seconds=2))
    assert list(google.remote.values())[0].title == "Edited while syncing"


def test_remote_update_and_deletion_are_imported_once(app, db, settings, make_user, google):
    user = make_user()
    create_connection(db, settings, user)
    at = utcnow() + timedelta(seconds=1)
    google.remote["remote-1"] = NormalizedEvent(external_id="remote-1", title="External appointment", start_at=at,
                                               end_at=at + timedelta(hours=1), timezone="Europe/Warsaw")
    tick(app, settings, google, at)
    tick(app, settings, google, at + timedelta(seconds=1))
    imported = db.scalar(select(CalendarEvent))
    assert imported.source == "google"
    google.remote["remote-1"] = NormalizedEvent(external_id="remote-1", deleted=True)
    tick(app, settings, google, at + timedelta(seconds=302))
    tick(app, settings, google, at + timedelta(seconds=303))
    db.expire_all()
    assert db.get(CalendarEvent, imported.id).deleted_at is not None
    assert db.scalar(select(func.count()).select_from(CalendarEvent)) == 1


def test_failed_push_retries_same_external_id_before_pull(app, db, settings, make_user, google):
    user = make_user()
    create_connection(db, settings, user)
    create_event(db, user)
    google.failures = 1
    at = utcnow() + timedelta(seconds=1)
    tick(app, settings, google, at)
    job = db.scalar(select(CalendarSyncJobRecord))
    assert job.phase == "push" and job.status == "queued" and job.attempts == 1
    assert job.error_code == "provider_unavailable"
    tick(app, settings, google, at + timedelta(seconds=2))
    assert google.calls[0][1] == google.calls[1][1]
    assert [call[0] for call in google.calls] == ["push", "push"]


def test_atomic_claim_and_expired_lease_fencing(app, db, settings, make_user):
    connection = create_connection(db, settings, make_user())
    job = CalendarSyncService(db, settings).enqueue(connection.user_id, connection.id)
    at = utcnow() + timedelta(seconds=1)
    with app.state.session_factory() as first, app.state.session_factory() as second:
        claimed = claim_job(first, settings, at)
        assert claimed[0] == job.id
        assert claim_job(second, settings, at) is None
        replacement = claim_job(second, settings, at + timedelta(seconds=121))
        assert replacement[0] == job.id and replacement[1] != claimed[1]
        with pytest.raises(LostLease):
            CalendarSyncJob(first, settings, *claimed, now=at).heartbeat()


def test_connection_routes_are_pro_and_owner_scoped(client, db, settings, make_user, auth_headers):
    owner = make_user()
    connection = create_connection(db, settings, owner)
    other = make_user()
    free = make_user(plan="free")
    base = f"/api/v1/planning/calendar-connections/{connection.id}"
    assert client.get("/api/v1/planning/calendar-connections").status_code == 401
    assert client.get("/api/v1/planning/calendar-connections", headers=auth_headers(free)).status_code == 403
    assert client.post(base + "/sync", json={}, headers=auth_headers(other)).status_code == 404
    assert client.delete(base, headers=auth_headers(other)).status_code == 404
    response = client.get("/api/v1/planning/calendar-connections", headers=auth_headers(owner))
    assert response.status_code == 200
    assert "SECRET" not in response.text and "encrypted_credentials" not in response.text


def test_oauth_state_bound_single_use_and_redirect_allowlist(client, app, settings, make_user, auth_headers, google):
    owner, other = make_user(), make_user()
    base = "/api/v1/planning/calendar-connections/google"
    assert client.post(base + "/start", json={"redirect_uri": "https://evil.invalid/"}, headers=auth_headers(owner)).status_code == 422
    start = client.post(base + "/start", json={"redirect_uri": settings.calendar_redirect_uris[0]}, headers=auth_headers(owner))
    assert start.status_code == 200
    callback = {"state": start.json()["state"], "code": "one-use-code"}
    assert client.post(base + "/callback", json=callback, headers=auth_headers(other)).status_code == 409
    result = client.post(base + "/callback", json=callback, headers=auth_headers(owner))
    assert result.status_code == 201, result.text
    assert "SECRET" not in result.text and "REFRESH" not in result.text
    assert client.post(base + "/callback", json=callback, headers=auth_headers(owner)).status_code == 409


def test_apple_outbound_ack_then_pull_and_batch_idempotency(client, app, db, settings, make_user, auth_headers, google, monkeypatch):
    user = make_user()
    connection = create_connection(db, settings, user, provider="apple")
    event = create_event(db, user)
    headers = auth_headers(user)
    base = f"/api/v1/planning/calendar-connections/{connection.id}/device"
    at = utcnow() + timedelta(seconds=1)
    tick(app, settings, google, at)
    response = client.get(base + "/outbox", params={"device_id": "phone-1"}, headers=headers)
    assert response.status_code == 200, response.text
    outbox = response.json()
    assert outbox["job"]["phase"] == "wait_device"
    operation = outbox["changes"][0]
    assert operation["event_id"] == str(event.id)
    delta = {"device_id": "phone-1", "job_id": outbox["job"]["job_id"], "batch_id": str(uuid4()), "changes": [], "cursor": "device-cursor"}
    assert client.post(base + "/deltas", json=delta, headers=headers).status_code == 409
    assert client.get(base + "/outbox", params={"device_id": "other-phone"}, headers=headers).status_code == 403
    ack = {"device_id": "phone-1", "job_id": delta["job_id"], "acknowledgements": [{"operation_id": operation["operation_id"], "external_id": "ek-123"}]}
    assert client.post(base + "/ack", json=ack, headers=headers).status_code == 200
    assert client.post(base + "/ack", json=ack, headers=headers).status_code == 200
    tick(app, settings, google, at + timedelta(seconds=1))
    monkeypatch.setattr("app.modules.planning.sync.utcnow", lambda: at + timedelta(seconds=1, milliseconds=999))
    assert client.post(base + "/deltas", json=delta, headers=headers).status_code == 409
    monkeypatch.setattr("app.modules.planning.sync.utcnow", lambda: at + timedelta(seconds=2))
    assert client.post(base + "/deltas", json=delta, headers=headers).status_code == 202
    assert client.post(base + "/deltas", json=delta, headers=headers).status_code == 202
    tick(app, settings, google, at + timedelta(seconds=2))
    db.expire_all()
    job = db.get(CalendarSyncJobRecord, UUID(delta["job_id"]))
    assert job.status == "done"
    link = db.scalar(select(ExternalEventLink))
    assert link.external_id == "ek-123"


def test_scheduler_does_not_sync_expired_trial(app, db, settings, make_user, google):
    user = make_user(plan="trial", trial_ends=utcnow() - timedelta(seconds=1))
    create_connection(db, settings, user)
    counts = tick(app, settings, google, utcnow())
    assert counts["scheduled"] == 0
    assert google.calls == []


def test_edit_during_provider_push_preserves_new_local_version(app, db, settings, make_user, google):
    user = make_user()
    create_connection(db, settings, user)
    event = create_event(db, user)
    sent_version = event.version
    original_push = google.push_change

    def push_and_edit(*args):
        result = original_push(*args)
        with app.state.session_factory() as editing_session:
            current = editing_session.get(CalendarEvent, event.id)
            current.title = "Changed during network call"
            editing_session.commit()
        return result

    google.push_change = push_and_edit
    at = utcnow() + timedelta(seconds=1)
    tick(app, settings, google, at)
    db.expire_all()
    assert db.scalar(select(ExternalEventLink.synced_version)) == sent_version
    assert db.get(CalendarEvent, event.id).version == sent_version + 1
    tick(app, settings, google, at + timedelta(seconds=1))
    db.expire_all()
    assert db.get(CalendarEvent, event.id).title == "Changed during network call"


def test_worker_reauth_error_stops_job_and_requires_reconnection(app, db, settings, make_user, google):
    user = make_user()
    connection = create_connection(db, settings, user)
    create_event(db, user)

    def revoked_credentials(*args):
        raise ProviderError("calendar_reauth_required", retryable=False, reauth=True)

    google.push_change = revoked_credentials
    at = utcnow() + timedelta(seconds=1)
    counts = tick(app, settings, google, at)
    db.expire_all()
    assert counts["failed"] == 1
    job = db.scalar(select(CalendarSyncJobRecord))
    assert job.status == "failed" and job.error_code == "calendar_reauth_required"
    assert db.get(CalendarConnection, connection.id).status == "reauth_required"
    assert db.get(CalendarConnection, connection.id).active_job_id is None
    assert tick(app, settings, google, at + timedelta(hours=1))["scheduled"] == 0


def test_same_calendar_reauthorization_keeps_existing_mapping(client, app, db, settings, make_user, auth_headers, google):
    user = make_user()
    connection = create_connection(db, settings, user)
    event = create_event(db, user, source="google", connection_id=connection.id)
    link = ExternalEventLink(connection_id=connection.id, event_id=event.id, external_id="existing-google-id", synced_version=event.version)
    db.add(link)
    connection.status = "reauth_required"
    db.commit()
    base = "/api/v1/planning/calendar-connections/google"
    started = client.post(base + "/start", json={"redirect_uri": settings.calendar_redirect_uris[0]}, headers=auth_headers(user))
    assert started.status_code == 200
    result = client.post(base + "/callback", json={"state": started.json()["state"], "code": "new-code"}, headers=auth_headers(user))
    assert result.status_code == 201, result.text
    assert result.json()["id"] == str(connection.id)
    db.expire_all()
    assert db.get(CalendarConnection, connection.id).status == "active"
    assert db.get(ExternalEventLink, link.id).external_id == "existing-google-id"
    assert db.get(CalendarEvent, event.id).connection_id == connection.id


def test_inbound_moved_event_rearms_already_delivered_offset_reminder(app, db, settings, make_user, google):
    from app.modules.planning.models import Reminder

    user = make_user()
    connection = create_connection(db, settings, user)
    at = utcnow()
    event = CalendarEvent(user_id=user.id, title="Earlier meeting", source="google", connection_id=connection.id,
                          start_at=at - timedelta(hours=2), end_at=at - timedelta(hours=1), timezone="UTC")
    db.add(event)
    db.flush()
    db.add(ExternalEventLink(connection_id=connection.id, event_id=event.id, external_id="moved-event", synced_version=event.version))
    reminder = Reminder(user_id=user.id, entity_type="event", entity_id=event.id, offset_minutes=15,
                        channel="email", delivered_at=at - timedelta(hours=2, minutes=15))
    db.add(reminder)
    db.commit()
    google.remote["moved-event"] = NormalizedEvent(external_id="moved-event", title="Rescheduled meeting",
                                                  start_at=at + timedelta(days=1), end_at=at + timedelta(days=1, hours=1))
    tick(app, settings, google, at + timedelta(seconds=1))
    tick(app, settings, google, at + timedelta(seconds=2))
    db.expire_all()
    assert db.get(Reminder, reminder.id).delivered_at is None
    assert db.get(Reminder, reminder.id).next_trigger_at == at + timedelta(days=1, minutes=-15)


def test_remote_permission_only_change_updates_read_only_state(app, db, settings, make_user, google):
    user = make_user()
    create_connection(db, settings, user)
    at = utcnow() + timedelta(seconds=1)
    google.remote["permission-change"] = NormalizedEvent(external_id="permission-change", title="Invitation", start_at=at, end_at=at + timedelta(hours=1))
    tick(app, settings, google, at)
    tick(app, settings, google, at + timedelta(seconds=1))
    imported = db.scalar(select(CalendarEvent))
    assert not imported.external_read_only
    google.remote["permission-change"].read_only = True
    tick(app, settings, google, at + timedelta(seconds=302))
    tick(app, settings, google, at + timedelta(seconds=303))
    db.expire_all()
    assert db.get(CalendarEvent, imported.id).external_read_only


def test_retry_exhaustion_reports_terminal_worker_failure(app, db, settings, make_user, google):
    user = make_user()
    create_connection(db, settings, user)
    create_event(db, user)
    google.failures = 5
    at = utcnow() + timedelta(seconds=1)
    results = [tick(app, settings, google, at + timedelta(seconds=offset)) for offset in (0, 2, 6, 14, 30)]
    assert [result["retry"] for result in results] == [1, 1, 1, 1, 0]
    assert results[-1]["failed"] == 1
    db.expire_all()
    assert db.scalar(select(CalendarSyncJobRecord)).status == "failed"
