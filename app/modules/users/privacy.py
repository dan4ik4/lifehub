import base64, csv, io, json, warnings, zipfile
from datetime import timedelta
from typing import Literal
from uuid import UUID
from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, Request, Response
from fastapi.encoders import jsonable_encoder
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import Field
from sqlalchemy import select, update, delete
from app.core.database import Base, utcnow
from app.core.dependencies import get_db
from app.core.errors import AppError
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User, RefreshSession
from app.modules.auth.passwords import password_hasher
from app.modules.auth.schemas import RequestModel
from app.modules.users.models import Avatar, DataExport

router = APIRouter(prefix="/api/v1/users/me", tags=["privacy"])


class AvatarInput(RequestModel):
    data: str = Field(max_length=900000)


class ExportInput(RequestModel):
    format: Literal["json", "csv"] = "json"


class DeleteInput(RequestModel):
    password: str = Field(min_length=1, max_length=1024)
    confirm: Literal["DELETE"]


@router.get("/avatar")
def avatar(user=Depends(get_current_user), db=Depends(get_db)):
    item = db.get(Avatar, user.id)
    return {"data": "data:image/jpeg;base64," + base64.b64encode(item.image).decode() if item else None}


@router.post("/avatar", status_code=204)
def save_avatar(body: AvatarInput, request: Request, user=Depends(get_current_user), db=Depends(get_db)):
    request.app.state.rate_limiter.hit("avatar:" + str(user.id), 20, 3600)
    try:
        if not body.data.startswith(("data:image/jpeg;base64,", "data:image/png;base64,", "data:image/webp;base64,")):
            raise ValueError()
        raw = base64.b64decode(body.data.split(",", 1)[1], validate=True)
        if len(raw) > 650000:
            raise ValueError()
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as source:
                if source.width * source.height > 16000000 or source.format not in ("JPEG", "PNG", "WEBP"):
                    raise ValueError()
                normalized = ImageOps.fit(ImageOps.exif_transpose(source).convert("RGB"), (256, 256))
                output = io.BytesIO()
                normalized.save(output, format="JPEG", quality=85)
    except (
        ValueError,
        UnidentifiedImageError,
        OSError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as error:
        raise AppError(422, "invalid_image", "Use a JPG, PNG or WebP image under 650 KB and 16 megapixels") from error
    item = db.get(Avatar, user.id)
    if item:
        item.image = output.getvalue()
    else:
        db.add(Avatar(user_id=user.id, image=output.getvalue()))
    db.commit()
    return Response(status_code=204)


@router.delete("/avatar", status_code=204)
def remove_avatar(user=Depends(get_current_user), db=Depends(get_db)):
    db.execute(delete(Avatar).where(Avatar.user_id == user.id))
    db.commit()
    return Response(status_code=204)


def export_info(item):
    return {
        "id": item.id,
        "format": item.format,
        "status": item.status if item.expires_at > utcnow() else "expired",
        "expires_at": item.expires_at,
        "created_at": item.created_at,
    }


@router.post("/exports", status_code=202)
def request_export(body: ExportInput, request: Request, user=Depends(get_current_user), db=Depends(get_db)):
    request.app.state.rate_limiter.hit("export:" + str(user.id), 3, 86400)
    item = DataExport(user_id=user.id, format=body.format, expires_at=utcnow() + timedelta(days=1))
    db.add(item)
    db.commit()
    return export_info(item)


@router.get("/exports")
def exports(user=Depends(get_current_user), db=Depends(get_db)):
    return {
        "items": [
            export_info(i)
            for i in db.scalars(
                select(DataExport)
                .where(DataExport.user_id == user.id, DataExport.expires_at > utcnow())
                .order_by(DataExport.created_at.desc())
                .limit(10)
            )
        ]
    }


@router.get("/exports/{export_id}")
def download(export_id: UUID, request: Request, user=Depends(get_current_user), db=Depends(get_db)):
    item = db.scalar(select(DataExport).where(DataExport.id == export_id, DataExport.user_id == user.id))
    if item is None:
        raise AppError(404, "not_found", "Export not found")
    if item.expires_at <= utcnow():
        raise AppError(410, "export_expired", "Request a new export")
    if item.status != "ready":
        raise AppError(409, "export_not_ready", "Export is not ready")
    raw = Fernet(request.app.state.settings.encryption_key.encode()).decrypt(item.encrypted_data)
    return {
        **export_info(item),
        "data": base64.b64encode(raw).decode(),
        "filename": "lifehub-export." + ("json" if item.format == "json" else "zip"),
        "mime": "application/json" if item.format == "json" else "application/zip",
    }


@router.delete("", status_code=204)
def delete_account(body: DeleteInput, request: Request, user=Depends(get_current_user), db=Depends(get_db)):
    request.app.state.rate_limiter.hit("delete-account:" + str(user.id), 5, 3600)
    user = db.scalar(select(User).where(User.id == user.id).with_for_update())
    if not user.password_hash:
        raise AppError(409, "social_reauth_required", "Social account deletion needs provider reauthentication")
    if not password_hasher.verify(body.password, user.password_hash):
        raise AppError(400, "invalid_password", "Incorrect password")
    user.deleted_at = utcnow()
    db.execute(
        update(RefreshSession)
        .where(RefreshSession.user_id == user.id, RefreshSession.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )
    db.commit()
    return Response(status_code=204)


# Explicit allowlist prevents future auth/token tables from silently entering an export.
EXPORT_TABLES = {
    "tasks",
    "task_occurrences",
    "calendar_events",
    "event_exceptions",
    "planning_lists",
    "list_items",
    "planning_reminders",
    "goals",
    "goal_milestones",
    "habits",
    "habit_checkins",
    "health_sleep",
    "health_weight",
    "health_workouts",
    "health_nutrition",
    "health_medications",
    "health_medication_intakes",
    "finance_transactions",
    "finance_budgets",
    "finance_subscriptions",
    "finance_savings",
    "finance_savings_history",
    "finance_goals",
    "finance_debts",
    "finance_debt_payments",
    "books",
    "diary_entries",
    "health_programs",
    "health_weight_targets",
}


def collect_data(db, user):
    result = {
        "profile": {
            "id": str(user.id),
            "name": user.name,
            "email": user.email,
            "timezone": user.timezone,
            "weight_unit": user.weight_unit,
            "plan": user.plan,
            "free_modules": user.free_modules,
        },
        "exported_at": utcnow().isoformat(),
    }
    for name in sorted(EXPORT_TABLES):
        table = Base.metadata.tables[name]
        columns = [
            c for c in table.c if c.name not in ("user_id", "lease_token", "lease_until", "delivery_key", "last_error")
        ]
        rows = db.execute(select(*columns).where(table.c.user_id == user.id)).mappings().all()
        result[name] = jsonable_encoder([dict(r) for r in rows], custom_encoder={__import__("decimal").Decimal: str})
    from app.modules.goals_habits.models import GoalTaskLink, Goal

    result["goal_task_links"] = [
        {"goal_id": str(g), "task_id": str(t)}
        for g, t in db.execute(
            select(GoalTaskLink.goal_id, GoalTaskLink.task_id)
            .join(Goal, Goal.id == GoalTaskLink.goal_id)
            .where(Goal.user_id == user.id)
        )
    ]
    avatar = db.get(Avatar, user.id)
    if avatar:
        result["avatar_jpeg_base64"] = base64.b64encode(avatar.image).decode()
    return result


def make_export(data, format):
    if format == "json":
        return json.dumps(data, ensure_ascii=False, indent=2).encode()
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "profile.json",
            json.dumps({"profile": data["profile"], "exported_at": data["exported_at"]}, ensure_ascii=False),
        )
        for name, rows in data.items():
            if not isinstance(rows, list) or not rows:
                continue
            stream = io.StringIO()
            writer = csv.DictWriter(stream, fieldnames=rows[0].keys())
            writer.writeheader()
            for row in rows:
                safe = {}
                for k, v in row.items():
                    value = (
                        json.dumps(v, ensure_ascii=False)
                        if isinstance(v, (list, dict))
                        else ""
                        if v is None
                        else str(v)
                    )
                    safe[k] = "'" + value if value.lstrip().startswith(("=", "+", "-", "@")) else value
                writer.writerow(safe)
            archive.writestr(name + ".csv", stream.getvalue().encode("utf-8-sig"))
        if data.get("avatar_jpeg_base64"):
            archive.writestr("avatar.jpg", base64.b64decode(data["avatar_jpeg_base64"]))
    return output.getvalue()


def run_privacy_jobs(db, settings):
    now = utcnow()
    db.execute(delete(DataExport).where(DataExport.expires_at <= now))
    item = db.scalar(
        select(DataExport)
        .where(DataExport.status == "queued", DataExport.expires_at > now)
        .order_by(DataExport.created_at)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if item:
        user = db.get(User, item.user_id)
        if not user or user.deleted_at:
            item.status = "cancelled"
        else:
            raw = make_export(collect_data(db, user), item.format)
            if len(raw) > 50_000_000:
                item.status = "too_large"
            else:
                item.encrypted_data = Fernet(settings.encryption_key.encode()).encrypt(raw)
                item.status = "ready"
    ready = db.scalar(
        select(DataExport)
        .where(
            DataExport.status == "ready",
            DataExport.notified.is_(False),
            DataExport.notification_attempts < 5,
            DataExport.notification_retry_at <= now,
            DataExport.expires_at > now,
        )
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if ready:
        user = db.get(User, ready.user_id)
        if user and not user.deleted_at:
            from app.modules.auth.email import build_email_sender

            sender = build_email_sender(settings)
            ready.notification_attempts += 1
            ready.notification_retry_at = now + timedelta(minutes=2**ready.notification_attempts)
            try:
                sender.send_export_ready(user.email, str(ready.id))
                ready.notified = True
            except AppError:
                pass
            finally:
                if hasattr(sender, "close"):
                    sender.close()
    # Reverse FK order lets cascade-only child tables follow their owning records.
    expired = list(
        db.scalars(
            select(User.id)
            .where(User.deleted_at <= now - timedelta(days=30))
            .limit(10)
            .with_for_update(skip_locked=True)
        )
    )
    for uid in expired:
        for table in reversed(Base.metadata.sorted_tables):
            if table.name != "users" and "user_id" in table.c:
                db.execute(table.delete().where(table.c.user_id == uid))
        db.execute(delete(User).where(User.id == uid))
    db.commit()
    return {"export_processed": bool(item), "accounts_purged": len(expired)}
