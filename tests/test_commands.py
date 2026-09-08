from sqlalchemy import func, select

from app.modules.planning.command_models import PlanningAiUsage
from app.modules.planning.commands import ActionEnvelope
from app.modules.planning.models import Task


class FakeModel:
    def __init__(self, action):
        self.action, self.calls, self.context = action, 0, None

    def generate(self, message, context):
        self.calls += 1
        self.context = context
        return ActionEnvelope.model_validate({'action': self.action})


def configure(app, action=None):
    model = FakeModel(action or {'type': 'create_task', 'payload': {'title': 'Купить молоко'}})
    app.state.planning_command_provider = model
    return model


def send(client, headers, key='command-1', message='Добавь задачу купить молоко'):
    return client.post('/api/v1/ai/chat', headers={**headers, 'Idempotency-Key': key}, json={'context': 'planning', 'mode': 'command', 'message': message})


def test_create_and_replay_are_exactly_once(client, app, db, make_user, auth_headers):
    user = make_user()
    model = configure(app)
    first = send(client, auth_headers(user))
    assert first.status_code == 200, first.text
    again = send(client, auth_headers(user))
    assert again.json() == first.json()
    assert model.calls == 1
    assert db.scalar(select(func.count()).select_from(Task)) == 1
    assert first.json()['remaining_ai_requests'] == 49
    assert model.context['lists'][0]['kind'] == 'shopping'


def test_idempotency_key_rejects_changed_message(client, app, make_user, auth_headers):
    model = configure(app)
    headers = auth_headers(make_user())
    assert send(client, headers).status_code == 200
    changed = send(client, headers, message='Совсем другое действие')
    assert changed.status_code == 409
    assert changed.json()['error']['code'] == 'idempotency_conflict'
    assert model.calls == 1


def test_free_daily_quota_and_replay(client, app, make_user, auth_headers):
    model = configure(app)
    headers = auth_headers(make_user(plan='free'))
    for number in range(3):
        result = send(client, headers, key=f'key-{number}')
        assert result.status_code == 200, result.text
        assert result.json()['remaining_ai_requests'] == 2-number
    assert send(client, headers, key='key-0').status_code == 200
    blocked = send(client, headers, key='fourth')
    assert blocked.status_code == 429
    assert blocked.json()['error']['code'] == 'ai_limit'
    assert int(blocked.headers['Retry-After']) > 0
    assert model.calls == 3


def test_model_cannot_update_another_users_task(client, app, db, make_user, auth_headers):
    owner, attacker = make_user(), make_user()
    task = client.post('/api/v1/planning/tasks', headers=auth_headers(owner), json={'title': 'Private'}).json()
    configure(app, {'type': 'update_task', 'payload': {'task_id': task['id'], 'version': 1, 'title': 'Tampered'}})
    failed = send(client, auth_headers(attacker))
    assert failed.status_code == 404, failed.text
    assert client.get('/api/v1/planning/tasks/'+task['id'], headers=auth_headers(owner)).json()['title'] == 'Private'
    replay = send(client, auth_headers(attacker))
    assert replay.status_code == 404
    assert replay.json()['error'] == failed.json()['error']


def test_free_model_cannot_bypass_pro_gate(client, app, db, make_user, auth_headers):
    configure(app, {'type': 'create_task', 'payload': {'title': 'Priority', 'priority': 'high'}})
    result = send(client, auth_headers(make_user(plan='free')))
    assert result.status_code == 403, result.text
    assert result.json()['error']['code'] == 'pro_required'
    assert db.scalar(select(func.count()).select_from(Task)) == 0


def test_missing_model_config_is_explicit(client, make_user, auth_headers):
    response = send(client, auth_headers(make_user()))
    assert response.status_code == 503
    assert response.json()['error']['code'] == 'provider_unavailable'


def test_clarification_never_creates_resource_and_is_charged_once(client, app, db, make_user, auth_headers):
    model = configure(app, {'type': 'clarify', 'message': 'Какую задачу перенести?'})
    user = make_user()
    headers = auth_headers(user)
    first = send(client, headers)
    assert first.status_code == 422
    assert first.json()['error']['code'] == 'ambiguous_command'
    assert send(client, headers).status_code == 422
    assert model.calls == 1
    assert db.scalar(select(func.count()).select_from(Task)) == 0
    assert db.scalar(select(PlanningAiUsage.count).where(PlanningAiUsage.user_id == user.id)) == 1


def test_module_locked_before_model_call(client, app, make_user, auth_headers):
    model = configure(app)
    user = make_user(plan='free', free_modules=['health', 'finance', 'books'])
    result = send(client, auth_headers(user))
    assert result.status_code == 403
    assert result.json()['error']['code'] == 'module_locked'
    assert model.calls == 0


def test_key_required_and_other_contexts_rejected(client, app, make_user, auth_headers):
    model = configure(app)
    headers = auth_headers(make_user())
    assert client.post('/api/v1/ai/chat', headers=headers, json={'message': 'x'}).status_code == 422
    assert client.post('/api/v1/ai/chat', headers={**headers, 'Idempotency-Key': 'x'}, json={'message': 'x', 'context': 'health'}).status_code == 422
    assert model.calls == 0
