from datetime import date
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select, func
from app.core.database import utcnow
from app.core.dependencies import get_db
from app.core.errors import AppError
from app.core.owned import record, require_module
from app.core.resource_api import add_resource
from app.modules.auth.dependencies import get_current_user
from app.modules.planning.dependencies import EntitlementService
from app.modules.books.models import Book, DiaryEntry
from app.modules.books.schemas import BookInput, DiaryInput
from app.modules.books.catalog import search_catalog

router = APIRouter(prefix="/api/v1", tags=["books and diary"])


def member(user=Depends(get_current_user)):
    return require_module(user, "books")


def today(user):
    return utcnow().astimezone(ZoneInfo(user.timezone)).date()


def book_output(book, user):
    result = record(book)
    if not EntitlementService.is_pro(user):
        result["notes"] = ""
    return result


def book_valid(db, user, values, item):
    if not EntitlementService.is_pro(user):
        if values["notes"]:
            EntitlementService.require_pro(user)
        if item:
            values["notes"] = item.notes
    if any(values.get(k) and values[k] > today(user) for k in ("started_on", "finished_on")):
        raise AppError(422, "invalid_date", "Reading dates cannot be in the future")
    if values["status"] == "reading" and not values["started_on"]:
        values["started_on"] = today(user)
    if values["status"] == "read":
        values["finished_on"] = values["finished_on"] or today(user)
        if values["total_pages"]:
            values["current_page"] = values["total_pages"]
    else:
        values["finished_on"] = None


def diary_valid(db, user, values, item):
    if values["day"] > today(user):
        raise AppError(422, "invalid_date", "Diary dates cannot be in the future")


@router.get("/books/search")
def catalog(
    request: Request,
    q: str = Query(min_length=2, max_length=200),
    page: int = Query(1, ge=1, le=50),
    user=Depends(member),
):
    request.app.state.rate_limiter.hit("book-search:" + str(user.id), 30, 60)
    return search_catalog(q, page)


@router.get("/books/stats")
def stats(year: int = Query(ge=1900, le=9998), user=Depends(member), db=Depends(get_db)):
    EntitlementService.require_pro(user)
    books = db.scalars(
        select(Book).where(
            Book.user_id == user.id,
            Book.deleted_at.is_(None),
            Book.status == "read",
            Book.finished_on >= date(year, 1, 1),
            Book.finished_on < date(year + 1, 1, 1),
        )
    ).all()
    genres = {}
    for b in books:
        genres[b.genre or "other"] = genres.get(b.genre or "other", 0) + 1
    elapsed = sum(max(1, (b.finished_on - b.started_on).days + 1) for b in books if b.started_on)
    pages = sum(b.current_page for b in books if b.started_on)
    return {
        "year": year,
        "finished": len(books),
        "pages": sum(b.current_page for b in books),
        "pages_per_reading_day": round(pages / elapsed, 1) if elapsed else None,
        "genres": genres,
    }


@router.get("/diary/calendar")
def diary_calendar(
    month: str = Query(pattern=r"^[1-8][0-9]{3}-(0[1-9]|1[0-2])$"), user=Depends(member), db=Depends(get_db)
):
    from datetime import timedelta

    start = date.fromisoformat(month + "-01")
    end = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    rows = db.execute(
        select(DiaryEntry.day, func.count())
        .where(
            DiaryEntry.user_id == user.id,
            DiaryEntry.deleted_at.is_(None),
            DiaryEntry.day >= start,
            DiaryEntry.day < end,
        )
        .group_by(DiaryEntry.day)
    ).all()
    return {"days": [{"day": day, "count": count} for day, count in rows]}


@router.get("/diary/entries/search")
def search(
    q: str = Query(min_length=1, max_length=200),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    day: date | None = None,
    user=Depends(member),
    db=Depends(get_db),
):
    EntitlementService.require_pro(user)
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    items = db.scalars(
        select(DiaryEntry)
        .where(
            DiaryEntry.user_id == user.id,
            DiaryEntry.deleted_at.is_(None),
            DiaryEntry.day == day if day else True,
            (
                DiaryEntry.text.ilike("%" + escaped + "%", escape="\\")
                | DiaryEntry.title.ilike("%" + escaped + "%", escape="\\")
            ),
        )
        .order_by(DiaryEntry.day.desc(), DiaryEntry.id)
        .offset(offset)
        .limit(limit + 1)
    ).all()
    return {"items": [record(i) for i in items[:limit]], "has_more": len(items) > limit}


add_resource(router, "/books", Book, BookInput, "books", validate=book_valid, serialize=book_output)
add_resource(router, "/diary/entries", DiaryEntry, DiaryInput, "books", validate=diary_valid)
