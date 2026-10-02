import base64
import hashlib
import json
from urllib.parse import urlsplit
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.asymmetric import ec
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from app.core.errors import AppError
from app.modules.notifications.models import PushSubscription


def valid_endpoint(value):
    u = urlsplit(value)
    host = (u.hostname or "").lower()
    allowed = (
        host in {"fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"}
        or host.endswith(".push.services.mozilla.com")
        or host.endswith(".notify.windows.com")
    )
    if u.scheme != "https" or not allowed or u.username or u.password or u.port not in (None, 443) or u.fragment:
        raise ValueError("Unsupported push service endpoint")
    return value


class PushKeys(BaseModel):
    model_config = ConfigDict(extra="forbid")
    p256dh: str = Field(min_length=80, max_length=100, pattern=r"^[A-Za-z0-9_-]+=*$")
    auth: str = Field(min_length=20, max_length=30, pattern=r"^[A-Za-z0-9_-]+=*$")

    @field_validator("p256dh", "auth")
    @classmethod
    def valid_key(cls, value, info):
        try:
            raw = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
            if info.field_name == "p256dh":
                ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), raw)
            elif len(raw) != 16:
                raise ValueError("Invalid authentication key")
        except Exception as exc:
            raise ValueError("Invalid subscription key") from exc
        return value


class SubscribeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    endpoint: str = Field(max_length=4096)
    keys: PushKeys
    expirationTime: float | None = None
    _endpoint = field_validator("endpoint")(valid_endpoint)


class UnsubscribeRequest(BaseModel):
    endpoint: str = Field(max_length=4096)


def configured(settings):
    return bool(settings.webpush_public_key and settings.webpush_private_key and settings.webpush_subject)


def subscribe(db, user, body, settings):
    if not configured(settings):
        raise AppError(503, "provider_unavailable", "Web Push is not configured")
    # Serialize the per-user cap and concurrent subscription updates.
    from app.modules.auth.models import User

    db.scalar(select(User).where(User.id == user.id).with_for_update())
    digest = hashlib.sha256(body.endpoint.encode()).hexdigest()
    item = db.scalar(select(PushSubscription).where(PushSubscription.endpoint_hash == digest))
    if item and item.user_id != user.id:
        raise AppError(409, "push_device_in_use", "Unsubscribe this browser before connecting another account")
    if item is None:
        if (
            db.scalar(select(func.count()).select_from(PushSubscription).where(PushSubscription.user_id == user.id))
            >= 10
        ):
            raise AppError(409, "push_device_limit", "Maximum of ten notification devices reached")
        item = PushSubscription(user_id=user.id, endpoint_hash=digest)
        db.add(item)
    item.encrypted_subscription = (
        Fernet(settings.encryption_key.encode()).encrypt(body.model_dump_json().encode()).decode()
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AppError(409, "push_device_in_use", "This browser subscription is already registered") from exc
    return {"id": str(item.id)}


class WebPushReminderDelivery:
    def __init__(self, session, settings, sender=None):
        self.session, self.settings, self.sender = session, settings, sender

    def deliver(self, *, reminder, user, entity, idempotency_key):
        from app.modules.planning.reminders import HttpReminderDelivery

        if reminder.channel != "push" or (
            self.settings.reminder_webhook_url and not hasattr(entity, "notification_url")
        ):
            return HttpReminderDelivery(self.settings).deliver(
                reminder=reminder, user=user, entity=entity, idempotency_key=idempotency_key
            )
        if not configured(self.settings):
            raise AppError(503, "provider_unavailable", "Web Push is not configured")
        subscriptions = list(self.session.scalars(select(PushSubscription).where(PushSubscription.user_id == user.id)))
        if not subscriptions:
            raise AppError(503, "push_no_device", "No device subscribed to notifications")
        from pywebpush import webpush, WebPushException
        import requests

        class NoRedirectSession(requests.Session):
            def request(self, *args, **kwargs):
                kwargs["allow_redirects"] = False
                return super().request(*args, **kwargs)

        sender = self.sender or webpush
        delivered = 0
        for item in subscriptions:
            data = json.loads(
                Fernet(self.settings.encryption_key.encode()).decrypt(item.encrypted_subscription.encode())
            )
            valid_endpoint(data["endpoint"])
            try:
                # Generic content avoids exposing private plans on a shared lock screen.
                with NoRedirectSession() as http:
                    sender(
                        subscription_info=data,
                        data=json.dumps(
                            {
                                "title": "Life Hub",
                                "body": "Пришло время запланированного дела. Откройте ваши планы.",
                                "tag": idempotency_key,
                                "url": getattr(entity, "notification_url", "/planning"),
                            }
                        ),
                        vapid_private_key=self.settings.webpush_private_key,
                        vapid_claims={"sub": self.settings.webpush_subject},
                        ttl=3600,
                        timeout=10,
                        requests_session=http,
                    )
                delivered += 1
            except (WebPushException, requests.RequestException) as exc:
                if getattr(exc, "response", None) is not None and exc.response.status_code in (404, 410):
                    self.session.delete(item)
                # Do not persist provider error text, endpoint or key material.
        if not delivered:
            raise AppError(502, "push_delivery_failed", "Notification could not be delivered")
