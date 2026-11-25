from datetime import timedelta
from zoneinfo import ZoneInfo

from app.core.database import utcnow


ROOT = "/api/v1/health"


def test_medication_schedule_skip_stock_and_undo(client, make_user, auth_headers):
    user = make_user()
    headers = auth_headers(user)
    today = utcnow().astimezone(ZoneInfo(user.timezone)).date()
    body = {"title": "Synthetic course", "dosage": "Recorded amount", "times": ["08:00", "20:00"],
            "stock": 5, "course_end": str(today), "weekdays": [today.weekday()]}
    response = client.post(ROOT + "/medications", headers=headers, json=body)
    assert response.status_code == 201, response.text
    created = response.json()
    path = ROOT + "/medications/" + created["id"] + "/intakes"
    schedule = ROOT + "/medication-schedule?day=" + str(today)
    assert len(client.get(schedule, headers=headers).json()["items"]) == 2
    assert client.get(ROOT + "/medication-schedule?day=" + str(today + timedelta(days=1)), headers=headers).json()["items"] == []

    def mark(version, time, *, taken=False, skipped=False):
        response = client.post(path, headers=headers, json={"day": str(today), "version": version, "time": time,
                                                           "taken": taken, "skipped": skipped})
        assert response.status_code == 200, response.text
        return response.json()["version"]

    version = mark(created["version"], "08:00", taken=True)
    version = mark(version, "20:00", skipped=True)
    items = client.get(schedule, headers=headers).json()["items"]
    assert items[0]["taken"] and items[0]["taken_at"]
    assert items[1]["skipped"] and not items[1]["taken"]
    dashboard = client.get(ROOT + "/medication-tracking", headers=headers).json()
    assert dashboard["courses"][0]["remaining"] == 4
    assert len(dashboard["days"]) == 14 and dashboard["days"][-1]["taken"] == 1
    mark(version, "08:00")
    assert client.get(ROOT + "/medication-tracking", headers=headers).json()["courses"][0]["remaining"] == 5
    other = auth_headers(make_user())
    assert client.get(ROOT + "/medication-tracking", headers=other).json()["courses"] == []


def test_health_notes_targets_and_program_ownership(client, make_user, auth_headers):
    user = make_user()
    headers = auth_headers(user)
    day = str(utcnow().astimezone(ZoneInfo(user.timezone)).date())
    weight = client.post(ROOT + "/weight", headers=headers, json={"day": day, "kg": "67.2", "notes": "Checked"}).json()
    result = client.patch(ROOT + "/weight/" + weight["id"], headers=headers, json={"day": day, "kg": "67.3", "version": weight["version"]})
    assert result.status_code == 200 and result.json()["notes"] == "Checked"

    target = client.post(ROOT + "/nutrition-targets", headers=headers, json={"calories": 2400, "protein": 140, "fat": 80, "carbs": 280})
    assert target.status_code == 201
    assert client.get(ROOT + "/nutrition-targets", headers=headers).json()["items"][0]["calories"] == 2400

    program = client.post(ROOT + "/programs", headers=headers, json={"title": "Synthetic program",
        "exercises": [{"name": "Exercise", "sets": 2, "reps": 8, "kg": 20}]}).json()
    body = {"day": day, "title": "Training log", "minutes": 35, "program_id": program["id"]}
    assert client.post(ROOT + "/workouts", headers=auth_headers(make_user()), json=body).status_code == 404
    result = client.post(ROOT + "/workouts", headers=headers, json=body)
    assert result.status_code == 201 and result.json()["program_id"] == program["id"]
