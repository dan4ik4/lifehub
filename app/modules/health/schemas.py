from datetime import date, timedelta
from decimal import Decimal
from typing import Literal
from uuid import UUID
from pydantic import AwareDatetime, Field, model_validator, field_validator
from app.modules.planning.schemas import InputModel


class SleepInput(InputModel):
    start_at: AwareDatetime
    end_at: AwareDatetime
    quality: int = Field(ge=1, le=5)

    @model_validator(mode="after")
    def interval(self):
        if not timedelta(0) < self.end_at - self.start_at <= timedelta(hours=48):
            raise ValueError("Use a positive sleep interval up to 48 hours")
        return self


class WeightInput(InputModel):
    day: date
    kg: Decimal = Field(gt=0, le=1000, max_digits=7, decimal_places=3)
    notes: str = Field(default="", max_length=1000)


class WorkoutEffort(InputModel):
    name: str = Field(min_length=1, max_length=200)
    reps: int = Field(ge=1, le=1000)
    kg: float | None = Field(default=None, ge=0, le=1000, allow_inf_nan=False)


class WorkoutInput(InputModel):
    day: date
    title: str = Field(min_length=1, max_length=300)
    minutes: int = Field(gt=0, le=1440)
    notes: str = Field(default="", max_length=20000)
    efforts: list[WorkoutEffort] = Field(default_factory=list, max_length=500)
    program_id: UUID | None = None


class NutritionInput(InputModel):
    day: date
    meal: Literal["breakfast", "lunch", "dinner", "snack"]
    title: str = Field(min_length=1, max_length=300)
    calories: Decimal = Field(ge=0, le=100000, max_digits=10, decimal_places=2)
    protein: Decimal = Field(ge=0, le=10000, max_digits=10, decimal_places=2)
    fat: Decimal = Field(ge=0, le=10000, max_digits=10, decimal_places=2)
    carbs: Decimal = Field(ge=0, le=10000, max_digits=10, decimal_places=2)


class MedicationInput(InputModel):
    title: str = Field(min_length=1, max_length=300)
    dosage: str = Field(min_length=1, max_length=100)
    times: list[str] = Field(min_length=1, max_length=12)
    weekdays: list[int] = Field(default_factory=lambda: list(range(7)), min_length=1, max_length=7)
    course_end: date | None = None
    stock: int | None = Field(default=None, ge=0, le=100000)

    @field_validator("weekdays")
    @classmethod
    def weekdays_valid(cls, value):
        if len(set(value)) != len(value) or any(day < 0 or day > 6 for day in value):
            raise ValueError("Use unique weekdays from 0 to 6")
        return sorted(value)

    @field_validator("times")
    @classmethod
    def times_valid(cls, value):
        import re

        if len(set(value)) != len(value) or any(not re.fullmatch(r"([01][0-9]|2[0-3]):[0-5][0-9]", v) for v in value):
            raise ValueError("Use unique times HH:MM")
        return sorted(value)


class IntakeInput(InputModel):
    day: date
    time: str = Field(pattern=r"^([01][0-9]|2[0-3]):[0-5][0-9]$")
    taken: bool
    skipped: bool = False
    version: int = Field(ge=1)

    @model_validator(mode="after")
    def one_status(self):
        if self.taken and self.skipped:
            raise ValueError("A scheduled intake cannot be both taken and skipped")
        return self


class ExerciseInput(InputModel):
    name: str = Field(min_length=1, max_length=200)
    sets: int = Field(ge=1, le=100)
    reps: int = Field(ge=1, le=1000)
    kg: float | None = Field(default=None, ge=0, le=1000, allow_inf_nan=False)


class ProgramInput(InputModel):
    title: str = Field(min_length=1, max_length=300)
    exercises: list[ExerciseInput] = Field(min_length=1, max_length=100)


class WeightTargetInput(InputModel):
    kg: Decimal = Field(gt=0, le=1000, max_digits=7, decimal_places=3)
    mode: Literal["gain", "maintain", "lose"] = "maintain"


class NutritionTargetInput(InputModel):
    calories: int = Field(ge=0, le=100000)
    protein: int = Field(ge=0, le=10000)
    fat: int = Field(ge=0, le=10000)
    carbs: int = Field(ge=0, le=10000)
