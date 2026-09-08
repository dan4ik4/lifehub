import os
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.core.database import utcnow
from app.core.errors import AppError
from app.core.rate_limits import RedisRateLimiter
from app.modules.planning.command_models import PlanningAiUsage
from app.modules.planning.commands import AiChatRequest, PlanningCommandService
from app.modules.planning.models import Task
from app.modules.planning.schemas import TaskCreate, TaskUpdate
from app.modules.planning.service import PlanningService
from tests.test_commands import FakeModel


pytestmark = pytest.mark.postgres


def test_real_redis_atomic_limit():
    url = os.getenv('LIFEHUB_TEST_REDIS_URL')
    if not url:
        pytest.skip('Set LIFEHUB_TEST_REDIS_URL for Redis integration tests')
    limiter = RedisRateLimiter(url)
    key = 'integration:' + uuid4().hex
    def hit(_):
        try:
            limiter.hit(key, 5, 10)
            return True
        except AppError as error:
            assert error.status_code == 429
            return False
    try:
        with ThreadPoolExecutor(max_workers=10) as pool:
            assert sum(pool.map(hit, range(30))) == 5
    finally:
        limiter.close()


def test_postgres_optimistic_concurrent_task_update(app, db, make_user):
    if db.bind.dialect.name != 'postgresql':
        pytest.skip('Run scripts/check_postgres.py')
    import threading
    from sqlalchemy.orm.exc import StaleDataError
    user = make_user()
    task = PlanningService(db, user).create_task(TaskCreate(title='original'))
    barrier = threading.Barrier(2)
    def edit(title):
        with app.state.session_factory() as session:
            current = session.get(Task, task.id)
            assert current.version == 1
            barrier.wait(timeout=10)
            current.title = title
            current.updated_at = utcnow()
            try:
                session.commit()
                return 'ok'
            except StaleDataError:
                session.rollback()
                return 'conflict'
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(edit, ['first', 'second']))
    assert sorted(results) == ['conflict', 'ok']


def test_postgres_duplicate_ai_key_creates_one_resource(app, db, make_user):
    if db.bind.dialect.name != 'postgresql':
        pytest.skip('Run scripts/check_postgres.py')
    from app.modules.auth.models import User
    user = make_user()
    model = FakeModel({'type': 'create_task', 'payload': {'title': 'Once only'}})
    def execute(_):
        with app.state.session_factory() as session:
            current = session.get(User, user.id)
            try:
                return PlanningCommandService(session, current, model).run(AiChatRequest(message='create'), 'same').message_id
            except AppError as error:
                assert error.code == 'command_running'
                return None
    with ThreadPoolExecutor(max_workers=5) as pool:
        list(pool.map(execute, range(5)))
    assert model.calls == 1
    assert db.scalar(select(func.count()).select_from(Task)) == 1
    assert db.scalar(select(PlanningAiUsage.count).where(PlanningAiUsage.user_id == user.id)) == 1
