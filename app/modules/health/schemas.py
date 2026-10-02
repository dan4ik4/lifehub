from datetime import date, timedelta
from decimal import Decimal
from typing import Literal
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


class WorkoutInput(InputModel):
    day: date
    title: str = Field(min_length=1, max_length=300)
    minutes: int = Field(gt=0, le=1440)
    notes: str = Field(default="", max_length=20000)


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
    version: int = Field(ge=1)


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
