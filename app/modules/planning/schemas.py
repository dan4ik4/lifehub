from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator


class InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ReminderCreate(InputModel):
    trigger_at: AwareDatetime | None = None
    offset_minutes: int | None = Field(default=None, ge=0, le=525600)
    channel: Literal["push", "email"] = "push"

    @model_validator(mode="after")
    def one_trigger(self):
        if (self.trigger_at is None) == (self.offset_minutes is None):
            raise ValueError("Provide exactly one of trigger_at and offset_minutes")
        return self


class ZonedInput(InputModel):
    timezone: str | None = None

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value):
        if value is not None:
            try:
                ZoneInfo(value)
            except (ValueError, ZoneInfoNotFoundError) as exc:
                raise ValueError("Use an IANA timezone") from exc
        return value


class TaskCreate(ZonedInput):
    title: str = Field(min_length=1, max_length=300)
    notes: str | None = Field(default=None, max_length=20000)
    start_at: AwareDatetime | None = None
    due_at: AwareDatetime | None = None
    all_day: bool = False
    priority: Literal["none", "low", "medium", "high"] = "none"
    rrule: str | None = Field(default=None, max_length=2000)
    reminders: list[ReminderCreate] = Field(default_factory=list, max_length=10)


class TaskUpdate(ZonedInput):
    version: int = Field(ge=1)
    title: str | None = Field(default=None, min_length=1, max_length=300)
    notes: str | None = Field(default=None, max_length=20000)
    start_at: AwareDatetime | None = None
    due_at: AwareDatetime | None = None
    all_day: bool | None = None
    priority: Literal["none", "low", "medium", "high"] | None = None
    rrule: str | None = Field(default=None, max_length=2000)
    reminders: list[ReminderCreate] | None = Field(default=None, max_length=10)


class TaskCompleteRequest(InputModel):
    occurrence_at: AwareDatetime | None = None
    version: int | None = Field(default=None, ge=1)


class CalendarEventCreate(ZonedInput):
    title: str = Field(min_length=1, max_length=300)
    notes: str | None = Field(default=None, max_length=20000)
    start_at: AwareDatetime
    end_at: AwareDatetime
    all_day: bool = False
    rrule: str | None = Field(default=None, max_length=2000)
    reminders: list[ReminderCreate] = Field(default_factory=list, max_length=10)


class CalendarEventUpdate(ZonedInput):
    version: int = Field(ge=1)
    title: str | None = Field(default=None, min_length=1, max_length=300)
    notes: str | None = Field(default=None, max_length=20000)
    start_at: AwareDatetime | None = None
    end_at: AwareDatetime | None = None
    all_day: bool | None = None
    rrule: str | None = Field(default=None, max_length=2000)
    reminders: list[ReminderCreate] | None = Field(default=None, max_length=10)


class PlanningListCreate(InputModel):
    name: str = Field(min_length=1, max_length=100)


class PlanningListUpdate(PlanningListCreate):
    version: int | None = Field(default=None, ge=1)


class ListItemCreate(InputModel):
    title: str = Field(min_length=1, max_length=300)
    quantity: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=4)
    unit: str | None = Field(default=None, min_length=1, max_length=40)
    checked: bool = False
    position: int | None = Field(default=None, ge=0, le=2147483647)


class ListItemUpdate(InputModel):
    version: int = Field(ge=1)
    title: str | None = Field(default=None, min_length=1, max_length=300)
    quantity: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=4)
    unit: str | None = Field(default=None, min_length=1, max_length=40)
    checked: bool | None = None
    position: int | None = Field(default=None, ge=0, le=2147483647)


class ListItemsBulkCreate(InputModel):
    items: list[ListItemCreate] = Field(min_length=1, max_length=100)


class OutputModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ReminderResponse(OutputModel):
    id: UUID
    trigger_at: datetime | None
    offset_minutes: int | None
    channel: str
    delivered_at: datetime | None


class RecurrenceRuleResponse(OutputModel):
    rrule: str
    human_text: str
    timezone: str
    next_occurrence_at: datetime | None


class TaskResponse(OutputModel):
    id: UUID
    title: str
    notes: str | None
    start_at: datetime | None
    due_at: datetime | None
    timezone: str
    all_day: bool
    priority: str
    recurrence: RecurrenceRuleResponse | None
    completed: bool
    next_occurrence_at: datetime | None
    reminders: list[ReminderResponse]
    version: int
    created_at: datetime
    updated_at: datetime


class TaskOccurrenceResponse(OutputModel):
    task_id: UUID
    occurrence_at: datetime | None
    status: Literal["pending", "completed", "skipped"]
    completed_at: datetime | None
    effective_start_at: datetime | None
    effective_due_at: datetime | None


class CalendarEventResponse(OutputModel):
    id: UUID
    title: str
    notes: str | None
    start_at: datetime
    end_at: datetime
    timezone: str
    all_day: bool
    recurrence: RecurrenceRuleResponse | None
    source: Literal["local", "google", "apple", "ai"]
    connection_id: UUID | None
    external_read_only: bool
    version: int
    created_at: datetime
    updated_at: datetime
    occurrence_at: datetime | None = None


class TaskPageResponse(OutputModel):
    items: list[TaskResponse]
    next_cursor: str | None = None
    total: int


class EventPageResponse(OutputModel):
    items: list[CalendarEventResponse]
    next_cursor: str | None = None
    total: int


class CalendarRangeResponse(OutputModel):
    from_: datetime = Field(alias="from")
    to: datetime
    timezone: str
    tasks: list[TaskOccurrenceResponse]
    events: list[CalendarEventResponse]


class PlanningListResponse(OutputModel):
    id: UUID
    name: str
    kind: Literal["shopping", "custom"]
    is_system: bool
    is_editable: bool
    item_count: int
    completed_count: int
    version: int
    created_at: datetime
    updated_at: datetime


class ListItemResponse(OutputModel):
    id: UUID
    list_id: UUID
    title: str
    quantity: Decimal | None
    unit: str | None
    checked: bool
    position: int
    version: int
    created_at: datetime
    updated_at: datetime


class PlanningListCollectionResponse(OutputModel):
    items: list[PlanningListResponse]


class ListItemCollectionResponse(OutputModel):
    items: list[ListItemResponse]
    next_cursor: str | None = None
    total: int
