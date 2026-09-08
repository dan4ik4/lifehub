import json

import httpx
import openai

from app.modules.planning.commands import OpenAIPlanningProvider


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
