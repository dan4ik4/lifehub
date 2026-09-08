from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import Field, field_validator, model_validator

from app.modules.auth.schemas import RequestModel


def valid_free_modules(value) -> bool:
    """Allow the current planning-only product and existing three-module accounts."""
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        return False
    return value == ["planning"] or (
        len(value) == 3
        and len(set(value)) == 3
        and set(value) <= {"planning", "goals_habits", "health", "finance", "books"}
    )


class UserPatchRequest(RequestModel):
    name: str | None = Field(default=None, max_length=50)
    timezone: str | None = Field(default=None, max_length=100)
    free_modules: list[Literal["planning", "goals_habits", "health", "finance", "books"]] | None = None
    onboarding_completed: bool | None = None
    plan: Literal["free", "trial"] | None = None

    @field_validator("free_modules", mode="before")
    @classmethod
    def modules(cls, value):
        if value is None:
            return value
        if not isinstance(value, list):
            raise ValueError("Select Planning or three unique legacy modules")
        value = ["books" if item == "books_diary" else item for item in value]
        if not valid_free_modules(value):
            raise ValueError("Select Planning or three unique legacy modules")
        return value

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value):
        if value is not None:
            try:
                ZoneInfo(value)
            except (ZoneInfoNotFoundError, ValueError) as exc:
                raise ValueError("Use an IANA timezone") from exc
        return value

    @model_validator(mode="after")
    def no_explicit_null(self):
        if any(getattr(self, field) is None for field in self.model_fields_set):
            raise ValueError("Profile fields cannot be null")
        return self
