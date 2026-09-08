from concurrent.futures import ThreadPoolExecutor

import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import AppError
from app.core.rate_limits import MemoryRateLimiter


def test_health_and_validation_no_secrets(client):
    assert client.get('/health/live').json() == {'status': 'ok'}
    assert client.get('/health/ready').json() == {'status': 'ok'}
    response = client.post('/api/v1/auth/login', json={'email': 'bad', 'password': 'TOP-SECRET-DO-NOT-ECHO', 'token': 'SECRET_TOKEN'})
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'validation_error'
    assert response.json()['error']['details']
    assert 'TOP-SECRET' not in response.text and 'SECRET_TOKEN' not in response.text
    assert response.json()['trace_id'] == response.headers['X-Trace-ID']
    assert response.headers['Cache-Control'] == 'no-store'


def test_404_and_405_use_envelope(client):
    assert client.get('/api/v1/unknown').json()['error']['code'] == 'not_found'
    assert client.get('/api/v1/auth/login').json()['error']['code'] == 'method_not_allowed'


def test_rate_counter_is_atomic():
    limiter = MemoryRateLimiter()
    def hit(_):
        try:
            limiter.hit('same-key', 5, 60)
            return True
        except AppError as error:
            assert error.status_code == 429 and int(error.headers['Retry-After']) > 0
            return False
    with ThreadPoolExecutor(max_workers=10) as pool:
        assert sum(pool.map(hit, range(30))) == 5


def test_runtime_rejects_weak_secrets():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, environment='production', jwt_secret='short', otp_secret='short')


def test_oversized_body_rejected_before_auth(client):
    response = client.post('/api/v1/auth/login', content='x' * 1_048_577)
    assert response.status_code == 413
    assert response.json()['error']['code'] == 'request_too_large'
