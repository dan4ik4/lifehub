import os
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.core.config import Settings


@pytest.fixture
def settings(tmp_path):
    database_url = f'sqlite:///{tmp_path / "test.db"}'
    admin_engine, schema = None, None
    if os.getenv('LIFEHUB_TEST_ALL_POSTGRES') == '1':
        from sqlalchemy import create_engine
        from sqlalchemy.engine import make_url
        from sqlalchemy.schema import CreateSchema, DropSchema
        url = make_url(os.environ['LIFEHUB_TEST_DATABASE_URL'])
        schema = 'test_' + uuid4().hex
        admin_engine = create_engine(url)
        with admin_engine.begin() as connection:
            connection.execute(CreateSchema(schema))
        database_url = url.update_query_dict({'options': '-csearch_path=' + schema}).render_as_string(hide_password=False)
    result = Settings(
        _env_file=None, environment='test', database_url=database_url,
        jwt_secret='test-jwt-secret-' + 'x' * 48, otp_secret='test-otp-secret-' + 'y' * 48,
        encryption_key=Fernet.generate_key().decode(), email_backend='memory',
        google_client_ids=['test-google-client'], apple_client_ids=['test-apple-client'],
        calendar_redirect_uris=['https://client.example/callback'],
        google_calendar_client_id='test-google-client', google_calendar_client_secret='test-google-secret',
        openai_api_key='',
    )
    try:
        yield result
    finally:
        if admin_engine is not None:
            with admin_engine.begin() as connection:
                connection.execute(DropSchema(schema, cascade=True))
            admin_engine.dispose()


@pytest.fixture
def app(settings):
    from app.main import create_app
    return create_app(settings)


@pytest.fixture
def client(app):
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def db(client, app):
    with app.state.session_factory() as session:
        yield session


@pytest.fixture
def make_user(db):
    from app.modules.auth.models import User
    def factory(**values):
        defaults = dict(name='Test User', email=f'{uuid4().hex}@example.com', email_verified=True,
                        plan='pro', free_modules=['planning', 'health', 'finance'], timezone='Europe/Warsaw',
                        onboarding_completed=True)
        defaults.update(values)
        user = User(**defaults)
        db.add(user)
        db.commit()
        return user
    return factory


@pytest.fixture
def auth_headers(app, settings):
    import jwt
    from datetime import timedelta
    from app.core.database import utcnow
    def factory(user):
        now = utcnow()
        token = jwt.encode({'sub': str(user.id), 'token_use': 'access', 'iat': now, 'exp': now + timedelta(minutes=15),
                            'iss': settings.jwt_issuer, 'aud': settings.jwt_audience, 'jti': uuid4().hex}, settings.jwt_secret, algorithm='HS256')
        return {'Authorization': f'Bearer {token}'}
    return factory
