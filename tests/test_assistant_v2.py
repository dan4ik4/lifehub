import json
from datetime import timedelta
from uuid import uuid4
from app.core.database import utcnow
from tests.test_chat_dashboard import chat, event
from tests.test_chat_media import photo
from tests.test_commands import configure


def consent(client, headers, **extra):
    response = client.patch("/api/v1/users/me/assistant-preferences", headers=headers,
                            json={"messages":True,"media":True,"modules":True,**extra})
    assert response.status_code == 200, response.text
    return response


def test_preferences_persist_and_revoke(client, app, make_user, auth_headers):
    user = make_user()
    a = auth_headers(user)
    b = auth_headers(make_user())
    consent(client, a)
    assert client.get("/api/v1/users/me/assistant-preferences",headers=auth_headers(user)).json()["modules"]
    assert not client.get("/api/v1/users/me/assistant-preferences",headers=b).json()["messages"]
    provider = configure(app)
    consent(client, a, messages=False)
    assert chat(client, a).status_code == 403
    assert provider.calls == 0


def test_seven_actions_atomic_and_idempotent(client, app, make_user, auth_headers):
    headers = auth_headers(make_user())
    configure(app, {"type":"batch", "actions":[{"type":"create_task","payload":{"title":f"Task {i}"}} for i in range(7)]})
    result=chat(client,headers)
    assert result.status_code==200, result.text
    assert len(result.json()["affected_resources"])==7
    assert result.json()["confirmation"] is None
    assert chat(client,headers).json()==result.json()
    assert len(client.get("/api/v1/planning/tasks",headers=headers).json()["items"])==7


def test_failed_batch_rolls_back_earlier_writes(client, app, make_user, auth_headers):
    headers=auth_headers(make_user())
    configure(app,{"type":"batch","actions":[{"type":"create_task","payload":{"title":"Must roll back"}},
        {"type":"update_task","payload":{"task_id":str(uuid4()),"version":1,"title":"Missing"}}]})
    assert chat(client,headers).status_code==404
    assert client.get("/api/v1/planning/tasks",headers=headers).json()["items"]==[]


def test_bulk_delete_one_confirmation_and_replay(client, app, make_user, auth_headers):
    headers=auth_headers(make_user())
    events=[event(client,headers,title=str(i)) for i in range(3)]
    configure(app,{"type":"batch","actions":[{"type":"delete_event","payload":{"event_id":e["id"],"version":e["version"],"scope":"all"}} for e in events]})
    result=chat(client,headers).json()
    assert result["confirmation"]=="pending"
    assert client.get("/api/v1/planning/events/"+events[0]["id"],headers=headers).status_code==200
    url="/api/v1/ai/chat/"+result["message_id"]+"/confirm"
    applied=client.post(url,headers=headers,json={"apply":True})
    assert applied.status_code==200,applied.text
    assert len(applied.json()["affected_resources"])==3
    assert client.post(url,headers=headers,json={"apply":True}).json()==applied.json()


def test_photo_memory_and_revocation(client, app, make_user, auth_headers):
    headers=auth_headers(make_user())
    consent(client,headers)
    provider=configure(app,{"type":"reply","message":"I see a schedule"})
    assert chat(client,headers,photos=[photo()],media_allowed=True).status_code==200
    assert chat(client,headers,key="followup",media_allowed=True).status_code==200
    assert len(provider.context["photos"])==1
    consent(client,headers,media=False)
    assert chat(client,headers,key="revoked",media_allowed=True).status_code==200
    assert provider.context["photos"]==[]


def test_module_create_update_duplicate_delete_and_context(client, app, make_user, auth_headers):
    headers=auth_headers(make_user())
    consent(client,headers)
    now=utcnow()
    provider=configure(app,{"type":"module_record","resource":"health/sleep","operation":"create",
        "values_json":json.dumps({"start_at":(now-timedelta(hours=8)).isoformat(),"end_at":(now-timedelta(hours=1)).isoformat(),"quality":4})})
    result=chat(client,headers)
    assert result.status_code==200,result.text
    item=client.get("/api/v1/health/sleep",headers=headers).json()["items"][0]
    provider.action={"type":"module_record","resource":"health/sleep","operation":"update","record_id":item["id"],"version":item["version"],"values_json":'{"quality":5}'}
    result=chat(client,headers,key="edit")
    assert result.status_code==200,result.text
    assert provider.context["modules"]["health/sleep"]["records"][0]["id"]==item["id"]
    item=client.get("/api/v1/health/sleep",headers=headers).json()["items"][0]
    assert item["quality"]==5
    provider.action={**provider.action,"operation":"duplicate","version":item["version"],"values_json":"{}"}
    result=chat(client,headers,key="copy")
    assert result.status_code==200,result.text
    assert len(client.get("/api/v1/health/sleep",headers=headers).json()["items"])==2
    provider.action={**provider.action,"operation":"delete"}
    assert chat(client,headers,key="delete").status_code==200
    assert len(client.get("/api/v1/health/sleep",headers=headers).json()["items"])==1


def test_module_atomicity_and_owner_isolation(client, app, make_user, auth_headers):
    headers=auth_headers(make_user())
    other=auth_headers(make_user())
    consent(client,headers)
    target=client.post("/api/v1/health/weight",headers=other,json={"day":utcnow().date().isoformat(),"kg":70}).json()
    provider=configure(app,{"type":"batch","actions":[{"type":"module_record","resource":"health/weight","operation":"create","values_json":json.dumps({"day":utcnow().date().isoformat(),"kg":80})},
        {"type":"module_record","resource":"health/weight","operation":"update","record_id":target["id"],"version":target["version"],"values_json":'{"kg":90}'}]})
    result=chat(client,headers)
    assert result.status_code==404,result.text
    assert client.get("/api/v1/health/weight",headers=headers).json()["items"]==[]
    assert provider.context["modules"]["health/weight"]["records"]==[]


def test_module_consent_and_free_entitlements(client, app, make_user, auth_headers):
    headers=auth_headers(make_user(plan="free",free_modules=["planning"]))
    provider=configure(app,{"type":"module_record","resource":"health/weight","operation":"create","values_json":json.dumps({"day":utcnow().date().isoformat(),"kg":80})})
    assert chat(client,headers).status_code==403
    consent(client,headers)
    result=chat(client,headers,key="locked")
    assert result.status_code==403,result.text
    assert "health/weight" not in provider.context["modules"]


def test_delete_system_list_stays_deleted(client, make_user, auth_headers):
    headers=auth_headers(make_user())
    lists=client.get("/api/v1/planning/lists",headers=headers).json()["items"]
    assert len(lists)==1
    assert client.delete("/api/v1/planning/lists/"+lists[0]["id"],headers=headers).status_code==204
    assert client.get("/api/v1/planning/lists",headers=headers).json()["items"]==[]


def test_cross_module_batch_and_followup(client, app, make_user, auth_headers):
    headers=auth_headers(make_user())
    consent(client,headers)
    day=utcnow().date().isoformat()
    drafts=[("goals_habits/goals",{"title":"Learn Polish"}),
            ("goals_habits/habits",{"title":"Read daily"}),
            ("finance/transactions",{"day":day,"title":"Coffee","kind":"expense","amount":"12.50","currency":"PLN","category":"food"}),
            ("books/books",{"title":"Dune"}),
            ("books/diary/entries",{"day":day,"text":"A good day"})]
    provider=configure(app,{"type":"batch","actions":[{"type":"module_record","resource":key,"operation":"create","values_json":json.dumps(data)} for key,data in drafts]})
    result=chat(client,headers)
    assert result.status_code==200,result.text
    assert len(result.json()["affected_resources"])==5
    assert client.get("/api/v1/finance/transactions",headers=headers).json()["items"][0]["title"]=="Coffee"
    habit=client.get("/api/v1/habits",headers=headers).json()["items"][0]
    provider.action={"type":"module_record","resource":"goals_habits/habits","operation":"checkin","record_id":habit["id"],"version":habit["version"],"values_json":json.dumps({"day":day,"value":1})}
    result=chat(client,headers,key="checkin")
    assert result.status_code==200,result.text
    assert client.get("/api/v1/habits",headers=headers).json()["items"][0]["today_complete"]


def test_batch_deletes_multiple_occurrences_of_same_series(client, app, make_user, auth_headers):
    from datetime import datetime
    headers=auth_headers(make_user())
    e=event(client,headers,rrule="FREQ=DAILY;COUNT=5")
    start=datetime.fromisoformat(e["start_at"])
    occurrences=client.get("/api/v1/planning/calendar",headers=headers,params={"from":start.isoformat(),"to":(start+timedelta(days=5)).isoformat(),"timezone":"UTC"}).json()["events"]
    configure(app,{"type":"batch","actions":[{"type":"delete_event","payload":{"event_id":e["id"],"version":e["version"],"scope":"this","occurrence_at":occurrences[i]["occurrence_at"]}} for i in (1,2,3)]})
    result=chat(client,headers).json()
    assert result["confirmation"]=="pending"
    response=client.post("/api/v1/ai/chat/"+result["message_id"]+"/confirm",headers=headers,json={"apply":True})
    assert response.status_code==200,response.text
    rows=client.get("/api/v1/planning/calendar",headers=headers,params={"from":start.isoformat(),"to":(start+timedelta(days=5)).isoformat(),"timezone":"UTC"}).json()
    assert len(rows["events"])==2


def test_batch_clarification_is_normal_reply_without_partial_writes(client, app, make_user, auth_headers):
    headers = auth_headers(make_user())
    provider = configure(app, {"type": "batch", "actions": [
        {"type": "create_task", "payload": {"title": "Пробежка"}},
        {"type": "clarify", "message": "Во сколько начался сон?"},
        {"type": "reply", "message": "Всё добавлено"},
    ]})
    response = chat(client, headers)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["action"]["type"] == "clarify"
    assert "Во сколько начался сон?" in result["message"]
    assert "Всё добавлено" not in result["message"]
    assert result["affected_resources"] == []
    assert result["confirmation"] is None
    assert client.get("/api/v1/planning/tasks", headers=headers).json()["items"] == []
    assert chat(client, headers).json() == result
    assert provider.calls == 1
    history = client.get("/api/v1/ai/chat/history", headers=headers).json()["items"]
    assert history[0]["response"]["message"] == result["message"]
    provider.action = {"type": "create_task", "payload": {"title": "Пробежка"}}
    assert chat(client, headers, text="В семь утра", key="clarified").status_code == 200
    assert len(client.get("/api/v1/planning/tasks", headers=headers).json()["items"]) == 1


def test_batch_reply_does_not_break_writes(client, app, make_user, auth_headers):
    headers = auth_headers(make_user())
    configure(app, {"type": "batch", "actions": [
        {"type": "reply", "message": "Удалил все события"},
        {"type": "create_task", "payload": {"title": "Пробежка"}},
    ]})
    response = chat(client, headers)
    assert response.status_code == 200, response.text
    assert len(response.json()["affected_resources"]) == 1
    assert "Удалил все события" not in response.json()["message"]


def test_batch_question_precedes_bulk_delete_confirmation(client, app, make_user, auth_headers):
    headers = auth_headers(make_user())
    events = [event(client, headers, title=str(i)) for i in range(2)]
    configure(app, {"type": "batch", "actions": [
        *[{"type": "delete_event", "payload": {"event_id": e["id"], "version": e["version"], "scope": "all"}} for e in events],
        {"type": "clarify", "message": "За какую неделю?"},
    ]})
    response = chat(client, headers)
    assert response.status_code == 200, response.text
    assert response.json()["confirmation"] is None
    assert response.json()["affected_resources"] == []
    for e in events:
        assert client.get("/api/v1/planning/events/" + e["id"], headers=headers).status_code == 200


def test_batch_dialogue_only_and_empty_question_normalize():
    from app.modules.planning.commands import ActionEnvelope, normalize_batch_dialogue
    reply = normalize_batch_dialogue(ActionEnvelope.model_validate({"action": {"type": "batch", "actions": [
        {"type": "reply", "message": "Первый ответ"}, {"type": "reply", "message": "Второй ответ"}
    ]}}).action)
    assert reply.type == "reply"
    assert reply.message == "Первый ответ\nВторой ответ"
    question = normalize_batch_dialogue(ActionEnvelope.model_validate({"action": {"type": "batch", "actions": [
        {"type": "clarify", "message": " "}
    ]}}).action)
    assert question.type == "clarify"
    assert "Уточните" in question.message
