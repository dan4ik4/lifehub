from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from pydantic import AwareDatetime
from sqlalchemy import or_

from app.core.dependencies import get_db
from app.modules.planning.dependencies import require_planning_user
from app.modules.planning.models import CalendarEvent, ListItem, Task
from app.modules.planning.schemas import (
    CalendarEventCreate, CalendarEventResponse, CalendarEventUpdate, CalendarRangeResponse,
    EventPageResponse, ListItemCollectionResponse, ListItemCreate, ListItemResponse,
    ListItemsBulkCreate, ListItemUpdate, PlanningListCollectionResponse, PlanningListCreate,
    PlanningListResponse, PlanningListUpdate, TaskCompleteRequest, TaskCreate,
    TaskOccurrenceResponse, TaskPageResponse, TaskResponse, TaskUpdate,
)
from app.modules.planning.service import PlanningService

router = APIRouter(prefix="/api/v1/planning", tags=["Planning"])


def get_service(db=Depends(get_db), user=Depends(require_planning_user)):
    return PlanningService(db, user)


Service = Annotated[PlanningService, Depends(get_service)]
Cursor = Annotated[str | None, Query(max_length=1000)]
Limit = Annotated[int, Query(ge=1, le=100)]


@router.get("/tasks", response_model=TaskPageResponse)
def list_tasks(service: Service, cursor: Cursor = None, limit: Limit = 50, completed: bool | None = None, priority: Literal["none", "low", "medium", "high"] | None = None, from_: AwareDatetime | None = Query(None, alias="from"), to: AwareDatetime | None = None):
    statement = service.tasks.query()
    if completed is not None:
        statement = statement.where(Task.completed_at.is_not(None) if completed else Task.completed_at.is_(None))
    if priority:
        statement = statement.where(Task.priority == priority)
    if from_:
        statement = statement.where(or_(Task.due_at >= from_, Task.start_at >= from_))
    if to:
        statement = statement.where(or_(Task.due_at < to, Task.start_at < to))
    items, next_cursor, total = service.tasks.page(statement, cursor, limit)
    return {"items": [service.task_response(item) for item in items], "next_cursor": next_cursor, "total": total}


@router.post("/tasks", response_model=TaskResponse, status_code=201)
def create_task(payload: TaskCreate, service: Service):
    return service.task_response(service.create_task(payload))


@router.get("/tasks/{task_id}", response_model=TaskResponse)
def get_task(task_id: UUID, service: Service):
    return service.task_response(service.tasks.get(task_id))


@router.patch("/tasks/{task_id}", response_model=TaskResponse)
def update_task(task_id: UUID, payload: TaskUpdate, service: Service):
    return service.task_response(service.update_task(task_id, payload))


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: UUID, service: Service, version: int | None = Query(None, ge=1)):
    service.delete_task(task_id, version)
    return Response(status_code=204)


@router.post("/tasks/{task_id}/complete", response_model=TaskOccurrenceResponse)
def complete_task(task_id: UUID, payload: TaskCompleteRequest, service: Service):
    return service.complete_task(task_id, payload)


@router.post("/tasks/{task_id}/reopen", response_model=TaskOccurrenceResponse)
def reopen_task(task_id: UUID, payload: TaskCompleteRequest, service: Service):
    return service.complete_task(task_id, payload, reopen=True)


@router.get("/calendar", response_model=CalendarRangeResponse)
def calendar(service: Service, from_: AwareDatetime = Query(alias="from"), to: AwareDatetime = Query(), timezone: str = Query("UTC", max_length=100)):
    return service.calendar_range(from_, to, timezone)


@router.get("/events", response_model=EventPageResponse)
def list_events(service: Service, cursor: Cursor = None, limit: Limit = 50, source: Literal["local", "google", "apple", "ai"] | None = None, from_: AwareDatetime | None = Query(None, alias="from"), to: AwareDatetime | None = None):
    statement = service.events.query()
    if source:
        statement = statement.where(CalendarEvent.source == source)
    if from_:
        statement = statement.where(or_(CalendarEvent.end_at > from_, CalendarEvent.rrule.is_not(None)))
    if to:
        statement = statement.where(CalendarEvent.start_at < to)
    items, next_cursor, total = service.events.page(statement, cursor, limit)
    return {"items": [service.event_response(item) for item in items], "next_cursor": next_cursor, "total": total}


@router.post("/events", response_model=CalendarEventResponse, status_code=201)
def create_event(payload: CalendarEventCreate, service: Service):
    return service.event_response(service.create_event(payload))


@router.get("/events/{event_id}", response_model=CalendarEventResponse)
def get_event(event_id: UUID, service: Service):
    return service.event_response(service.events.get(event_id))


@router.patch("/events/{event_id}", response_model=CalendarEventResponse)
def update_event(event_id: UUID, payload: CalendarEventUpdate, service: Service):
    return service.event_response(service.update_event(event_id, payload))


@router.delete("/events/{event_id}", status_code=204)
def delete_event(event_id: UUID, service: Service, scope: Literal["this", "future", "all"] = "all", occurrence_at: AwareDatetime | None = None, version: int | None = Query(None, ge=1)):
    service.delete_event(event_id, scope, occurrence_at, version)
    return Response(status_code=204)


@router.get("/lists", response_model=PlanningListCollectionResponse)
def list_lists(service: Service):
    service.ensure_shopping_list()
    return {"items": [service.list_response(item) for item in service.session.scalars(service.lists.query())]}


@router.post("/lists", response_model=PlanningListResponse, status_code=201)
def create_list(payload: PlanningListCreate, service: Service):
    return service.list_response(service.create_list(payload))


@router.get("/lists/{list_id}", response_model=PlanningListResponse)
def get_list(list_id: UUID, service: Service):
    return service.list_response(service.get_list(list_id))


@router.patch("/lists/{list_id}", response_model=PlanningListResponse)
def update_list(list_id: UUID, payload: PlanningListUpdate, service: Service):
    return service.list_response(service.update_list(list_id, payload))


@router.delete("/lists/{list_id}", status_code=204)
def delete_list(list_id: UUID, service: Service):
    service.delete_list(list_id)
    return Response(status_code=204)


@router.get("/lists/{list_id}/items", response_model=ListItemCollectionResponse)
def list_items(list_id: UUID, service: Service, cursor: Cursor = None, limit: Limit = 50):
    service.get_list(list_id)
    items, next_cursor, total = service.items.page(service.items.query().where(ListItem.list_id == list_id), cursor, limit, position=True)
    return {"items": [service.list_item_response(item) for item in items], "next_cursor": next_cursor, "total": total}


@router.post("/lists/{list_id}/items", response_model=ListItemResponse, status_code=201)
def create_item(list_id: UUID, payload: ListItemCreate, service: Service):
    return service.list_item_response(service.add_list_items(list_id, [payload])[0])


@router.post("/lists/{list_id}/items/bulk", response_model=ListItemCollectionResponse, status_code=201)
def bulk_items(list_id: UUID, payload: ListItemsBulkCreate, service: Service):
    items = service.add_list_items(list_id, payload.items)
    return {"items": [service.list_item_response(item) for item in items], "next_cursor": None, "total": len(items)}


@router.patch("/lists/{list_id}/items/{item_id}", response_model=ListItemResponse)
def update_item(list_id: UUID, item_id: UUID, payload: ListItemUpdate, service: Service):
    return service.list_item_response(service.update_list_item(list_id, item_id, payload))


@router.delete("/lists/{list_id}/items/{item_id}", status_code=204)
def delete_item(list_id: UUID, item_id: UUID, service: Service):
    service.delete_list_item(list_id, item_id)
    return Response(status_code=204)
