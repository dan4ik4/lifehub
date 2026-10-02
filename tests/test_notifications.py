import base64
from types import SimpleNamespace
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from cryptography.fernet import Fernet
import pytest
from sqlalchemy import select
from app.core.errors import AppError
from app.modules.notifications.models import PushSubscription
from app.modules.notifications.service import SubscribeRequest, WebPushReminderDelivery, subscribe


def body(endpoint='https://fcm.googleapis.com/fcm/send/test-device'):
    key = ec.generate_private_key(ec.SECP256R1()).public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    enc = lambda data: base64.urlsafe_b64encode(data).decode().rstrip('=')
    return {'endpoint':endpoint,'keys':{'p256dh':enc(key),'auth':enc(b'a'*16)}}


def enable(settings):
    settings.webpush_public_key = 'test-public'
    settings.webpush_private_key = 'test-private'
    settings.webpush_subject = 'https://lifehapp.online'


def test_subscriptions_are_encrypted_idempotent_and_owner_scoped(client, db, settings, make_user, auth_headers):
    enable(settings)
    a,b = make_user(),make_user()
    value=body()
    first=client.post('/api/v1/notifications/push/subscriptions',headers=auth_headers(a),json=value)
    assert first.status_code==201,first.text
    again=client.post('/api/v1/notifications/push/subscriptions',headers=auth_headers(a),json=value)
    assert again.json()==first.json()
    record=db.scalar(select(PushSubscription))
    record_id=record.id
    assert value['endpoint'] not in record.encrypted_subscription
    assert value['endpoint'].encode() in Fernet(settings.encryption_key.encode()).decrypt(record.encrypted_subscription.encode())
    assert client.post('/api/v1/notifications/push/subscriptions',headers=auth_headers(b),json=value).status_code==409
    assert client.request('DELETE','/api/v1/notifications/push/subscriptions',headers=auth_headers(b),json={'endpoint':value['endpoint']}).status_code==204
    db.expire_all()
    assert db.get(PushSubscription,record_id) is not None
    assert client.request('DELETE','/api/v1/notifications/push/subscriptions',headers=auth_headers(a),json={'endpoint':value['endpoint']}).status_code==204
    db.expire_all()
    assert db.get(PushSubscription,record_id) is None


@pytest.mark.parametrize('endpoint',['http://fcm.googleapis.com/a','https://127.0.0.1/x','https://fcm.googleapis.com.evil.example/x','https://user:pass@fcm.googleapis.com/x','https://fcm.googleapis.com:444/x'])
def test_push_rejects_untrusted_endpoints(client, settings, make_user, auth_headers, endpoint):
    enable(settings)
    response=client.post('/api/v1/notifications/push/subscriptions',headers=auth_headers(make_user()),json=body(endpoint))
    assert response.status_code==422


def test_push_delivery_removes_expired_endpoint_without_marking_success(db, settings, make_user):
    from pywebpush import WebPushException
    enable(settings)
    user=make_user()
    subscribe(db,user,SubscribeRequest.model_validate(body()),settings)
    def expired(**kwargs):
        raise WebPushException('expired',response=SimpleNamespace(status_code=410))
    delivery=WebPushReminderDelivery(db,settings,sender=expired)
    with pytest.raises(AppError,match='Notification could not be delivered'):
        delivery.deliver(reminder=SimpleNamespace(channel='push'),user=user,entity=None,idempotency_key='test-delivery')
    db.commit()
    assert db.scalar(select(PushSubscription)) is None


def test_push_never_sends_another_users_subscription(db, settings, make_user):
    enable(settings)
    a,b=make_user(),make_user()
    subscribe(db,a,SubscribeRequest.model_validate(body()),settings)
    sent=[]
    delivery=WebPushReminderDelivery(db,settings,sender=lambda **kwargs:sent.append(kwargs))
    with pytest.raises(AppError):
        delivery.deliver(reminder=SimpleNamespace(channel='push'),user=b,entity=None,idempotency_key='test-delivery')
    assert sent==[]
    delivery.deliver(reminder=SimpleNamespace(channel='push'),user=a,entity=None,idempotency_key='test-delivery')
    assert len(sent)==1 and 'test-delivery' in sent[0]['data']
