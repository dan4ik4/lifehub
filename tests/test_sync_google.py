from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from app.core.database import utcnow
from app.modules.planning.providers.google import GoogleCalendarAdapter
from app.modules.planning.providers.base import ProviderError


def credentials():
    return {"access_token": "access-secret", "refresh_token": "refresh-secret", "expires_at": (utcnow() + timedelta(hours=1)).isoformat()}


def payload():
    at = utcnow()
    return {"event_id": "event-1", "title": "Appointment", "notes": None, "start_at": at.isoformat(),
            "end_at": (at + timedelta(hours=1)).isoformat(), "timezone": "Europe/Warsaw", "all_day": False,
            "rrule": "FREQ=DAILY;COUNT=3", "excluded_occurrences": [(at + timedelta(days=1)).isoformat()], "deleted": False}


def test_google_authorization_uses_pkce(settings):
    adapter = GoogleCalendarAdapter(settings, client=httpx.Client(transport=httpx.MockTransport(lambda _: None)))
    query = parse_qs(urlparse(adapter.authorize("state", "https://client.example/callback", "challenge")).query)
    assert query["state"] == ["state"] and query["code_challenge_method"] == ["S256"]
    assert query["access_type"] == ["offline"]


def test_google_410_restarts_full_sync_and_paginates(settings):
    requests = []
    def respond(request):
        requests.append(request)
        if request.url.params.get("syncToken"):
            return httpx.Response(410)
        if request.url.params.get("pageToken") == "page-2":
            return httpx.Response(200, json={"items": [{"id": "deleted", "status": "cancelled"}], "nextSyncToken": "new-cursor"})
        return httpx.Response(200, json={"items": [], "nextPageToken": "page-2"})
    adapter = GoogleCalendarAdapter(settings, client=httpx.Client(transport=httpx.MockTransport(respond)))
    result = adapter.pull_changes(credentials(), "primary", "expired")
    assert result.full_sync and result.cursor == "new-cursor" and result.changes[0].deleted
    assert len(requests) == 3 and requests[2].url.params["pageToken"] == "page-2"
    assert "syncToken" not in requests[1].url.params


def test_google_refresh_and_local_first_etag_retry(settings):
    methods = []
    tokens = credentials()
    tokens["expires_at"] = utcnow().isoformat()
    def respond(request):
        methods.append(request.method)
        if request.url.path == "/token":
            assert b"refresh-secret" in request.content
            return httpx.Response(200, json={"access_token": "new-access", "expires_in": 3600})
        assert request.headers["Authorization"] == "Bearer new-access"
        if request.method == "GET":
            return httpx.Response(200, json={"id": "existing", "etag": '"remote-edit"'})
        if request.headers.get("If-Match") == '"old"':
            return httpx.Response(412)
        assert request.headers["If-Match"] == '"remote-edit"'
        return httpx.Response(200, json={"id": "existing", "etag": '"ours"'})
    adapter = GoogleCalendarAdapter(settings, client=httpx.Client(transport=httpx.MockTransport(respond)))
    result = adapter.push_change(tokens, "primary", "existing", payload(), '"old"', True)
    assert result.etag == '"ours"'
    assert methods == ["POST", "PATCH", "GET", "PATCH"]
    assert tokens["access_token"] == "new-access"


def test_google_repeated_insert_reuses_deterministic_event_id(settings):
    seen = []
    def respond(request):
        seen.append(request.method)
        if request.method == "POST":
            return httpx.Response(409)
        if request.method == "GET":
            return httpx.Response(200, json={"id": "stable", "etag": "etag", "extendedProperties": {"private": {"lifehubEventId": "event-1"}}})
        return httpx.Response(200, json={"id": "stable", "etag": "new-etag"})
    adapter = GoogleCalendarAdapter(settings, client=httpx.Client(transport=httpx.MockTransport(respond)))
    result = adapter.push_change(credentials(), "primary", "stable", payload(), None, False)
    assert result.external_id == "stable" and seen == ["POST", "GET", "PATCH"]


def test_all_day_dates_preserve_calendar_timezone_and_exclusions(settings):
    adapter = GoogleCalendarAdapter(settings, client=httpx.Client(transport=httpx.MockTransport(lambda _: None)))
    event = adapter._normalize({"id": "all-day", "start": {"date": "2026-09-05"}, "end": {"date": "2026-09-06"},
                                "recurrence": ["RRULE:FREQ=DAILY;COUNT=3", "EXDATE;VALUE=DATE:20260906"]}, "Europe/Warsaw")
    assert event.all_day and event.timezone == "Europe/Warsaw"
    assert event.start_at.isoformat() == "2026-09-04T22:00:00+00:00"
    assert event.excluded_occurrences[0].isoformat() == "2026-09-05T22:00:00+00:00"
    until_event = adapter._normalize({"id": "all-day-until", "start": {"date": "2026-09-05"}, "end": {"date": "2026-09-06"},
                                      "recurrence": ["RRULE:FREQ=DAILY;UNTIL=20260930"]}, "Europe/Warsaw")
    outgoing = adapter._event_body({**until_event.model_dump(mode="json"), "event_id": "local-all-day-id"})
    assert outgoing["recurrence"] == ["RRULE:FREQ=DAILY;UNTIL=20260930"]
    assert outgoing["start"] == {"date": "2026-09-05"}


def test_google_invalid_refresh_grant_requires_reauthorization(settings):
    tokens = credentials()
    tokens["expires_at"] = utcnow().isoformat()
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(400, json={"error": "invalid_grant", "error_description": "Token revoked"})

    adapter = GoogleCalendarAdapter(settings, client=httpx.Client(transport=httpx.MockTransport(respond)))
    with pytest.raises(ProviderError) as exc:
        adapter.pull_changes(tokens, "primary", None)
    assert exc.value.reauth and not exc.value.retryable
    assert exc.value.code == "calendar_reauth_required"
    assert len(requests) == 1 and requests[0].url.path == "/token"


def test_google_exchange_uses_pkce_and_selects_writable_primary_calendar(settings):
    requests = []

    def respond(request):
        requests.append(request)
        if request.url.path == "/token":
            form = parse_qs(request.content.decode())
            assert form["code_verifier"] == ["original-pkce-verifier"]
            assert form["grant_type"] == ["authorization_code"]
            return httpx.Response(200, json={"access_token": "oauth-access", "refresh_token": "oauth-refresh", "expires_in": 3600})
        assert request.url.path.endswith("/calendarList/primary")
        assert request.headers["Authorization"] == "Bearer oauth-access"
        return httpx.Response(200, json={"id": "person@example.com", "summary": "Personal", "timeZone": "Europe/Warsaw", "accessRole": "owner"})

    adapter = GoogleCalendarAdapter(settings, client=httpx.Client(transport=httpx.MockTransport(respond)))
    result = adapter.exchange("authorization-code", "https://client.example/callback", "original-pkce-verifier")
    assert result.calendar_id == "person@example.com"
    assert result.account_label == "Personal"
    assert result.credentials["calendar_timezone"] == "Europe/Warsaw"
    assert result.credentials["refresh_token"] == "oauth-refresh"
    assert len(requests) == 2


@pytest.mark.parametrize("error, expected", [
    ({"errors": [{"reason": "accessNotConfigured"}]}, "calendar_api_disabled"),
    ({"details": [{"reason": "SERVICE_DISABLED"}]}, "calendar_api_disabled"),
    ({"errors": [{"reason": "insufficientPermissions"}]}, "calendar_permissions_required"),
    ({"details": [{"reason": "ACCESS_TOKEN_SCOPE_INSUFFICIENT"}]}, "calendar_permissions_required"),
    ({"errors": [{"reason": "rateLimitExceeded"}]}, "provider_rate_limited"),
])
def test_exchange_preserves_calendar_failure_reason(settings, error, expected):
    requests = []
    def respond(request):
        requests.append(request)
        if request.url.path == "/token":
            return httpx.Response(200, json={"access_token": "private-access", "refresh_token": "private-refresh"})
        return httpx.Response(403, json={"error": error})
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        adapter = GoogleCalendarAdapter(settings, client=client)
        with pytest.raises(ProviderError) as exc:
            adapter.exchange("private-code", "https://client.example/callback", "verifier")
    assert exc.value.code == expected
    assert len(requests) == 2
    assert "private" not in str(exc.value)
    if expected == "calendar_api_disabled":
        assert not exc.value.reauth and not exc.value.retryable


@pytest.mark.parametrize("status", [400, 401])
def test_oauth_client_error_is_not_an_expired_user_session(settings, status):
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(status, json={"error": "invalid_client"}))) as client:
        adapter = GoogleCalendarAdapter(settings, client=client)
        with pytest.raises(ProviderError) as exc:
            adapter.exchange("one-use-code", "https://client.example/callback", "verifier")
    assert exc.value.code == "calendar_oauth_misconfigured"
    assert not exc.value.retryable and not exc.value.reauth
