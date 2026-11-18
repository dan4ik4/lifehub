from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select
from app.core.errors import AppError
from app.modules.dashboard import insight_data
from app.modules.dashboard.insights import Selection, generate
from app.modules.dashboard.insight_models import CrossReview
from app.modules.finance.models import Transaction
from app.modules.health.models import SleepEntry, Workout, HealthConnection, HealthDaily
from app.modules.books.models import DiaryEntry
from app.modules.planning.models import Task, TaskOccurrence
from app.modules.goals_habits.models import Habit, HabitCheckin
from app.modules.planning.command_models import PlanningAiUsage

BASE = '/api/v1/dashboard/insights'
NOW = datetime(2026, 11, 18, 12, tzinfo=UTC)
END = date(2026, 11, 17)


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    monkeypatch.setattr(insight_data, 'utcnow', lambda: NOW)


class Provider:
    def __init__(self):
        self.calls, self.data = 0, None

    def __call__(self, data):
        self.calls += 1
        self.data = data
        return {'comparison_ids': [data['comparisons'][0]['id']]}


def seed(db, user, count=8):
    for index in range(count):
        day = END - timedelta(days=7-index)
        end = datetime.combine(day, datetime.min.time(), UTC) + timedelta(hours=8)
        hours = 6 if index < 4 else 8
        db.add(SleepEntry(user_id=user.id, start_at=end-timedelta(hours=hours), end_at=end, quality=3))
        db.add(Transaction(user_id=user.id, day=day, kind='expense', amount=Decimal('20' if index < 4 else '10'),
            currency='PLN', category='other', title='PRIVATE MERCHANT', notes='PRIVATE FINANCE NOTE'))
        db.add(DiaryEntry(user_id=user.id, day=day, title='PRIVATE DIARY TITLE', text='PRIVATE DIARY TEXT'))
    db.commit()


def setup(client, app, db, make_user, auth_headers, count=8):
    user = make_user(chat_preferences={'messages': True, 'modules': True})
    seed(db, user, count)
    provider = Provider()
    app.state.cross_review_provider = provider
    return user, auth_headers(user), provider


def read(client, h, modules=None, **changes):
    return client.get(BASE, headers=h, params={'end_day': str(END), 'days': 14,
        'modules': modules if modules is not None else ['health', 'finance'], 'currency': 'PLN', **changes})


def send(client, h, data, **changes):
    return client.post(BASE, headers=h, json={key: data[key] for key in ('end_day', 'days', 'modules', 'currency', 'source_hash')} | {'consent': True} | changes)


def test_comparison_is_exact_missing_days_not_zero_and_evidence(client, app, db, make_user, auth_headers):
    _, h, provider = setup(client, app, db, make_user, auth_headers)
    response = read(client, h)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data['start_day'] == '2026-11-04' and data['end_day'] == str(END)
    candidate = next(c for c in data['comparisons'] if c['x'] == 'sleep_hours')
    assert candidate['paired_days'] == 8 and candidate['lower_days'] == candidate['upper_days'] == 4
    assert candidate['threshold'] == '7' and candidate['lower_average'] == '20.00' and candidate['upper_average'] == '10.00'
    assert len(candidate['evidence']) == 8 and candidate['evidence'][0]['day'] == '2026-11-10'
    assert 'не доказательство' in candidate['text']
    assert 'PRIVATE' not in str(data)
    assert provider.calls == 0
    assert next(m for m in data['metrics'] if m['key'] == 'expenses')['recorded_days'] == 8


def test_scope_owner_currency_and_no_queries_for_unselected_health(client, app, db, make_user, auth_headers):
    user, h, _ = setup(client, app, db, make_user, auth_headers)
    other = make_user()
    seed(db, other)
    from sqlalchemy import event
    statements = []
    def capture(connection, cursor, statement, parameters, context, many):
        statements.append(statement)
    event.listen(app.state.engine, 'before_cursor_execute', capture)
    try:
        result = read(client, h, modules=['finance', 'books'])
    finally:
        event.remove(app.state.engine, 'before_cursor_execute', capture)
    data = result.json()
    assert all(m['module'] != 'health' for m in data['metrics'])
    assert not any('health_sleep' in sql or 'health_device_days' in sql or 'health_workouts' in sql for sql in statements)
    assert not any('diary_entries.text' in sql or 'finance_transactions.notes' in sql or 'finance_transactions.title' in sql for sql in statements)
    assert next(m for m in data['metrics'] if m['key'] == 'expenses')['recorded_days'] == 8
    eur = read(client, h, currency='EUR').json()
    assert next(m for m in eur['metrics'] if m['key'] == 'expenses')['values'] == {}
    assert eur['comparisons'] == []
    assert read(client, auth_headers(make_user())).json()['comparisons'] == []


def test_insufficient_paired_days_and_no_variation_do_not_call_ai(client, app, db, make_user, auth_headers):
    user, h, provider = setup(client, app, db, make_user, auth_headers, count=7)
    data = read(client, h).json()
    assert not data['comparisons']
    assert send(client, h, data).status_code == 422
    for sleep in db.scalars(select(SleepEntry).where(SleepEntry.user_id == user.id)):
        sleep.start_at = sleep.end_at - timedelta(hours=8)
    for tx in db.scalars(select(Transaction).where(Transaction.user_id == user.id)):
        tx.amount = Decimal('10')
    end = datetime(2026, 11, 17, 8, tzinfo=UTC)
    db.add(SleepEntry(user_id=user.id, start_at=end-timedelta(hours=8), end_at=end, quality=3))
    db.add(Transaction(user_id=user.id, day=END, kind='expense', amount=Decimal('10'), currency='PLN', category='other', title='same', notes=''))
    db.commit()
    assert read(client, h).json()['comparisons'] == []
    assert provider.calls == 0
    assert db.scalar(select(func.count()).select_from(PlanningAiUsage)) == 0


def test_cache_quota_scopes_and_unsupported_selection(client, app, db, make_user, auth_headers):
    user, h, provider = setup(client, app, db, make_user, auth_headers)
    data = read(client, h).json()
    response = send(client, h, data)
    assert response.status_code == 200, response.text
    rid = response.json()['review']['id']
    assert send(client, h, data).json()['review']['id'] == rid
    assert read(client, h, modules=['finance', 'health']).json()['review']['id'] == rid
    assert provider.calls == 1
    assert db.get(PlanningAiUsage, (user.id, datetime.now(UTC).date())).count == 1
    assert read(client, h, modules=['books', 'finance']).json()['review'] is None
    assert read(client, h, days=28).json()['review'] is None
    assert send(client, h, data, source_hash='0'*64).status_code == 409
    assert client.delete(BASE + '/' + rid, headers=h).status_code == 204
    app.state.cross_review_provider = lambda _: {'comparison_ids': ['invented']}
    assert send(client, h, data).status_code == 502
    assert db.scalar(select(CrossReview)).status == 'failed'


@pytest.mark.parametrize('modules', [['health'], ['health', 'health'], ['health', 'bad']])
def test_bad_scopes_and_dates_rejected(client, app, db, make_user, auth_headers, modules):
    _, h, _ = setup(client, app, db, make_user, auth_headers)
    assert read(client, h, modules=modules).status_code == 422
    assert read(client, h, end_day='2026-11-18').status_code == 422
    assert read(client, h, days=7).status_code == 422
    assert read(client, h, end_day='1900-01-01').status_code == 422


def test_rights_explicit_consent_and_preferences(client, app, db, make_user, auth_headers):
    _, h, provider = setup(client, app, db, make_user, auth_headers)
    data = read(client, h).json()
    assert send(client, h, data, consent=False).status_code == 422
    free = auth_headers(make_user(plan='free', free_modules=['health', 'finance']))
    assert read(client, free).status_code == 403
    assert send(client, free, data).status_code == 403
    assert client.patch('/api/v1/users/me/assistant-preferences', headers=h, json={'messages': True, 'modules': False}).status_code == 200
    assert send(client, h, data).status_code == 403
    assert provider.calls == 0


def test_changed_sources_hide_cache_and_mid_model_change_rejects(client, app, db, make_user, auth_headers):
    user, h, _ = setup(client, app, db, make_user, auth_headers)
    data = read(client, h).json()
    assert send(client, h, data).status_code == 200
    row = db.scalar(select(Transaction).where(Transaction.user_id == user.id))
    row.amount += 1
    db.commit()
    assert read(client, h).json()['review'] is None
    fresh = read(client, h).json()
    def change(value):
        with app.state.session_factory() as session:
            item = session.get(Transaction, row.id)
            item.deleted_at = NOW
            session.commit()
        return {'comparison_ids': [value['comparisons'][0]['id']]}
    app.state.cross_review_provider = change
    assert send(client, h, fresh).status_code == 409
    assert db.scalar(select(CrossReview)).status == 'failed'


def test_revoked_consent_during_model_never_saves(client, app, db, make_user, auth_headers):
    from app.modules.auth.models import User
    user, h, _ = setup(client, app, db, make_user, auth_headers)
    data = read(client, h).json()
    def revoke(value):
        with app.state.session_factory() as session:
            saved = session.get(User, user.id)
            saved.chat_preferences = {'messages': True, 'modules': False}
            session.commit()
        return {'comparison_ids': [value['comparisons'][0]['id']]}
    app.state.cross_review_provider = revoke
    assert send(client, h, data).status_code == 403
    assert db.scalar(select(CrossReview)).status == 'failed'


def test_manual_sleep_priority_and_disconnected_device(client, app, db, make_user, auth_headers):
    user, h, _ = setup(client, app, db, make_user, auth_headers)
    connection = HealthConnection(user_id=user.id, provider='health_connect', enabled=True, sync_token=uuid4(), revision=1)
    db.add(connection)
    db.add(HealthDaily(user_id=user.id, provider='health_connect', day=END, timezone=user.timezone, sleep_seconds=36000, steps=999, updated_at=NOW))
    db.add(HealthDaily(user_id=user.id, provider='health_connect', day=END-timedelta(days=8), timezone=user.timezone, sleep_seconds=28800, updated_at=NOW))
    db.commit()
    data = read(client, h).json()
    sleep = next(m for m in data['metrics'] if m['key'] == 'sleep_hours')
    assert sleep['values'][str(END)] == '8.00' and sleep['recorded_days'] == 9
    connection.enabled = False
    db.commit()
    data = read(client, h).json()
    assert next(m for m in data['metrics'] if m['key'] == 'sleep_hours')['recorded_days'] == 8
    # Overlapping manual records exclude the day instead of double counting/falling back.
    end = datetime(2026, 11, 17, 8, tzinfo=UTC)
    db.add(SleepEntry(user_id=user.id, start_at=end-timedelta(hours=2), end_at=end, quality=3))
    db.commit()
    data = read(client, h).json()
    assert str(END) not in next(m for m in data['metrics'] if m['key'] == 'sleep_hours')['values']
    assert any('Исключено дней' in note for note in data['notes'])


def test_planning_checkins_workouts_and_diary_only_counts(client, app, db, make_user, auth_headers):
    user, h, _ = setup(client, app, db, make_user, auth_headers)
    completed = datetime(2026, 11, 17, 20, tzinfo=UTC)
    task = Task(user_id=user.id, title='PRIVATE TASK', notes='PRIVATE NOTE', completed_at=completed)
    parent = Task(user_id=user.id, title='PRIVATE RECURRING', notes='', rrule='FREQ=DAILY')
    habit = Habit(user_id=user.id, title='PRIVATE HABIT', kind='boolean', target=Decimal(1), weekdays=list(range(7)))
    db.add_all([task, parent, habit]); db.flush()
    db.add(TaskOccurrence(user_id=user.id, task_id=parent.id, occurrence_at=completed, completed_at=completed, status='completed'))
    db.add(HabitCheckin(user_id=user.id, habit_id=habit.id, day=END, value=Decimal(0)))
    db.add(Workout(user_id=user.id, day=END, title='PRIVATE WORKOUT', notes='', minutes=30))
    db.commit()
    data = read(client, h, modules=['planning', 'goals_habits', 'health', 'books']).json()
    metric = {m['key']: m for m in data['metrics']}
    assert metric['tasks']['values'][str(END)] == '2.00'
    assert metric['habit_checkins']['values'][str(END)] == '1.00'
    assert metric['workout_minutes']['values'][str(END)] == '30.00'
    assert metric['diary_entries']['recorded_days'] == 8
    assert 'PRIVATE' not in str(data)


def test_shared_quota_retry_delete_owner_export_and_expiry(client, app, db, make_user, auth_headers, settings):
    from app.modules.users.privacy import collect_data, run_privacy_jobs
    user, h, provider = setup(client, app, db, make_user, auth_headers)
    data = read(client, h).json()
    response = send(client, h, data).json()
    rid = response['review']['id']
    assert len(collect_data(db, user)['cross_module_reviews']) == 1
    assert client.delete(BASE + '/' + rid, headers=auth_headers(make_user())).status_code == 404
    usage = db.get(PlanningAiUsage, (user.id, datetime.now(UTC).date()))
    usage.count = 50; db.commit()
    assert send(client, h, data).status_code == 200
    assert client.delete(BASE + '/' + rid, headers=h).status_code == 204
    assert send(client, h, data).status_code == 429
    assert db.scalar(select(func.count()).select_from(Transaction)) == 8
    usage.count = 0; db.commit()
    assert send(client, h, data).status_code == 200
    row = db.scalar(select(CrossReview)); row.updated_at = datetime.now(UTC)-timedelta(days=31); db.commit()
    run_privacy_jobs(db, settings)
    assert db.scalar(select(func.count()).select_from(CrossReview)) == 0
    assert provider.calls == 2


def test_timezone_day_boundary_and_source_limit(client, app, db, make_user, auth_headers):
    user = make_user(timezone='America/Los_Angeles')
    h = auth_headers(user)
    stamp = datetime(2026, 11, 18, 1, tzinfo=UTC)  # Still November 17 locally.
    db.add(Task(user_id=user.id, title='private', notes='', completed_at=stamp))
    db.commit()
    data = read(client, h, modules=['planning', 'books']).json()
    assert next(m for m in data['metrics'] if m['key'] == 'tasks')['values'][str(END)] == '1.00'
    db.add_all([DiaryEntry(user_id=user.id, day=END, title='private', text='private') for _ in range(2001)])
    db.commit()
    response = read(client, h, modules=['planning', 'books'])
    assert response.status_code == 422 and response.json()['error']['code'] == 'insights_too_large'


def test_provider_gets_only_calculated_comparisons_and_returns_ids(settings, monkeypatch):
    import openai
    model = MagicMock()
    selection = Selection(comparison_ids=['sleep_hours:expenses'])
    model.responses.parse.return_value = SimpleNamespace(status='completed', output_parsed=selection)
    monkeypatch.setattr(openai, 'OpenAI', MagicMock(return_value=MagicMock(__enter__=lambda s: model, __exit__=lambda *a: None)))
    settings.openai_api_key = 'synthetic-test-key'
    data = dict(start_day='2026-11-04', end_day=str(END), days=14, modules=['health','finance'], currency='PLN', limitation='No causes',
        metrics='PRIVATE DAILY DATA', comparisons=[dict(id='sleep_hours:expenses', modules=['health','finance'], text='Calculated comparison', paired_days=8, evidence='PRIVATE EVIDENCE')])
    assert generate(settings, data) == selection
    call = model.responses.parse.call_args.kwargs
    assert call['store'] is False and call['text_format'] is Selection and 'tools' not in call
    assert 'PRIVATE' not in str(call) and 'UNTRUSTED DATA' in call['input'][0]['content']
    model.responses.parse.return_value = SimpleNamespace(status='incomplete', output_parsed=None)
    with pytest.raises(AppError):
        generate(settings, data)

def test_failed_attempt_retry_processing_guard_and_duplicate_ids(client, app, db, make_user, auth_headers):
    _, h, provider = setup(client, app, db, make_user, auth_headers)
    data = read(client, h).json()
    app.state.cross_review_provider = lambda value: {'comparison_ids': [value['comparisons'][0]['id']]*2}
    assert send(client, h, data).status_code == 502
    row = db.scalar(select(CrossReview))
    row.status, row.updated_at = 'processing', datetime.now(UTC)
    db.commit()
    app.state.cross_review_provider = provider
    assert send(client, h, data).status_code == 409 and provider.calls == 0
    row.updated_at -= timedelta(minutes=4)
    db.commit()
    assert send(client, h, data).status_code == 200 and provider.calls == 1


def test_display_precision_matches_median_groups():
    left = {'key': 'a', 'module': 'health', 'label': 'A', 'unit': 'h',
        'values': {str(i): Decimal('6.66') if i<4 else Decimal('6.67') for i in range(8)}}
    right = {'key': 'b', 'module': 'finance', 'label': 'B', 'unit': 'PLN',
        'values': {str(i): Decimal('10.01') for i in range(8)}}
    value = insight_data.compare(left, right)
    assert value['threshold'] == '6.665'
    assert value['lower_days'] == value['upper_days'] == 4
    assert value['lower_average'] == value['upper_average'] == '10.01'
    assert all(Decimal(row['x']) < Decimal(value['threshold']) for row in value['evidence'] if row['group']=='lower')
