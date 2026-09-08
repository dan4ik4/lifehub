import json
from decimal import Decimal
from uuid import uuid4

import httpx
import openai
import pytest
from pydantic import ValidationError

from app.modules.planning.commands import OpenAIActionEnvelope, OpenAIPlanningProvider


def test_real_sdk_sends_strict_structured_request_and_parses_action(settings, monkeypatch):
    captured = []
    def handle(request):
        body = json.loads(request.content)
        captured.append(body)
        return httpx.Response(200, json={
            'id': 'resp_test', 'object': 'response', 'created_at': 1, 'status': 'completed',
            'model': settings.openai_model,
            'output': [{'type': 'message', 'id': 'msg_test', 'role': 'assistant', 'status': 'completed',
                        'content': [{'type': 'output_text', 'annotations': [], 'text': json.dumps({'action': {
                            'type': 'create_task', 'payload': {'title': 'Проверить почту'}}})}]}],
        })
    original = openai.OpenAI
    monkeypatch.setattr(openai, 'OpenAI', lambda **kwargs: original(http_client=httpx.Client(transport=httpx.MockTransport(handle)), **kwargs))
    settings.openai_api_key = 'test-key-never-sent-to-network'
    result = OpenAIPlanningProvider(settings).generate('Проверить почту', {'timezone': 'UTC', 'tasks': [], 'lists': []})
    assert result.action.type == 'create_task'
    assert result.action.payload.title == 'Проверить почту'
    assert captured[0]['text']['format']['strict'] is True
    assert captured[0]['text']['format']['type'] == 'json_schema'
    assert captured[0]['store'] is False
    assert captured[0]['model'] == 'gpt-5.6-luna'

    quantity = captured[0]['text']['format']['schema']['$defs']['ListItemCreate']['properties']['quantity']
    for option in quantity['anyOf']:
        assert '(?' not in option.get('pattern', '')
    numeric = next(option for option in quantity['anyOf'] if option.get('type') == 'number')
    assert numeric['exclusiveMinimum'] == 0


@pytest.mark.parametrize('quantity', ['0', '-1', '1.23456', '10000000000', 'not-a-number'])
def test_openai_envelope_still_rejects_invalid_quantities(quantity):
    with pytest.raises(ValidationError):
        OpenAIActionEnvelope.model_validate({'action': {
            'type': 'add_list_items', 'payload': {
                'list_id': str(uuid4()), 'items': [{'title': 'Milk', 'quantity': quantity}],
            },
        }})


def test_openai_envelope_preserves_exact_decimal_quantity():
    result = OpenAIActionEnvelope.model_validate({'action': {
        'type': 'add_list_items', 'payload': {
            'list_id': str(uuid4()), 'items': [{'title': 'Milk', 'quantity': '9999999999.1234'}],
        },
    }})
    assert result.action.payload.items[0].quantity == Decimal('9999999999.1234')
