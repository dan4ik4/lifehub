import base64
import json
from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, func, or_, select

from app.core.errors import AppError
from app.modules.planning.models import CalendarEvent, ListItem, PlanningList, Reminder, Task


class OwnerCrud:
    model = None

    def __init__(self, session, user_id):
        self.session = session
        self.user_id = user_id

    def query(self):
        return select(self.model).where(self.model.user_id == self.user_id, self.model.deleted_at.is_(None))

    def get(self, object_id, *, lock=False):
        statement = self.query().where(self.model.id == object_id)
        if lock:
            statement = statement.with_for_update()
        item = self.session.scalar(statement)
        if item is None:
            raise AppError(404, "not_found", "Resource not found")
        return item

    def page(self, statement=None, cursor=None, limit=50, *, position=False):
        statement = statement if statement is not None else self.query()
        total = self.session.scalar(select(func.count()).select_from(statement.subquery()))
        order_column = self.model.position if position else self.model.created_at
        if cursor:
            try:
                payload = json.loads(base64.urlsafe_b64decode(cursor.encode("ascii") + b"=" * (-len(cursor) % 4)))
                # Bind cursors to collection and owner; no cross-user cursor reuse.
                if payload["owner"] != str(self.user_id) or payload["model"] != self.model.__tablename__:
                    raise ValueError()
                marker = int(payload["value"]) if position else datetime.fromisoformat(payload["value"])
                marker_id = UUID(payload["id"])
            except (ValueError, KeyError, TypeError, UnicodeError) as exc:
                raise AppError(422, "invalid_cursor", "Invalid pagination cursor") from exc
            statement = statement.where(or_(order_column > marker, and_(order_column == marker, self.model.id > marker_id)))
        rows = list(self.session.scalars(statement.order_by(order_column, self.model.id).limit(limit + 1)))
        next_cursor = None
        if len(rows) > limit:
            rows = rows[:limit]
            value = rows[-1].position if position else rows[-1].created_at.isoformat()
            next_cursor = base64.urlsafe_b64encode(json.dumps({"owner": str(self.user_id), "model": self.model.__tablename__, "value": value, "id": str(rows[-1].id)}).encode()).decode().rstrip("=")
        return rows, next_cursor, total


class TaskCrud(OwnerCrud):
    model = Task


class CalendarEventCrud(OwnerCrud):
    model = CalendarEvent


class ListCrud(OwnerCrud):
    model = PlanningList


class ListItemCrud(OwnerCrud):
    model = ListItem


class ReminderCrud:
    def __init__(self, session, user_id):
        self.session, self.user_id = session, user_id

    def for_entity(self, entity_type, entity_id):
        return list(self.session.scalars(select(Reminder).where(Reminder.user_id == self.user_id, Reminder.entity_type == entity_type, Reminder.entity_id == entity_id, Reminder.cancelled_at.is_(None))))
