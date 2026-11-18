import base64
import io
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from PIL import Image

from app.modules.planning.commands import OpenAIPlanningProvider, ActionEnvelope
from tests.test_commands import configure
from tests.test_chat_dashboard import chat


def photo(color="green"):
    output = io.BytesIO()
    Image.new("RGB", (800, 600), color).save(output, "PNG")
    return {"data": "data:image/png;base64," + base64.b64encode(output.getvalue()).decode()}


def test_photo_preview_private_and_replay(client, app, make_user, auth_headers):
    headers = auth_headers(make_user())
    provider = configure(app, {"type": "reply", "message": "На фото расписание"})
    result = chat(client, headers, photos=[photo()], media_allowed=True)
    assert result.status_code == 200, result.text
    assert provider.context["photos"][0].startswith("data:image/jpeg;base64,")
    history = client.get("/api/v1/ai/chat/history", headers=headers).json()["items"]
    preview = history[0]["photos"][0]
    with Image.open(io.BytesIO(base64.b64decode(preview.split(",")[1]))) as image:
        assert max(image.size) == 320
    assert client.get("/api/v1/ai/chat/history", headers=auth_headers(make_user())).json()["items"] == []
    assert chat(client, headers, photos=[photo()], media_allowed=True).json() == result.json()
    assert provider.calls == 1
    assert chat(client, headers, photos=[photo("red")], media_allowed=True).status_code == 409


@pytest.mark.parametrize("extra", [
    {"photos": [photo()]},
    {"photos": [{"data": "https://example.com/private.jpg"}], "media_allowed": True},
    {"photos": [{"data": "data:image/png;base64," + base64.b64encode(b"not a photo").decode()}], "media_allowed": True},
    {"photos": [photo(), photo(), photo(), photo()], "media_allowed": True},
])
def test_invalid_photo_never_calls_provider(client, app, make_user, auth_headers, extra):
    provider = configure(app)
    result = chat(client, auth_headers(make_user()), **extra)
    assert result.status_code == 422, result.text
    assert provider.calls == 0


def test_photo_creation_applies_immediately(client, app, make_user, auth_headers):
    headers = auth_headers(make_user())
    configure(app)
    result = chat(client, headers, photos=[photo()], media_allowed=True).json()
    assert result["confirmation"] is None
    assert len(result["affected_resources"]) == 1
    confirmed = client.post("/api/v1/ai/chat/" + result["message_id"] + "/confirm", headers=headers, json={"apply": True})
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json() == result
    assert len(confirmed.json()["affected_resources"]) == 1


def test_provider_sends_image_parts_without_storing(monkeypatch, settings):
    settings.openai_api_key = "test-key"
    client = MagicMock()
    client.responses.parse.return_value = SimpleNamespace(status="completed", output_parsed=ActionEnvelope.model_validate({"action": {"type": "reply", "message": "Фото"}}))
    factory = MagicMock()
    factory.return_value.__enter__.return_value = client
    monkeypatch.setattr("openai.OpenAI", factory)
    context = {"photos": [photo()["data"]], "events": []}
    OpenAIPlanningProvider(settings).generate("Что это?", context)
    sent = client.responses.parse.call_args.kwargs
    assert sent["store"] is False
    parts = sent["input"][1]["content"]
    assert parts[0]["type"] == "input_text"
    assert parts[1] == {"type": "input_image", "image_url": context["photos"][0], "detail": "auto"}
    assert '"photos"' not in parts[0]["text"]


def test_voice_transcription_and_validation(client, app, make_user, auth_headers, monkeypatch):
    headers = auth_headers(make_user())
    app.state.settings.openai_api_key = "test-key"
    sdk = MagicMock()
    sdk.audio.transcriptions.create.return_value = SimpleNamespace(text="  Добавь встречу завтра  ")
    factory = MagicMock()
    factory.return_value.__enter__.return_value = sdk
    monkeypatch.setattr("openai.OpenAI", factory)
    body = {"data": base64.b64encode(b"\x1aE\xdf\xa3test").decode(), "mime": "audio/webm", "media_allowed": True}
    assert client.post("/api/v1/ai/transcribe", headers=headers, json=body).json() == {"text": "Добавь встречу завтра"}
    assert sdk.audio.transcriptions.create.call_args.kwargs["model"] == "gpt-4o-transcribe"
    assert client.get("/api/v1/ai/chat/history", headers=headers).json()["items"] == []
    assert client.post("/api/v1/ai/transcribe", headers=headers, json={**body, "media_allowed": False}).status_code == 422
    assert client.post("/api/v1/ai/transcribe", headers=headers, json={**body, "data": "%%%"}).status_code == 422
    assert client.post("/api/v1/ai/transcribe", json=body).status_code == 401
    assert sdk.audio.transcriptions.create.call_count == 1
    sdk.audio.transcriptions.create.return_value = SimpleNamespace(text="  ")
    assert client.post("/api/v1/ai/transcribe", headers=headers, json=body).json()["error"]["code"] == "empty_audio"


def test_voice_limit_and_provider_failure(client, app, make_user, auth_headers, monkeypatch):
    from openai import APIConnectionError
    import httpx
    headers = auth_headers(make_user())
    app.state.settings.openai_api_key = "test-key"
    sdk = MagicMock()
    sdk.audio.transcriptions.create.side_effect = APIConnectionError(request=httpx.Request("POST", "https://api.openai.com/v1/audio/transcriptions"))
    factory = MagicMock()
    factory.return_value.__enter__.return_value = sdk
    monkeypatch.setattr("openai.OpenAI", factory)
    body = {"data": base64.b64encode(b"\x1aE\xdf\xa3test").decode(), "mime": "audio/webm", "media_allowed": True}
    for _ in range(20):
        result = client.post("/api/v1/ai/transcribe", headers=headers, json=body)
        assert result.status_code == 502
        assert result.json()["error"]["code"] == "transcription_failed"
    assert client.post("/api/v1/ai/transcribe", headers=headers, json=body).status_code == 429
    assert sdk.audio.transcriptions.create.call_count == 20


def test_text_hash_compatible_with_pre_media_records(client, app, db, make_user, auth_headers):
    import hashlib
    from sqlalchemy import select
    from app.modules.planning.command_models import PlanningCommandRecord
    from app.modules.planning.commands import AiChatRequest
    headers = auth_headers(make_user())
    configure(app, {"type": "reply", "message": "Привет"})
    assert chat(client, headers, text="Привет").status_code == 200
    record = db.scalar(select(PlanningCommandRecord))
    old_payload = AiChatRequest(message="Привет", mode="chat", planning_context_allowed=True).model_dump_json(exclude={"photos", "media_allowed"})
    assert record.request_hash == hashlib.sha256(old_payload.encode()).hexdigest()
    assert chat(client, headers, text="Привет", media_allowed=True).status_code == 200


def test_missing_voice_key_is_specific(client, make_user, auth_headers):
    headers = auth_headers(make_user())
    body = {"data": base64.b64encode(b"\x1aE\xdf\xa3test").decode(), "mime": "audio/webm", "media_allowed": True}
    response = client.post("/api/v1/ai/transcribe", headers=headers, json=body)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "voice_not_configured"


def test_multilingual_transcript_is_preserved(client, app, make_user, auth_headers, monkeypatch):
    from app.modules.planning.media import TRANSCRIPTION_CONTEXT
    app.state.settings.openai_api_key = "test-key"
    text = "Добавь zajęcia z przetwarzania sygnałów, а потом Advanced Machine Learning."
    sdk = MagicMock()
    sdk.audio.transcriptions.create.return_value = SimpleNamespace(text=text)
    factory = MagicMock()
    factory.return_value.__enter__.return_value = sdk
    monkeypatch.setattr("openai.OpenAI", factory)
    body = {"data": base64.b64encode(b"\x1aE\xdf\xa3test").decode(), "mime": "audio/webm", "media_allowed": True}
    result = client.post("/api/v1/ai/transcribe", headers=auth_headers(make_user()), json=body)
    assert result.status_code == 200
    assert result.json()["text"] == text
    args = sdk.audio.transcriptions.create.call_args.kwargs
    assert args["prompt"] == TRANSCRIPTION_CONTEXT
    assert args["temperature"] == 0
    assert "language" not in args
