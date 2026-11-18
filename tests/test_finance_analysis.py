from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID

import pytest
from sqlalchemy import func, select
from app.core.errors import AppError
from app.modules.finance import analytics
from app.modules.finance.models import Transaction, Budget, Subscription
from app.modules.finance.analysis_models import FinanceReview
from app.modules.finance.review import FactSelection, generate
from app.modules.planning.command_models import PlanningAiUsage

BASE = '/api/v1/finance/analysis'
NOW = datetime(2026, 11, 18, 12, tzinfo=UTC)


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    monkeypatch.setattr(analytics, 'utcnow', lambda: NOW)


def add(db, user, day, amount='10.00', kind='expense', currency='PLN', category='food', **extras):
    row = Transaction(user_id=user.id, day=date.fromisoformat(day), amount=Decimal(amount), kind=kind,
        currency=currency, category=category, title='PRIVATE MERCHANT', notes='PRIVATE NOTE', **extras)
    db.add(row)
    db.commit()
    return row


class Provider:
    def __init__(self):
        self.calls = 0
        self.data = None

    def __call__(self, data):
        self.calls += 1
        self.data = data
        return {'fact_ids': ['observed', 'totals'], 'question': 'check_coverage'}


def setup(client, app, db, make_user, auth_headers):
    user = make_user(chat_preferences={'messages': True, 'modules': True})
    for day in range(1, 18):
        add(db, user, f'2026-11-{day:02d}')
    add(db, user, '2026-11-01', '1000.00', 'income')
    add(db, user, '2026-10-01', '80.00')
    add(db, user, '2026-11-18', '999.00')
    db.add(Budget(user_id=user.id, month='2026-11', currency='PLN', category='food', amount=Decimal('150')))
    db.add(Subscription(user_id=user.id, title='PRIVATE SUBSCRIPTION', currency='PLN', amount=Decimal('5'),
        period='weekly', next_payment=date(2026, 11, 18)))
    db.commit()
    provider = Provider()
    app.state.finance_review_provider = provider
    return user, auth_headers(user), provider


def read(client, h, **params):
    return client.get(BASE, headers=h, params={'month': '2026-11', 'currency': 'PLN', **params})


def send(client, h, data, **changes):
    return client.post(BASE, headers=h, json={'month': data['month'], 'currency': data['currency'],
        'coverage_start': data['forecast']['coverage_start'] if data['forecast'] else None,
        'source_hash': data['source_hash'], 'consent': True, **changes})


def test_exact_month_facts_and_explicit_conditional_forecast(client, app, db, make_user, auth_headers):
    _, h, provider = setup(client, app, db, make_user, auth_headers)
    raw = read(client, h)
    assert raw.status_code == 200, raw.text
    data = raw.json()
    assert data['cutoff'] == '2026-11-17' and data['completed_days'] == 17
    assert data['income'] == '1000.00' and data['expense'] == '170.00' and data['net_flow'] == '830.00'
    assert data['transaction_count'] == 18 and data['previous']['expense'] == '80.00'
    assert data['forecast'] is None and data['forecast_reason'] == 'coverage_required'
    assert provider.calls == 0
    data = read(client, h, coverage_start='2026-11-11').json()
    assert data['forecast'] == {'coverage_start': '2026-11-11', 'coverage_end': '2026-11-17', 'observed_days': 7,
        'observed_expense': '70.00', 'daily_average': '10.00', 'remaining_days': 13,
        'additional_expense': '130.00', 'month_expense': '300.00'}
    assert data['upcoming_subscriptions'] == {'count': 2, 'amount': '10.00'}
    assert data['budgets'][0]['remaining'] == '-20.00'
    assert data['categories'][0] == {'category': 'food', 'label': 'Еда', 'amount': '170.00', 'share': '100.0'}


def test_coverage_minimum_zero_future_and_closed_month(client, app, db, make_user, auth_headers):
    _, h, _ = setup(client, app, db, make_user, auth_headers)
    assert read(client, h, coverage_start='2026-11-12').json()['forecast_reason'] == 'too_few_days'
    for start in ('2026-10-31', '2026-11-18', '2026-12-01'):
        assert read(client, h, coverage_start=start).status_code == 422
    assert read(client, h, month='2026-12').status_code == 422
    assert read(client, h, month='2026-10', coverage_start='2026-10-01').status_code == 422
    closed = read(client, h, month='2026-10').json()
    assert closed['cutoff'] == '2026-10-31' and closed['forecast_reason'] == 'closed_month'
    assert closed['forecast'] is None and closed['upcoming_subscriptions']['count'] == 0
    empty = auth_headers(make_user())
    assert read(client, empty, coverage_start='2026-11-01').json()['forecast_reason'] == 'no_expenses'


def test_month_length_leap_year_timezone_and_first_day(client, app, db, make_user, auth_headers, monkeypatch):
    user = make_user(timezone='Europe/Warsaw')
    h = auth_headers(user)
    monkeypatch.setattr(analytics, 'utcnow', lambda: datetime(2024, 3, 1, 0, 30, tzinfo=UTC))
    first = read(client, h, month='2024-03').json()
    assert first['completed_days'] == 0 and first['cutoff'] is None and first['forecast'] is None
    feb = read(client, h, month='2024-02').json()
    assert feb['completed_days'] == 29 and feb['end_day'] == '2024-02-29'
    monkeypatch.setattr(analytics, 'utcnow', lambda: datetime(2026, 3, 31, 12, tzinfo=UTC))
    march = read(client, h, month='2026-03').json()
    assert march['previous']['end_day'] == '2026-02-28' and march['cutoff'] == '2026-03-30'
    monkeypatch.setattr(analytics, 'utcnow', lambda: datetime(2026, 11, 1, 0, 30, tzinfo=UTC))
    user.timezone = 'America/Los_Angeles'
    db.commit()
    assert read(client, h, month='2026-11').status_code == 422
    assert read(client, h, month='2026-10').json()['cutoff'] == '2026-10-30'


def test_currency_owner_deleted_and_today_excluded(client, app, db, make_user, auth_headers):
    user, h, _ = setup(client, app, db, make_user, auth_headers)
    add(db, user, '2026-11-01', '400', currency='EUR')
    add(db, user, '2026-11-01', '500', deleted_at=NOW)
    other = make_user()
    add(db, other, '2026-11-01', '600')
    assert read(client, h).json()['expense'] == '170.00'
    assert read(client, h, currency='EUR').json()['expense'] == '400.00'
    assert read(client, auth_headers(other)).json()['expense'] == '600.00'


def test_fractional_projection_rounds_only_at_end_and_subscriptions_anchor(client, app, db, make_user, auth_headers):
    user = make_user()
    h = auth_headers(user)
    add(db, user, '2026-11-01', '1.00')
    for period, anchor, amount in [('monthly', date(2026, 1, 31), '20'), ('yearly', date(2025, 11, 30), '30')]:
        db.add(Subscription(user_id=user.id, title=period, currency='PLN', amount=Decimal(amount), period=period, next_payment=anchor))
    db.commit()
    data = read(client, h, coverage_start='2026-11-01').json()
    assert data['forecast']['daily_average'] == '0.06'
    assert data['forecast']['additional_expense'] == '0.76'
    assert data['forecast']['month_expense'] == '1.76'
    assert data['upcoming_subscriptions'] == {'count': 2, 'amount': '50.00'}


def test_review_grounded_cache_quota_and_source_hash(client, app, db, make_user, auth_headers):
    user, h, provider = setup(client, app, db, make_user, auth_headers)
    data = read(client, h, coverage_start='2026-11-01').json()
    result = send(client, h, data)
    assert result.status_code == 200, result.text
    assert result.json()['review']['output'] == {'fact_ids': ['observed', 'totals'], 'question': 'check_coverage'}
    assert send(client, h, data).json()['review']['id'] == result.json()['review']['id']
    assert provider.calls == 1
    assert db.get(PlanningAiUsage, (user.id, datetime.now(UTC).date())).count == 1
    assert 'PRIVATE' not in str(provider.data)
    assert read(client, h).json()['review'] is None  # Different coverage assumptions.
    assert send(client, h, data, source_hash='0' * 64).status_code == 409
    assert provider.calls == 1


@pytest.mark.parametrize('bad', [{'fact_ids': ['observed', 'invented'], 'question': 'none'},
    {'fact_ids': ['totals'], 'question': 'none'}, {'fact_ids': ['observed', 'observed'], 'question': 'none'},
    {'fact_ids': ['observed'], 'question': 'check_recurring'}])
def test_model_can_only_select_supported_facts(client, app, db, make_user, auth_headers, bad):
    user = make_user(chat_preferences={'messages': True, 'modules': True})
    add(db, user, '2026-11-01')
    h = auth_headers(user)
    app.state.finance_review_provider = lambda _: bad
    data = read(client, h).json()
    assert send(client, h, data).status_code == 502
    assert db.scalar(select(FinanceReview)).status == 'failed'


def test_pro_consent_preferences_empty_and_stale_data(client, app, db, make_user, auth_headers):
    _, h, provider = setup(client, app, db, make_user, auth_headers)
    data = read(client, h).json()
    assert send(client, h, data, consent=False).status_code == 422
    assert client.patch('/api/v1/users/me/assistant-preferences', headers=h, json={'messages': True, 'modules': False}).status_code == 200
    assert send(client, h, data).status_code == 403
    free = auth_headers(make_user(plan='free', free_modules=['finance']))
    assert read(client, free).status_code == 403 and send(client, free, data).status_code == 403
    empty = auth_headers(make_user(chat_preferences={'messages': True, 'modules': True}))
    assert send(client, empty, read(client, empty).json()).status_code == 422
    assert provider.calls == 0


@pytest.mark.parametrize('resource', ['transactions', 'budgets', 'subscriptions'])
def test_edits_and_deletes_invalidate_review(client, app, db, make_user, auth_headers, resource):
    _, h, _ = setup(client, app, db, make_user, auth_headers)
    data = read(client, h).json()
    assert send(client, h, data).status_code == 200
    row = client.get('/api/v1/finance/' + resource, headers=h).json()['items'][0]
    row['amount'] = '123.00'
    fields = {'transactions': ('day', 'title', 'kind', 'amount', 'currency', 'category', 'notes'),
        'budgets': ('month', 'category', 'amount', 'currency'),
        'subscriptions': ('title', 'amount', 'currency', 'period', 'next_payment')}[resource]
    response = client.patch('/api/v1/finance/' + resource + '/' + row['id'], headers=h,
        json={key: row[key] for key in fields + ('version',)})
    assert response.status_code == 200, response.text
    assert db.scalar(select(func.count()).select_from(FinanceReview)) == 0
    data = read(client, h).json()
    assert send(client, h, data).status_code == 200
    assert client.delete('/api/v1/finance/' + resource + '/' + row['id'], headers=h,
        params={'version': response.json()['version']}).status_code == 204
    assert read(client, h).json()['review'] is None


def test_source_changes_and_revoked_consent_during_model(client, app, db, make_user, auth_headers):
    user, h, _ = setup(client, app, db, make_user, auth_headers)
    data = read(client, h).json()
    def change(value):
        with app.state.session_factory() as session:
            row = session.scalar(select(Transaction).where(Transaction.user_id == user.id, Transaction.day == date(2026, 11, 1)))
            row.amount += 1
            session.commit()
        return {'fact_ids': ['observed'], 'question': 'none'}
    app.state.finance_review_provider = change
    assert send(client, h, data).status_code == 409
    data = read(client, h).json()
    def revoke(value):
        from app.modules.auth.models import User
        with app.state.session_factory() as session:
            saved = session.get(User, user.id)
            saved.chat_preferences = {'messages': True, 'modules': False}
            session.commit()
        return {'fact_ids': ['observed'], 'question': 'none'}
    app.state.finance_review_provider = revoke
    assert send(client, h, data).status_code == 403
    assert db.scalar(select(FinanceReview)).status == 'failed'


def test_delete_owner_export_and_import_invalidation(client, app, db, make_user, auth_headers):
    from app.modules.users.privacy import collect_data
    from tests.test_csv_import import mapping, upload, selection, BASE as CSV_BASE
    user, h, _ = setup(client, app, db, make_user, auth_headers)
    data = read(client, h).json()
    result = send(client, h, data).json()
    rid = result['review']['id']
    assert len(collect_data(db, user)['finance_reviews']) == 1
    assert client.delete(BASE + '/' + rid, headers=auth_headers(make_user())).status_code == 404
    assert client.delete(BASE + '/' + rid, headers=h).status_code == 204
    assert db.scalar(select(func.count()).select_from(Transaction)) == 20
    assert send(client, h, data).status_code == 200
    app.state.csv_import_provider = mapping
    preview = upload(client, h).json()
    assert client.post(CSV_BASE + '/' + preview['id'] + '/confirm', headers=h, json=selection(preview)).status_code == 200
    assert read(client, h).json()['review'] is None


def test_provider_uses_only_aggregated_facts_and_structured_ids(settings, monkeypatch):
    import openai
    model = MagicMock()
    parsed = FactSelection(fact_ids=['observed'], question='none')
    model.responses.parse.return_value = SimpleNamespace(status='completed', output_parsed=parsed)
    monkeypatch.setattr(openai, 'OpenAI', MagicMock(return_value=MagicMock(__enter__=lambda s: model, __exit__=lambda *a: None)))
    settings.openai_api_key = 'synthetic-test-key'
    data = {k: [] for k in ('month', 'currency', 'start_day', 'cutoff', 'facts', 'questions')}
    data['transactions'] = 'PRIVATE NOTE'
    assert generate(settings, data) == parsed
    call = model.responses.parse.call_args.kwargs
    assert call['store'] is False and call['text_format'] is FactSelection and 'tools' not in call
    assert 'PRIVATE NOTE' not in str(call) and 'UNTRUSTED DATA' in call['input'][0]['content']
    model.responses.parse.return_value = SimpleNamespace(status='incomplete', output_parsed=None)
    with pytest.raises(AppError):
        generate(settings, data)

def test_shared_quota_failures_and_stale_processing_retry(client, app, db, make_user, auth_headers):
    user, h, provider = setup(client, app, db, make_user, auth_headers)
    data = read(client, h).json()
    app.state.finance_review_provider = lambda _: (_ for _ in ()).throw(ValueError('synthetic failure'))
    assert send(client, h, data).status_code == 502
    row = db.scalar(select(FinanceReview))
    row.status = 'processing'
    row.updated_at = datetime.now(UTC)
    db.commit()
    app.state.finance_review_provider = provider
    assert send(client, h, data).status_code == 409
    assert provider.calls == 0
    row.updated_at -= timedelta(minutes=4)
    db.commit()
    assert send(client, h, data).status_code == 200
    usage = db.get(PlanningAiUsage, (user.id, datetime.now(UTC).date()))
    assert usage.count == 2
    usage.count = 50
    db.commit()
    assert send(client, h, data).status_code == 200  # Cached selection uses no quota.
    assert client.delete(BASE + '/' + str(row.id), headers=h).status_code == 204
    assert send(client, h, data).status_code == 429
    assert provider.calls == 1


def test_assistant_writes_and_mid_generation_invalidation(client, app, db, make_user, auth_headers):
    import json
    from app.modules.planning.module_commands import ModuleAction, execute_module
    user, h, _ = setup(client, app, db, make_user, auth_headers)
    data = read(client, h).json()
    assert send(client, h, data).status_code == 200
    entry = db.scalar(select(Transaction).where(Transaction.user_id == user.id, Transaction.day == date(2026, 11, 1)))
    execute_module(db, user, ModuleAction(type='module_record', resource='finance/transactions', operation='update',
        record_id=entry.id, version=entry.version, values_json=json.dumps({'amount': '11.00'})))
    db.commit()
    assert read(client, h).json()['review'] is None
    data = read(client, h).json()
    def remove_during_model(value):
        with app.state.session_factory() as session:
            saved = session.get(Transaction, entry.id)
            execute_module(session, user, ModuleAction(type='module_record', resource='finance/transactions', operation='delete',
                record_id=saved.id, version=saved.version))
            session.commit()
        return {'fact_ids': ['observed'], 'question': 'none'}
    app.state.finance_review_provider = remove_during_model
    assert send(client, h, data).status_code == 409
    assert db.scalar(select(func.count()).select_from(FinanceReview)) == 0


def test_large_category_set_is_rejected_without_partial_analysis(client, app, db, make_user, auth_headers):
    user = make_user()
    db.add_all([Transaction(user_id=user.id, day=date(2026, 11, 1), title='Test', notes='', kind='expense',
        currency='PLN', category=f'category {i}', amount=Decimal('1')) for i in range(101)])
    db.commit()
    response = read(client, auth_headers(user))
    assert response.status_code == 422 and response.json()['error']['code'] == 'analysis_too_large'
    assert db.scalar(select(func.count()).select_from(FinanceReview)) == 0
