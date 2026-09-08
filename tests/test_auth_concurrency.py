"""Run against an isolated PostgreSQL schema; SQLite cannot test row locks."""
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker

from app.core.database import Base, utcnow
from app.core.errors import AppError
from app.modules.auth.email import MemoryEmailSender
from app.modules.auth.models import PasswordResetToken, RefreshSession, User
from app.modules.auth.otp import OtpService
from app.modules.auth.passwords import password_hasher
from app.modules.auth.schemas import ResetPasswordRequest
from app.modules.auth.service import AuthService
from app.modules.auth.tokens import TokenService


pytestmark = pytest.mark.postgres


@pytest.fixture
def postgres_sessions(settings):
    url = os.getenv("LIFEHUB_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set LIFEHUB_TEST_DATABASE_URL to run PostgreSQL concurrency tests")
    if not url.startswith("postgresql"):
        pytest.fail("Concurrency tests require PostgreSQL")
    schema = "test_auth_" + uuid4().hex
    engine = create_engine(url, connect_args={"options": "-c lock_timeout=10000 -c statement_timeout=15000"})
    with engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    test_engine = engine.execution_options(schema_translate_map={None: schema})
    try:
        Base.metadata.create_all(test_engine)
        yield sessionmaker(bind=test_engine, expire_on_commit=False)
    finally:
        with engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        engine.dispose()


def initial_session(factory, settings):
    with factory() as db:
        user = User(email="concurrency@example.com", name="Concurrency", password_hash=password_hasher.hash("OldPassword1"), email_verified=True)
        db.add(user)
        db.flush()
        token = TokenService(db, settings).issue(user)
        db.commit()
        return user.id, token.refresh_token


def test_concurrent_refresh_has_one_winner_and_reuse_revokes_replacement(postgres_sessions, settings):
    user_id, token = initial_session(postgres_sessions, settings)
    barrier = threading.Barrier(2)
    def refresh():
        with postgres_sessions() as db:
            barrier.wait(timeout=10)
            try:
                return TokenService(db, settings).refresh(token)
            except AppError as exc:
                return exc
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(refresh) for _ in range(2)]
        results = [future.result(timeout=25) for future in futures]
    assert sum(not isinstance(result, AppError) for result in results) == 1
    assert [result.status_code for result in results if isinstance(result, AppError)] == [401]
    with postgres_sessions() as db:
        sessions = db.scalars(select(RefreshSession).where(RefreshSession.user_id == user_id)).all()
        assert len(sessions) == 2 and all(session.revoked_at is not None for session in sessions)


def test_password_reset_cannot_miss_a_concurrent_refresh_replacement(postgres_sessions, settings):
    user_id, token = initial_session(postgres_sessions, settings)
    with postgres_sessions() as db:
        challenge_id = uuid4()
        db.add(PasswordResetToken(id=challenge_id, user_id=user_id,
            token_hash=OtpService(settings.otp_secret).hash(f"reset:{challenge_id}", "123456"),
            expires_at=utcnow() + timedelta(minutes=10), last_sent_at=utcnow()))
        db.commit()
    barrier = threading.Barrier(2)
    def refresh():
        with postgres_sessions() as db:
            barrier.wait(timeout=10)
            try:
                TokenService(db, settings).refresh(token)
            except AppError as exc:
                assert exc.status_code == 401
    def reset():
        with postgres_sessions() as db:
            barrier.wait(timeout=10)
            AuthService(db, settings, MemoryEmailSender()).reset_password(ResetPasswordRequest(
                email="concurrency@example.com", code="123456", new_password="NewPassword2"))
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(refresh), pool.submit(reset)]
        for future in futures:
            future.result(timeout=25)
    with postgres_sessions() as db:
        sessions = db.scalars(select(RefreshSession).where(RefreshSession.user_id == user_id)).all()
        assert all(session.revoked_at is not None for session in sessions)
        assert password_hasher.verify("NewPassword2", db.get(User, user_id).password_hash)
