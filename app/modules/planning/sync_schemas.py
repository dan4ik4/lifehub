from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class SyncSchema(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)


class CalendarConnectRequest(SyncSchema):
    redirect_uri: str = Field(min_length=1, max_length=2048)
    device_id: str | None = Field(default=None, min_length=1, max_length=128)


class CalendarCallbackRequest(SyncSchema):
    state: str = Field(min_length=20, max_length=512)
    code: str | None = Field(default=None, min_length=1, max_length=4096)
    device_id: str | None = Field(default=None, min_length=1, max_length=128)
    calendar_id: str | None = Field(default=None, min_length=1, max_length=1024)
    account_label: str | None = Field(default=None, min_length=1, max_length=320)
    permission_granted: bool | None = None


class CalendarSyncRequest(SyncSchema):
    """Every job always sends local changes before receiving external changes."""


class CalendarConnectionResponse(SyncSchema):
    id: UUID
    provider: Literal["google", "apple"]
    status: Literal["active", "reauth_required", "disconnected"]
    account_label: str
    sync_enabled: bool
    last_synced_at: datetime | None
    created_at: datetime


class CalendarConnectionCollectionResponse(SyncSchema):
    items: list[CalendarConnectionResponse]


class CalendarAuthUrlResponse(SyncSchema):
    authorize_url: str
    state: str
    expires_at: datetime


class CalendarSyncJobResponse(SyncSchema):
    job_id: UUID
    status: Literal["queued", "running", "done", "failed"]
    accepted_at: datetime
    phase: str
    available_at: datetime
    push_completed_at: datetime | None
    error_code: str | None


class NormalizedEvent(SyncSchema):
    external_id: str = Field(min_length=1, max_length=1024)
    deleted: bool = False
    title: str = Field(default="Untitled", min_length=1, max_length=300)
    notes: str | None = Field(default=None, max_length=20000)
    start_at: datetime | None = None
    end_at: datetime | None = None
    timezone: str = "UTC"
    all_day: bool = False
    rrule: str | None = Field(default=None, max_length=2000)
    excluded_occurrences: list[datetime] = Field(default_factory=list, max_length=1000)
    etag: str | None = Field(default=None, max_length=512)
    read_only: bool = False
    recurring_parent_id: str | None = Field(default=None, max_length=1024)
    original_start_at: datetime | None = None

    @field_validator("timezone")
    @classmethod
    def timezone_valid(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("Unknown IANA timezone") from exc
        return value

    @field_validator("start_at", "end_at", "original_start_at")
    @classmethod
    def aware(cls, value):
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("Datetime must include a timezone offset")
        return value

    @field_validator("excluded_occurrences")
    @classmethod
    def excluded_aware(cls, values):
        if any(v.tzinfo is None or v.utcoffset() is None for v in values):
            raise ValueError("Excluded occurrence must include a timezone offset")
        return values

    @model_validator(mode="after")
    def valid_event(self):
        if not self.deleted:
            if self.start_at is None or self.end_at is None or self.end_at <= self.start_at:
                raise ValueError("An event requires start_at and end_at after start_at")
            if self.rrule:
                from app.core.errors import AppError
                from app.modules.planning.recurrence import RecurrenceService
                try:
                    self.rrule = RecurrenceService.validate(self.rrule, self.start_at, self.timezone)
                except AppError as exc:
                    raise ValueError("Invalid recurrence rule") from exc
        if self.recurring_parent_id and self.original_start_at is None:
            raise ValueError("A recurring instance requires original_start_at")
        return self


class AppleAckItem(SyncSchema):
    operation_id: UUID
    external_id: str = Field(min_length=1, max_length=1024)
    etag: str | None = Field(default=None, max_length=512)


class AppleAckRequest(SyncSchema):
    device_id: str = Field(min_length=1, max_length=128)
    job_id: UUID
    acknowledgements: list[AppleAckItem] = Field(min_length=1, max_length=500)


class AppleDeltaRequest(SyncSchema):
    device_id: str = Field(min_length=1, max_length=128)
    job_id: UUID
    batch_id: UUID
    changes: list[NormalizedEvent] = Field(max_length=500)
    cursor: str | None = Field(default=None, max_length=4096)
    final: bool = True


class AppleOutgoingChange(SyncSchema):
    operation_id: UUID
    event_id: UUID
    event_version: int
    operation: Literal["upsert", "delete"]
    external_id: str | None
    payload: dict


class AppleOutboxResponse(SyncSchema):
    job: CalendarSyncJobResponse | None
    calendar_id: str
    changes: list[AppleOutgoingChange]
    more: bool
    pull_allowed_at: datetime | None


class AppleAcceptedResponse(SyncSchema):
    accepted: bool = True
