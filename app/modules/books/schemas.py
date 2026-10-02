from datetime import date
from typing import Literal
from pydantic import Field, model_validator
from app.modules.planning.schemas import InputModel


class BookInput(InputModel):
    title: str = Field(min_length=1, max_length=300)
    author: str = Field(default="", max_length=300)
    status: Literal["want", "reading", "read"] = "want"
    total_pages: int | None = Field(default=None, ge=1, le=100000)
    current_page: int = Field(default=0, ge=0, le=100000)
    rating: int | None = Field(default=None, ge=1, le=5)
    genre: str = Field(default="", max_length=100)
    cover_id: int | None = Field(default=None, ge=1, le=2147483647)
    open_library_key: str | None = Field(default=None, pattern=r"^/works/OL[0-9]+W$")
    notes: str = Field(default="", max_length=50000)
    started_on: date | None = None
    finished_on: date | None = None

    @model_validator(mode="after")
    def progress_valid(self):
        if self.total_pages and self.current_page > self.total_pages:
            raise ValueError("Current page exceeds total pages")
        if self.rating is not None and self.status != "read":
            raise ValueError("Rate a finished book")
        if self.started_on and self.finished_on and self.finished_on < self.started_on:
            raise ValueError("Finish date precedes start date")
        return self


class DiaryInput(InputModel):
    day: date
    title: str = Field(default="", max_length=300)
    text: str = Field(min_length=1, max_length=100000)
