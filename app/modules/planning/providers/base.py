from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from dataclasses import dataclass
from typing import Callable, Protocol

from app.modules.planning.sync_schemas import NormalizedEvent


class ProviderError(Exception):
    """Only a stable non-secret code may cross the provider boundary."""
    def __init__(self, code="provider_error", *, retryable=True, reauth=False):
        self.code = code
        self.retryable = retryable
        self.reauth = reauth
        super().__init__(code)


@dataclass
class ProviderAccount:
    credentials: dict
    calendar_id: str
    account_label: str


@dataclass
class PullResult:
    changes: list[NormalizedEvent]
    cursor: str
    full_sync: bool = False


@dataclass
class PushResult:
    external_id: str
    etag: str | None


class CalendarProviderAdapter(Protocol):
    def authorize(self, state: str, redirect_uri: str, challenge: str) -> str: ...
    def exchange(self, code: str, redirect_uri: str, verifier: str) -> ProviderAccount: ...
    def pull_changes(self, credentials: dict, calendar_id: str, cursor: str | None, heartbeat: Callable[[], None] | None = None) -> PullResult: ...
    def push_change(self, credentials: dict, calendar_id: str, external_id: str, event: dict, etag: str | None, exists: bool) -> PushResult: ...
    def revoke(self, credentials: dict) -> None: ...


def fingerprint(payload: dict) -> str:
    fields = ("deleted", "title", "notes", "start_at", "end_at", "timezone", "all_day", "rrule", "excluded_occurrences")
    normalized = {key: payload.get(key) for key in fields}
    normalized["read_only"] = bool(payload.get("read_only", payload.get("external_read_only", False)))
    for key in ("start_at", "end_at"):
        if normalized[key]:
            normalized[key] = datetime.fromisoformat(normalized[key].replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()
    normalized["excluded_occurrences"] = sorted(datetime.fromisoformat(value.replace("Z", "+00:00"))
            .astimezone(timezone.utc).isoformat() for value in (normalized["excluded_occurrences"] or []))
    normalized["rrule"] = normalized["rrule"].removeprefix("RRULE:") if normalized["rrule"] else None
    normalized["notes"] = normalized["notes"] or None
    if normalized["deleted"]:
        normalized = {"deleted": True}
    return hashlib.sha256(json.dumps(normalized, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def default_provider_factory(provider, settings):
    if provider == "google":
        from app.modules.planning.providers.google import GoogleCalendarAdapter
        return GoogleCalendarAdapter(settings)
    raise ProviderError("device_bridge_required", retryable=False)
