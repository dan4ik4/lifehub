"""Google Calendar API with PKCE, token refresh, ETags and incremental sync."""
from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
import re
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo

import httpx

from app.core.database import utcnow
from app.modules.planning.providers.base import ProviderAccount, ProviderError, PullResult, PushResult
from app.modules.planning.sync_schemas import NormalizedEvent

UTC = timezone.utc
API = "https://www.googleapis.com/calendar/v3"
TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPES = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly"


class GoogleCalendarAdapter:
    def __init__(self, settings, client=None):
        self.settings = settings
        self.client = client or httpx.Client(timeout=15.0, follow_redirects=False)
        self.owns_client = client is None

    def close(self):
        if self.owns_client:
            self.client.close()

    def _configured(self):
        if not self.settings.google_calendar_client_id or not self.settings.google_calendar_client_secret:
            raise ProviderError("provider_unavailable", retryable=False)

    def _http(self, method, url, **kwargs):
        try:
            return self.client.request(method, url, **kwargs)
        except httpx.HTTPError as exc:
            raise ProviderError("provider_unavailable") from exc

    @staticmethod
    def _json(response):
        try:
            value = response.json()
            if not isinstance(value, dict):
                raise ValueError()
            return value
        except (ValueError, TypeError) as exc:
            raise ProviderError("provider_invalid_response") from exc

    @staticmethod
    def _check(response):
        if response.status_code == 403:
            try:
                error = response.json().get("error", {})
                reasons = {item.get("reason") for item in error.get("errors", []) if isinstance(item, dict)}
                reasons.update(item.get("reason") for item in error.get("details", []) if isinstance(item, dict))
            except (ValueError, TypeError, AttributeError):
                reasons = set()
            if reasons & {"rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"}:
                raise ProviderError("provider_rate_limited")
            if reasons & {"accessNotConfigured", "SERVICE_DISABLED"}:
                raise ProviderError("calendar_api_disabled", retryable=False)
            if reasons & {"insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT"}:
                raise ProviderError("calendar_permissions_required", retryable=False, reauth=True)
        if response.status_code in (401, 403):
            raise ProviderError("calendar_reauth_required", retryable=False, reauth=True)
        if response.status_code >= 400:
            raise ProviderError("provider_error", retryable=response.status_code == 429 or response.status_code >= 500)

    @staticmethod
    def _check_oauth_client(response):
        if response.status_code in (400, 401):
            try:
                error = response.json().get("error")
            except (ValueError, AttributeError):
                error = None
            if error in ("invalid_client", "unauthorized_client"):
                raise ProviderError("calendar_oauth_misconfigured", retryable=False)

    def authorize(self, state, redirect_uri, challenge):
        self._configured()
        return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode({
            "client_id": self.settings.google_calendar_client_id, "redirect_uri": redirect_uri,
            "response_type": "code", "scope": SCOPES, "access_type": "offline", "prompt": "consent",
            "state": state, "code_challenge": challenge, "code_challenge_method": "S256",
        })

    def exchange(self, code, redirect_uri, verifier):
        self._configured()
        response = self._http("POST", TOKEN_URL, data={
            "client_id": self.settings.google_calendar_client_id,
            "client_secret": self.settings.google_calendar_client_secret,
            "code": code, "redirect_uri": redirect_uri, "code_verifier": verifier,
            "grant_type": "authorization_code",
        })
        self._check_oauth_client(response)
        if response.status_code == 400:
            raise ProviderError("invalid_authorization_code", retryable=False)
        self._check(response)
        data = self._json(response)
        if not data.get("access_token") or not data.get("refresh_token"):
            raise ProviderError("calendar_offline_access_required", retryable=False)
        credentials = self._tokens(data)
        calendar = self._request("GET", f"{API}/users/me/calendarList/primary", credentials)
        calendar_data = self._json(calendar)
        credentials["calendar_timezone"] = calendar_data.get("timeZone", "UTC")
        if calendar_data.get("accessRole") not in ("writer", "owner"):
            raise ProviderError("calendar_write_access_required", retryable=False)
        return ProviderAccount(credentials, calendar_data["id"], calendar_data.get("summaryOverride") or calendar_data.get("summary") or "Google Calendar")

    @staticmethod
    def _tokens(data):
        return {"access_token": data["access_token"], "refresh_token": data.get("refresh_token"),
                "expires_at": (utcnow() + timedelta(seconds=int(data.get("expires_in", 3600)))).isoformat()}

    def _refresh(self, credentials):
        self._configured()
        if not credentials.get("refresh_token"):
            raise ProviderError("calendar_reauth_required", retryable=False, reauth=True)
        response = self._http("POST", TOKEN_URL, data={
            "client_id": self.settings.google_calendar_client_id,
            "client_secret": self.settings.google_calendar_client_secret,
            "refresh_token": credentials["refresh_token"], "grant_type": "refresh_token",
        })
        self._check_oauth_client(response)
        if response.status_code == 400:
            raise ProviderError("calendar_reauth_required", retryable=False, reauth=True)
        self._check(response)
        data = self._json(response)
        if not data.get("access_token"):
            raise ProviderError("provider_invalid_response")
        data.setdefault("refresh_token", credentials["refresh_token"])
        credentials.update(self._tokens(data))

    def _request(self, method, url, credentials, *, allowed=(), **kwargs):
        try:
            expiry = datetime.fromisoformat(credentials["expires_at"])
        except (KeyError, ValueError, TypeError):
            expiry = utcnow()
        if expiry <= utcnow() + timedelta(seconds=60):
            self._refresh(credentials)
        headers = dict(kwargs.pop("headers", {}))
        headers["Authorization"] = f"Bearer {credentials['access_token']}"
        response = self._http(method, url, headers=headers, **kwargs)
        if response.status_code == 401:
            self._refresh(credentials)
            headers["Authorization"] = f"Bearer {credentials['access_token']}"
            response = self._http(method, url, headers=headers, **kwargs)
        if response.status_code not in allowed:
            self._check(response)
        return response

    @staticmethod
    def _events_url(calendar_id):
        return f"{API}/calendars/{quote(calendar_id, safe='')}/events"

    @staticmethod
    def _event_body(payload):
        tz = ZoneInfo(payload["timezone"])
        start = datetime.fromisoformat(payload["start_at"]).astimezone(tz)
        end = datetime.fromisoformat(payload["end_at"]).astimezone(tz)
        body = {"summary": payload["title"], "description": payload.get("notes") or "",
                "extendedProperties": {"private": {"lifehubEventId": payload["event_id"]}}}
        if payload["all_day"]:
            body.update(start={"date": start.date().isoformat()}, end={"date": end.date().isoformat()})
        else:
            body.update(start={"dateTime": start.isoformat(), "timeZone": str(tz)},
                        end={"dateTime": end.isoformat(), "timeZone": str(tz)})
        recurrence = []
        if payload.get("rrule"):
            rule = payload["rrule"].removeprefix("RRULE:")
            if payload["all_day"]:
                # Google DATE-valued DTSTART requires a DATE-valued UNTIL.
                # The local engine stores UTC UNTIL; convert its inclusive day.
                def until_date(match):
                    instant = datetime.strptime(match[1], "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
                    return "UNTIL=" + instant.astimezone(tz).strftime("%Y%m%d")
                rule = re.sub(r"UNTIL=(\d{8}T\d{6}Z)(?=;|$)", until_date, rule)
            recurrence.append("RRULE:" + rule)
        for value in payload.get("excluded_occurrences", []):
            at = datetime.fromisoformat(value)
            recurrence.append("EXDATE;VALUE=DATE:" + at.astimezone(tz).strftime("%Y%m%d") if payload["all_day"]
                              else "EXDATE:" + at.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ"))
        body["recurrence"] = recurrence
        return body

    def push_change(self, credentials, calendar_id, external_id, event, etag, exists):
        url = self._events_url(calendar_id)
        event_url = f"{url}/{quote(external_id, safe='')}"
        if event["deleted"]:
            if not exists:
                return PushResult(external_id, etag)
            method, body = "DELETE", None
        else:
            body = self._event_body(event)
            if not exists:
                body["id"] = external_id
                response = self._request("POST", url, credentials, json=body, allowed=(409,))
                if response.status_code != 409:
                    data = self._json(response)
                    return PushResult(data["id"], data.get("etag"))
                # Retry after uncertain insert: the stable id already exists.
                existing = self._request("GET", event_url, credentials)
                data = self._json(existing)
                if data.get("status") == "cancelled":
                    raise ProviderError("external_event_deleted", retryable=False)
                if data.get("extendedProperties", {}).get("private", {}).get("lifehubEventId") != event["event_id"]:
                    raise ProviderError("external_id_conflict", retryable=False)
                etag = data.get("etag")
                body.pop("id", None)
            method = "PATCH"
        # Local changes win the outbound phase. Refresh an outdated ETag, then retry
        # the same local snapshot. A repeatedly changing remote retries next run.
        for _ in range(3):
            response = self._request(method, event_url, credentials, json=body,
                                     headers={"If-Match": etag} if etag else {}, allowed=(404, 410, 412))
            if response.status_code in (404, 410):
                if method == "DELETE":
                    return PushResult(external_id, None)
                body["id"] = external_id
                response = self._request("POST", url, credentials, json=body, allowed=(409,))
                if response.status_code == 409:
                    raise ProviderError("external_event_deleted", retryable=False)
            if response.status_code != 412:
                if method == "DELETE":
                    return PushResult(external_id, None)
                data = self._json(response)
                return PushResult(data["id"], data.get("etag"))
            current = self._request("GET", event_url, credentials, allowed=(404, 410))
            etag = self._json(current).get("etag") if current.status_code == 200 else None
        raise ProviderError("calendar_busy")

    def pull_changes(self, credentials, calendar_id, cursor, heartbeat=None):
        changes, page, reset = [], None, cursor is None
        seen_pages = set()
        while True:
            if heartbeat:
                heartbeat()
            params = {"maxResults": 2500, "singleEvents": "false", "showDeleted": "true"}
            if cursor:
                params["syncToken"] = cursor
            if page:
                params["pageToken"] = page
            response = self._request("GET", self._events_url(calendar_id), credentials, params=params, allowed=(410,))
            if response.status_code == 410:
                if reset:
                    raise ProviderError("provider_invalid_sync_cursor")
                cursor, page, changes, reset, seen_pages = None, None, [], True, set()
                continue
            data = self._json(response)
            try:
                changes.extend(self._normalize(item, credentials.get("calendar_timezone", "UTC")) for item in data.get("items", []))
            except (ValueError, TypeError, KeyError) as exc:
                raise ProviderError("provider_invalid_event", retryable=False) from exc
            page = data.get("nextPageToken")
            if not page:
                if not data.get("nextSyncToken"):
                    raise ProviderError("provider_invalid_response")
                return PullResult(changes, data["nextSyncToken"], full_sync=reset)
            if page in seen_pages:
                raise ProviderError("provider_invalid_pagination")
            seen_pages.add(page)

    @staticmethod
    def _parse_time(value, fallback="UTC"):
        tz = value.get("timeZone", fallback)
        if value.get("dateTime"):
            parsed = datetime.fromisoformat(value["dateTime"].replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=ZoneInfo(tz))
            return parsed.astimezone(UTC)
        return datetime.combine(datetime.fromisoformat(value["date"]).date(), time.min, ZoneInfo(tz)).astimezone(UTC)

    def _normalize(self, data, calendar_timezone="UTC"):
        kwargs = {"external_id": data["id"], "etag": data.get("etag"), "deleted": data.get("status") == "cancelled"}
        tz = data.get("start", {}).get("timeZone") or data.get("end", {}).get("timeZone") or calendar_timezone
        if data.get("recurringEventId"):
            kwargs.update(recurring_parent_id=data["recurringEventId"], original_start_at=self._parse_time(data["originalStartTime"], tz))
        if kwargs["deleted"]:
            return NormalizedEvent(**kwargs)
        recurrence = data.get("recurrence", [])
        rules = [line.removeprefix("RRULE:") for line in recurrence if line.startswith("RRULE:")]
        # Google all-day RRULEs may use a date-only inclusive UNTIL. The local
        # recurrence engine uses UTC UNTIL, so normalize the end of that local day.
        if "date" in data["start"]:
            def until_utc(match):
                day = datetime.strptime(match[1], "%Y%m%d").replace(tzinfo=ZoneInfo(tz))
                inclusive = (day + timedelta(days=1, seconds=-1)).astimezone(UTC)
                return "UNTIL=" + inclusive.strftime("%Y%m%dT%H%M%SZ")
            rules = [re.sub(r"UNTIL=(\d{8})(?=;|$)", until_utc, rule) for rule in rules]
        excluded = []
        for line in recurrence:
            if line.startswith("EXDATE"):
                prefix, dates = line.split(":", 1)
                exc_tz = ZoneInfo(prefix.split("TZID=", 1)[1].split(";", 1)[0]) if "TZID=" in prefix else ZoneInfo(tz)
                for value in dates.split(","):
                    parsed = datetime.strptime(value, "%Y%m%d" if len(value) == 8 else "%Y%m%dT%H%M%SZ" if value.endswith("Z") else "%Y%m%dT%H%M%S")
                    excluded.append(parsed.replace(tzinfo=UTC if value.endswith("Z") else exc_tz).astimezone(UTC))
        unsupported = len(rules) > 1 or any(line.startswith(("RDATE", "EXRULE")) for line in recurrence)
        kwargs.update(title=data.get("summary") or "Untitled", notes=data.get("description"),
                      start_at=self._parse_time(data["start"], tz), end_at=self._parse_time(data["end"], tz),
                      timezone=tz, all_day="date" in data["start"], rrule=rules[0] if rules else None,
                      excluded_occurrences=excluded, read_only=unsupported or data.get("eventType", "default") != "default"
                      or (not data.get("organizer", {}).get("self", True) and not data.get("guestsCanModify", False)))
        return NormalizedEvent(**kwargs)

    def revoke(self, credentials):
        token = credentials.get("refresh_token") or credentials.get("access_token")
        if token:
            response = self._http("POST", "https://oauth2.googleapis.com/revoke", data={"token": token})
            if response.status_code not in (200, 400):
                self._check(response)
