import hashlib
from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import delete
from app.core.dependencies import get_db, get_settings
from app.modules.auth.dependencies import get_current_user
from app.modules.notifications.models import PushSubscription
from app.modules.notifications.service import SubscribeRequest, UnsubscribeRequest, configured, subscribe

router = APIRouter(prefix="/api/v1/notifications/push", tags=["notifications"])


@router.get("/config")
def config(user=Depends(get_current_user), settings=Depends(get_settings)):
    return {
        "enabled": configured(settings),
        "public_key": settings.webpush_public_key if configured(settings) else None,
    }


@router.post("/subscriptions", status_code=201)
def register(
    body: SubscribeRequest,
    request: Request,
    user=Depends(get_current_user),
    db=Depends(get_db),
    settings=Depends(get_settings),
):
    request.app.state.rate_limiter.hit("push-subscribe:" + str(user.id), 30, 3600)
    return subscribe(db, user, body, settings)


@router.delete("/subscriptions", status_code=204)
def unregister(body: UnsubscribeRequest, user=Depends(get_current_user), db=Depends(get_db)):
    digest = hashlib.sha256(body.endpoint.encode()).hexdigest()
    db.execute(
        delete(PushSubscription).where(PushSubscription.user_id == user.id, PushSubscription.endpoint_hash == digest)
    )
    db.commit()
    return Response(status_code=204)
