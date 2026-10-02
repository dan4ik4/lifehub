from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID
from pydantic import Field, field_validator
from app.modules.planning.schemas import InputModel


class GoalInput(InputModel):
    title: str = Field(min_length=1, max_length=300)
    description: str = Field(default="", max_length=20000)
    due_date: date | None = None
    status: Literal["active", "completed", "cancelled"] = "active"
    progress: int = Field(default=0, ge=0, le=100)


class GoalEdit(GoalInput):
    version: int = Field(ge=1)


class MilestoneInput(InputModel):
    title: str = Field(min_length=1, max_length=300)
    progress: int = Field(default=0, ge=0, le=100)


class MilestoneEdit(MilestoneInput):
    version: int = Field(ge=1)


class HabitInput(InputModel):
    title: str = Field(min_length=1, max_length=300)
    kind: Literal["boolean", "count", "duration"] = "boolean"
    target: Decimal = Field(default=Decimal(1), gt=0, max_digits=14, decimal_places=4)
    unit: str = Field(default="", max_length=40)
    weekdays: list[int] = Field(default_factory=lambda: list(range(7)), min_length=1, max_length=7)
    reminder_time: str | None = Field(default=None, pattern=r"^([01][0-9]|2[0-3]):[0-5][0-9]$")
    goal_id: UUID | None = None
    archived: bool = False

    @field_validator("weekdays")
    @classmethod
    def weekdays_valid(cls, value):
        if len(set(value)) != len(value) or any(n < 0 or n > 6 for n in value):
            raise ValueError("Use unique weekdays 0 through 6")
        return sorted(value)


class HabitEdit(HabitInput):
    version: int = Field(ge=1)


class CheckinInput(InputModel):
    day: date
    value: Decimal = Field(ge=0, max_digits=14, decimal_places=4)
    version: int = Field(ge=1)


class TaskLinkInput(InputModel):
    task_id: UUID
