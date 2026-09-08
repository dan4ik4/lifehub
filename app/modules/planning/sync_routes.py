from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response

from app.core.dependencies import get_db, get_settings
from app.modules.planning.dependencies import require_planning_user, require_pro
from app.modules.planning.sync import CalendarSyncService, job_response
from app.modules.planning.sync_schemas import (
    AppleAcceptedResponse, AppleAckRequest, AppleDeltaRequest, AppleOutboxResponse,
    CalendarAuthUrlResponse, CalendarCallbackRequest, CalendarConnectRequest,
    CalendarConnectionCollectionResponse, CalendarConnectionResponse,
    CalendarSyncJobResponse, CalendarSyncRequest,
)

router = APIRouter(prefix="/api/v1/planning", tags=["calendar-sync"])


def service(request: Request, db=Depends(get_db), settings=Depends(get_settings)):
    return CalendarSyncService(db, settings, getattr(request.app.state, "calendar_provider_factory", None))


def pro_user(user=Depends(require_planning_user)):
    require_pro(user)
    return user


@router.get("/calendar-connections", response_model=CalendarConnectionCollectionResponse)
def connections(user=Depends(pro_user), sync=Depends(service)):
    return {"items": sync.list_connections(user.id)}


@router.post("/calendar-connections/{provider}/start", response_model=CalendarAuthUrlResponse)
def start(provider: Literal["google", "apple"], body: CalendarConnectRequest, user=Depends(pro_user), sync=Depends(service)):
    return sync.start(user.id, provider, body)


@router.post("/calendar-connections/{provider}/callback", status_code=201, response_model=CalendarConnectionResponse)
def callback(provider: Literal["google", "apple"], body: CalendarCallbackRequest, user=Depends(pro_user), sync=Depends(service)):
    return sync.callback(user.id, provider, body)


@router.post("/calendar-connections/{connection_id}/sync", status_code=202, response_model=CalendarSyncJobResponse)
def manual_sync(connection_id: UUID, body: CalendarSyncRequest, user=Depends(pro_user), sync=Depends(service)):
    return job_response(sync.enqueue(user.id, connection_id))


@router.get("/calendar-connections/{connection_id}/sync/{job_id}", response_model=CalendarSyncJobResponse)
def sync_status(connection_id: UUID, job_id: UUID, user=Depends(pro_user), sync=Depends(service)):
    return job_response(sync.job(user.id, connection_id, job_id))


@router.delete("/calendar-connections/{connection_id}", status_code=204)
def disconnect(connection_id: UUID, user=Depends(require_planning_user), sync=Depends(service)):
    # An expired subscription must still be able to disconnect an integration.
    sync.disconnect(user.id, connection_id)
    return Response(status_code=204)


@router.get("/calendar-connections/{connection_id}/device/outbox", response_model=AppleOutboxResponse)
def apple_outbox(connection_id: UUID, device_id: str = Query(min_length=1, max_length=128), user=Depends(pro_user), sync=Depends(service)):
    return sync.outbox(user.id, connection_id, device_id)


@router.post("/calendar-connections/{connection_id}/device/ack", response_model=AppleAcceptedResponse)
def apple_ack(connection_id: UUID, body: AppleAckRequest, user=Depends(pro_user), sync=Depends(service)):
    return sync.acknowledge(user.id, connection_id, body)


@router.post("/calendar-connections/{connection_id}/device/deltas", status_code=202, response_model=AppleAcceptedResponse)
def apple_deltas(connection_id: UUID, body: AppleDeltaRequest, user=Depends(pro_user), sync=Depends(service)):
    return sync.receive_deltas(user.id, connection_id, body)
