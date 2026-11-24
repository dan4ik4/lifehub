from datetime import timedelta
from zoneinfo import ZoneInfo

from app.core.database import utcnow


def test_medication_schedule_includes_all_slots_and_only_own_current_intakes(client, make_user, auth_headers):
    user = make_user()
    headers = auth_headers(user)
    day = utcnow().astimezone(ZoneInfo(user.timezone)).date()
    path = "/api/v1/health"
    slots = ["07:00", "13:00", "18:00", "20:00", "21:00", "22:00"]
    medication = client.post(path + "/medications", headers=headers, json={
        "title": "Example", "dosage": "1", "times": slots,
    }).json()
    intake_path = f"{path}/medications/{medication['id']}/intakes"
    for date, slot in [(day - timedelta(days=1), slots[0]), (day, slots[-1])]:
        response = client.post(intake_path, headers=headers, json={
            "day": date.isoformat(), "time": slot, "taken": True, "version": medication["version"],
        })
        assert response.status_code == 200, response.text
        medication = response.json()
    schedule = path + "/medication-schedule?day=" + day.isoformat()
    data = client.get(schedule, headers=headers).json()["items"]
    assert [(item["time"], item["taken"]) for item in data] == [(slot, slot == slots[-1]) for slot in slots]
    assert all(item["row"]["version"] == medication["version"] for item in data)
    assert client.get(schedule, headers=auth_headers(make_user())).json()["items"] == []
    assert client.get(schedule, headers=auth_headers(make_user(plan="free"))).status_code == 403
