from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.exc import StaleDataError

from app.core.database import utcnow
from app.core.errors import AppError
from app.modules.planning.crud import CalendarEventCrud, ListCrud, ListItemCrud, ReminderCrud, TaskCrud
from app.modules.planning.dependencies import EntitlementService, require_pro
from app.modules.planning.models import CalendarEvent, EventException, ListItem, PlanningList, Reminder, Task, TaskOccurrence
from app.modules.planning.recurrence import MAX_OCCURRENCES, RecurrenceService, validate_datetime, zone
from app.modules.planning.schemas import CalendarEventCreate, CalendarEventResponse, ListItemCreate, ListItemResponse, PlanningListResponse, RecurrenceRuleResponse, ReminderResponse, TaskCreate, TaskOccurrenceResponse, TaskResponse


def conflict():
    return AppError(409, "version_conflict", "Resource changed; reload it and retry with its current version")


def check_version(item, version):
    if version is not None and item.version != version:
        raise conflict()


def clean_update(data, non_nullable):
    for key in non_nullable:
        if key in data and data[key] is None:
            raise AppError(422, "validation_error", f"{key} cannot be null")
    return data


def anchor(task):
    return task.start_at or task.due_at


def effective_time(value, base, occurrence, timezone):
    if value is None or base is None or occurrence is None:
        return value
    if value.astimezone(UTC) == base.astimezone(UTC):
        return occurrence.astimezone(UTC)
    tz = zone(timezone)
    local_value = value.astimezone(tz)
    wall_delta = local_value.replace(tzinfo=None) - base.astimezone(tz).replace(tzinfo=None)
    # Retain an explicitly selected second instance of an ambiguous end/due
    # time. Dropping fold changes the original event's duration by one hour.
    return (occurrence.astimezone(tz) + wall_delta).replace(fold=local_value.fold).astimezone(UTC)


class PlanningService:
    """Transaction boundary shared by HTTP routes and the AI command executor.

    Methods accept commit=False to flush into an outer atomic transaction.
    """
    def __init__(self, session, user):
        self.session, self.user = session, user
        EntitlementService.require_planning(user)
        self.tasks = TaskCrud(session, user.id)
        self.events = CalendarEventCrud(session, user.id)
        self.lists = ListCrud(session, user.id)
        self.items = ListItemCrud(session, user.id)

    def finish(self, commit=True):
        try:
            self.session.flush()
            if commit:
                self.session.commit()
        except StaleDataError as exc:
            self.session.rollback()
            raise conflict() from exc
        except IntegrityError as exc:
            self.session.rollback()
            raise AppError(409, "duplicate", "A conflicting operation has already been applied") from exc

    def _validate_schedule(self, data, *, event=False):
        timezone = data.get("timezone") or self.user.timezone or "UTC"
        data["timezone"] = timezone
        tz = zone(timezone)
        start = data.get("start_at")
        end = data.get("end_at" if event else "due_at")
        for value in (start, end):
            if value is not None:
                validate_datetime(value, timezone)
                if data.get("all_day") and value.astimezone(tz).time().replace(tzinfo=None) != datetime.min.time():
                    raise AppError(422, "validation_error", "All-day boundaries must be midnight in the object's timezone")
        if event and (start is None or end is None or end <= start):
            raise AppError(422, "validation_error", "end_at must be after start_at (exclusive for all-day events)")
        if not event and start and end and end < start:
            raise AppError(422, "validation_error", "due_at must not precede start_at")
        if data.get("rrule"):
            require_pro(self.user)
            base = start or end
            if base is None:
                raise AppError(422, "invalid_rrule", "A recurring task needs start_at or due_at")
            if base.microsecond:
                raise AppError(422, "invalid_rrule", "Recurring boundaries use whole seconds")
            data["rrule"] = RecurrenceService.validate(data["rrule"], base, timezone)
            # Reject computationally unsafe rules before committing a mutation;
            # response serialization must not turn a saved create into a 422.
            RecurrenceService.next(data["rrule"], base, timezone, utcnow())
        elif data.get("rrule") == "":
            raise AppError(422, "invalid_rrule", "Use null to remove recurrence")
        if data.get("priority", "none") != "none":
            require_pro(self.user)
        return data

    def _reminders(self, entity_type, entity, definitions=None, *, rearm=False):
        from app.modules.planning.reminders import ReminderService
        ReminderService(self.session).replace(entity_type, entity, definitions, rearm=rearm)

    def create_task(self, payload: TaskCreate, commit=True):
        data = payload.model_dump(exclude={"reminders"})
        self._validate_schedule(data)
        item = Task(user_id=self.user.id, **data)
        self.session.add(item)
        self.session.flush()
        self._reminders("task", item, payload.reminders)
        self.finish(commit)
        return item

    def update_task(self, task_id, payload, commit=True):
        item = self.tasks.get(task_id, lock=True)
        old_reminder_target = item.due_at or item.start_at
        check_version(item, payload.version)
        changes = clean_update(payload.model_dump(exclude_unset=True, exclude={"version", "reminders"}), {"title", "timezone", "all_day", "priority"})
        merged = {key: getattr(item, key) for key in ("start_at", "due_at", "timezone", "all_day", "priority", "rrule")}
        merged.update(changes)
        self._validate_schedule(merged)
        schedule_changed = any(key in changes and getattr(item, key) != merged[key] for key in ("start_at", "due_at", "rrule", "timezone"))
        if not item.rrule and merged.get("rrule"):
            # A completed one-off is not completion of every new recurrence.
            # Recurring completion lives exclusively in TaskOccurrence rows.
            item.completed_at = None
        for key in changes:
            setattr(item, key, merged.get(key, changes[key]))
        # Preserve completion history if the series changes. Exceptions which no
        # longer match the rule remain historical records instead of being lost.
        item.updated_at = utcnow()
        if "reminders" in payload.model_fields_set:
            if payload.reminders is None:
                raise AppError(422, "validation_error", "reminders cannot be null")
            self._reminders("task", item, payload.reminders)
        elif schedule_changed:
            self._reminders("task", item, rearm=old_reminder_target != (item.due_at or item.start_at))
        self.finish(commit)
        return item

    def delete_task(self, task_id, version=None):
        item = self.tasks.get(task_id, lock=True)
        check_version(item, version)
        item.deleted_at = item.updated_at = utcnow()
        self._reminders("task", item, [])
        self.finish()

    def complete_task(self, task_id, payload, reopen=False):
        item = self.tasks.get(task_id, lock=True)
        check_version(item, payload.version)
        occurrence_at = payload.occurrence_at
        if item.rrule:
            require_pro(self.user)
            if occurrence_at is None:
                raise AppError(422, "occurrence_required", "occurrence_at is required for recurring tasks")
            if not RecurrenceService.contains(item.rrule, anchor(item), item.timezone, occurrence_at):
                raise AppError(422, "invalid_occurrence", "This instant is not an occurrence of the task")
            record = self.session.scalar(select(TaskOccurrence).where(TaskOccurrence.task_id == item.id, TaskOccurrence.user_id == self.user.id, TaskOccurrence.occurrence_at == occurrence_at).with_for_update())
            completed = record is not None and record.status == "completed"
        else:
            if occurrence_at is not None:
                raise AppError(422, "invalid_occurrence", "One-off tasks use a null occurrence_at")
            record = None
            completed = item.completed_at is not None
        if completed == (not reopen):
            raise AppError(409, "not_completed" if reopen else "already_completed", "Task is not completed" if reopen else "Task is already completed")
        now = utcnow()
        if item.rrule:
            if record is None:
                record = TaskOccurrence(task_id=item.id, user_id=self.user.id, occurrence_at=occurrence_at)
                self.session.add(record)
            record.status = "pending" if reopen else "completed"
            record.completed_at = None if reopen else now
        else:
            item.completed_at = None if reopen else now
            if reopen:
                self._reminders("task", item)
        item.updated_at = now
        self.finish()
        return self.occurrence_response(item, occurrence_at, record)

    def create_event(self, payload: CalendarEventCreate, commit=True):
        data = payload.model_dump(exclude={"reminders"})
        self._validate_schedule(data, event=True)
        item = CalendarEvent(user_id=self.user.id, **data)
        self.session.add(item)
        self.session.flush()
        self._reminders("event", item, payload.reminders)
        self.finish(commit)
        return item

    def update_event(self, event_id, payload, commit=True):
        item = self.events.get(event_id, lock=True)
        old_reminder_target = item.start_at
        self._event_writable(item)
        check_version(item, payload.version)
        changes = clean_update(payload.model_dump(exclude_unset=True, exclude={"version", "reminders"}), {"title", "start_at", "end_at", "timezone", "all_day"})
        merged = {key: getattr(item, key) for key in ("start_at", "end_at", "timezone", "all_day", "rrule")}
        merged.update(changes)
        self._validate_schedule(merged, event=True)
        schedule_changed = any(key in changes and getattr(item, key) != merged[key] for key in ("start_at", "end_at", "rrule", "timezone"))
        for key in changes:
            setattr(item, key, merged.get(key, changes[key]))
        # Keep cancellation records even when the parent series is edited.
        item.updated_at = utcnow()
        if "reminders" in payload.model_fields_set:
            if payload.reminders is None:
                raise AppError(422, "validation_error", "reminders cannot be null")
            self._reminders("event", item, payload.reminders)
        elif schedule_changed:
            self._reminders("event", item, rearm=old_reminder_target != item.start_at)
        self.finish(commit)
        return item

    def _event_writable(self, item):
        if item.external_read_only:
            raise AppError(409, "sync_conflict", "The connected calendar marks this event read-only")

    def delete_event(self, event_id, scope="all", occurrence_at=None, version=None):
        item = self.events.get(event_id, lock=True)
        self._event_writable(item)
        check_version(item, version)
        if scope not in {"this", "future", "all"}:
            raise AppError(422, "validation_error", "Invalid deletion scope")
        if item.rrule and scope != "all":
            require_pro(self.user)
            if occurrence_at is None:
                raise AppError(422, "occurrence_required", "occurrence_at is required for this or future scope")
            if not RecurrenceService.contains(item.rrule, item.start_at, item.timezone, occurrence_at):
                raise AppError(422, "invalid_occurrence", "This instant is not an occurrence of the event")
            if scope == "this":
                existing = self.session.scalar(select(EventException).where(EventException.event_id == item.id, EventException.occurrence_at == occurrence_at))
                if existing is None:
                    self.session.add(EventException(user_id=self.user.id, event_id=item.id, occurrence_at=occurrence_at))
            elif occurrence_at <= item.start_at:
                item.deleted_at = utcnow()
            else:
                item.rrule = RecurrenceService.truncate(item.rrule, occurrence_at)
        else:
            if not item.rrule and occurrence_at is not None:
                raise AppError(422, "invalid_occurrence", "One-off events do not accept occurrence_at")
            item.deleted_at = utcnow()
        item.updated_at = utcnow()
        self.session.flush()
        self._reminders("event", item, [] if item.deleted_at else None)
        self.finish()

    def ensure_shopping_list(self, *, commit=True):
        item = self.session.scalar(self.lists.query().where(PlanningList.system_key == "shopping"))
        if item is None:
            try:
                with self.session.begin_nested():
                    item = PlanningList(user_id=self.user.id, name="Покупки", kind="shopping", is_system=True, system_key="shopping")
                    self.session.add(item)
                    self.session.flush()
            except IntegrityError:
                item = self.session.scalar(self.lists.query().where(PlanningList.system_key == "shopping"))
                if item is None:
                    raise
            self.finish(commit)
        return item

    def get_list(self, list_id, *, edit_items=False):
        item = self.lists.get(list_id)
        if edit_items and not item.is_system:
            require_pro(self.user)
        return item

    def create_list(self, payload):
        require_pro(self.user)
        item = PlanningList(user_id=self.user.id, name=payload.name)
        self.session.add(item)
        self.finish()
        return item

    def update_list(self, list_id, payload):
        item = self.lists.get(list_id, lock=True)
        if item.is_system:
            raise AppError(409, "system_list_locked", "The shopping list cannot be renamed")
        require_pro(self.user)
        check_version(item, payload.version)
        item.name = payload.name
        item.updated_at = utcnow()
        self.finish()
        return item

    def delete_list(self, list_id):
        item = self.lists.get(list_id, lock=True)
        if item.is_system:
            raise AppError(409, "system_list_locked", "The shopping list cannot be deleted")
        require_pro(self.user)
        item.deleted_at = item.updated_at = utcnow()
        self.finish()

    def add_list_items(self, list_id: UUID, payload: list[ListItemCreate], commit=True):
        parent = self.get_list(list_id, edit_items=True)
        if not 1 <= len(payload) <= 100:
            raise AppError(422, "validation_error", "Bulk requests contain 1 to 100 items")
        max_position = self.session.scalar(select(func.max(ListItem.position)).where(ListItem.list_id == parent.id, ListItem.user_id == self.user.id, ListItem.deleted_at.is_(None)))
        next_position = (max_position or 0) + 1
        items = []
        for index, draft in enumerate(payload):
            data = draft.model_dump()
            if data["position"] is None:
                data["position"] = next_position + index
            item = ListItem(user_id=self.user.id, list_id=parent.id, **data)
            self.session.add(item)
            items.append(item)
        parent.updated_at = utcnow()
        self.finish(commit)
        return items

    def update_list_item(self, list_id, item_id, payload):
        parent = self.get_list(list_id, edit_items=True)
        item = self.items.get(item_id, lock=True)
        if item.list_id != parent.id:
            raise AppError(404, "not_found", "Resource not found")
        check_version(item, payload.version)
        changes = clean_update(payload.model_dump(exclude_unset=True, exclude={"version"}), {"title", "checked", "position"})
        for key, value in changes.items():
            setattr(item, key, value)
        item.updated_at = parent.updated_at = utcnow()
        self.finish()
        return item

    def delete_list_item(self, list_id, item_id):
        parent = self.get_list(list_id, edit_items=True)
        item = self.items.get(item_id, lock=True)
        if item.list_id != parent.id:
            raise AppError(404, "not_found", "Resource not found")
        item.deleted_at = item.updated_at = parent.updated_at = utcnow()
        self.finish()

    def recurrence_response(self, item, start):
        if not item.rrule:
            return None
        if isinstance(item, Task):
            excluded = set(self.session.scalars(select(TaskOccurrence.occurrence_at).where(TaskOccurrence.user_id == self.user.id, TaskOccurrence.task_id == item.id, TaskOccurrence.status.in_(["completed", "skipped"]))))
        else:
            excluded = set(self.session.scalars(select(EventException.occurrence_at).where(EventException.user_id == self.user.id, EventException.event_id == item.id)))
        next_occurrence = next((occurrence for occurrence in RecurrenceService.occurrences(item.rrule, start, item.timezone, utcnow(), datetime(9998, 1, 1, tzinfo=UTC)) if occurrence not in excluded), None)
        return RecurrenceRuleResponse(rrule=item.rrule, human_text=RecurrenceService.describe(item.rrule), timezone=item.timezone, next_occurrence_at=next_occurrence)

    def task_response(self, item):
        recurrence = self.recurrence_response(item, anchor(item))
        return TaskResponse(**{key: getattr(item, key) for key in ("id", "title", "notes", "start_at", "due_at", "timezone", "all_day", "priority", "version", "created_at", "updated_at")}, recurrence=recurrence, completed=item.completed_at is not None, next_occurrence_at=recurrence.next_occurrence_at if recurrence else None, reminders=[ReminderResponse.model_validate(r) for r in ReminderCrud(self.session, self.user.id).for_entity("task", item.id)])

    def event_response(self, item, occurrence_at=None):
        data = {key: getattr(item, key) for key in ("id", "title", "notes", "start_at", "end_at", "timezone", "all_day", "source", "connection_id", "external_read_only", "version", "created_at", "updated_at")}
        if occurrence_at is not None:
            data["start_at"] = occurrence_at
            data["end_at"] = effective_time(item.end_at, item.start_at, occurrence_at, item.timezone)
        return CalendarEventResponse(**data, recurrence=self.recurrence_response(item, item.start_at), occurrence_at=occurrence_at)

    def list_response(self, item):
        counts = self.session.execute(select(func.count(ListItem.id), func.count(ListItem.id).filter(ListItem.checked.is_(True))).where(ListItem.list_id == item.id, ListItem.user_id == self.user.id, ListItem.deleted_at.is_(None))).one()
        return PlanningListResponse(**{key: getattr(item, key) for key in ("id", "name", "kind", "is_system", "version", "created_at", "updated_at")}, is_editable=(item.is_system or EntitlementService.is_pro(self.user)), item_count=counts[0], completed_count=counts[1])

    @staticmethod
    def list_item_response(item):
        return ListItemResponse.model_validate(item)

    @staticmethod
    def occurrence_response(item, occurrence_at=None, record=None):
        return TaskOccurrenceResponse(task_id=item.id, occurrence_at=occurrence_at, status=record.status if record else ("completed" if item.completed_at else "pending"), completed_at=record.completed_at if record else item.completed_at, effective_start_at=effective_time(item.start_at, anchor(item), occurrence_at, item.timezone), effective_due_at=effective_time(item.due_at, anchor(item), occurrence_at, item.timezone))

    def calendar_range(self, lower, upper, timezone):
        tz = zone(timezone)
        if lower.tzinfo is None or upper.tzinfo is None or upper <= lower or upper - lower > timedelta(days=93):
            raise AppError(422, "invalid_or_large_range", "Use an increasing range of at most 93 days")
        task_results = []
        event_results = []
        tasks = self.session.scalars(self.tasks.query().where(or_(Task.rrule.is_not(None), Task.start_at < upper, Task.due_at < upper)))
        for item in tasks:
            base = anchor(item)
            if base is None:
                continue
            if item.rrule:
                duration = abs((item.due_at or base) - base) + timedelta(days=1)
                occurrences = RecurrenceService.between(item.rrule, base, item.timezone, lower - duration, upper)
                records = {record.occurrence_at: record for record in self.session.scalars(select(TaskOccurrence).where(TaskOccurrence.task_id == item.id, TaskOccurrence.user_id == self.user.id, TaskOccurrence.occurrence_at >= lower - duration, TaskOccurrence.occurrence_at < upper))}
            else:
                occurrences, records = [None], {}
            for occurrence in occurrences:
                result = self.occurrence_response(item, occurrence, records.get(occurrence))
                start = result.effective_start_at or result.effective_due_at
                end = result.effective_due_at or start
                if start < upper and (end > lower or start == end and end >= lower):
                    result.effective_start_at = result.effective_start_at.astimezone(tz) if result.effective_start_at else None
                    result.effective_due_at = result.effective_due_at.astimezone(tz) if result.effective_due_at else None
                    task_results.append(result)
                if len(task_results) + len(event_results) > MAX_OCCURRENCES:
                    raise AppError(422, "invalid_or_large_range", "Too many entries in this range")
        events = self.session.scalars(self.events.query().where(CalendarEvent.start_at < upper, or_(CalendarEvent.rrule.is_not(None), CalendarEvent.end_at > lower)))
        for item in events:
            if item.rrule:
                occurrences = RecurrenceService.between(item.rrule, item.start_at, item.timezone, lower - (item.end_at - item.start_at) - timedelta(days=1), upper)
                exceptions = set(self.session.scalars(select(EventException.occurrence_at).where(EventException.event_id == item.id, EventException.user_id == self.user.id)))
            else:
                occurrences, exceptions = [None], set()
            for occurrence in occurrences:
                if occurrence in exceptions:
                    continue
                result = self.event_response(item, occurrence)
                if result.start_at < upper and result.end_at > lower:
                    result.start_at = result.start_at.astimezone(tz)
                    result.end_at = result.end_at.astimezone(tz)
                    event_results.append(result)
                if len(task_results) + len(event_results) > MAX_OCCURRENCES:
                    raise AppError(422, "invalid_or_large_range", "Too many entries in this range")
        task_results.sort(key=lambda item: item.effective_start_at or item.effective_due_at)
        event_results.sort(key=lambda item: (item.start_at, str(item.id)))
        return {"from": lower, "to": upper, "timezone": timezone, "tasks": task_results, "events": event_results}


TaskService = PlanningService
CalendarQueryService = PlanningService
ListService = PlanningService
