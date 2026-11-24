from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.core.database import utcnow
from app.modules.dashboard.day_progress import ClosedDay, day_streaks
from app.modules.users.privacy import collect_data


@pytest.mark.parametrize("order", ["thw", "twh", "hwt"])
def test_day_closes_after_the_last_ring_and_survives_retries(client, make_user, auth_headers, db, order):
    user = make_user()
    headers = auth_headers(user)
    now = utcnow()
    day = now.astimezone(ZoneInfo(user.timezone)).date().isoformat()
    base = "/api/v1"
    task = client.post(base + "/planning/tasks", headers=headers, json={
        "title": "Daily task", "due_at": now.isoformat(), "timezone": user.timezone,
    }).json()
    habit = client.post(base + "/habits", headers=headers, json={"title": "Daily habit"}).json()
    actions = {
        "t": (f"/planning/tasks/{task['id']}/complete", {"version": task["version"]}),
        "h": (f"/habits/{habit['id']}/checkins", {"day": day, "value": 1, "version": habit["version"]}),
        "w": ("/health/workouts", {"day": day, "title": "Walk", "minutes": 30}),
    }
    assert not client.post(base + "/dashboard/close-day", headers=headers).json()["closed"]
    for index, key in enumerate(order):
        path, params = actions[key]
        result = client.post(base + path, headers=headers, json=params)
        assert result.status_code in (200, 201), result.text
        result = client.get(base + "/dashboard", headers=headers).json()
        assert result["day_progress"]["closed"] is (index == 2)
    assert result["widgets"]["workouts"]["today_minutes"] == 30
    expected = {"closed": True, "current": 1, "best": 1, "first_closed": day, "movement_target": 30}
    assert result["day_progress"] == expected
    assert client.post(base + "/dashboard/close-day", headers=headers).json() == expected
    assert collect_data(db, user)["dashboard_closed_days"] == [{"day": day}]
    assert not client.get(base + "/dashboard", headers=auth_headers(make_user())).json()["day_progress"]["closed"]


def test_missing_habits_and_tasks_do_not_close_an_empty_day(client, make_user, auth_headers):
    user = make_user()
    headers = auth_headers(user)
    day = utcnow().astimezone(ZoneInfo(user.timezone)).date()
    for days_ago in (0, 1):
        result = client.post("/api/v1/health/workouts", headers=headers, json={
            "title": "Walk", "day": (day - timedelta(days=days_ago)).isoformat(), "minutes": 30,
        })
        assert result.status_code == 201
    result = client.get("/api/v1/dashboard", headers=headers).json()
    assert result["widgets"]["workouts"]["minutes"] == 60
    assert result["widgets"]["workouts"]["today_minutes"] == 30
    assert result["day_progress"]["closed"] is False


def test_streaks_use_unique_consecutive_local_dates(db, make_user):
    user = make_user()
    day = utcnow().date()
    for offset in (10, 9, 8, 2, 1):
        db.add(ClosedDay(user_id=user.id, day=day - timedelta(days=offset)))
    db.flush()
    assert day_streaks(db, user, day)["current"] == 2
    assert day_streaks(db, user, day)["best"] == 3
    assert day_streaks(db, user, day + timedelta(days=1))["current"] == 0


@pytest.mark.parametrize(("profile_zone", "task_zone"), [
    ("Pacific/Pago_Pago", "Pacific/Kiritimati"),
    ("Pacific/Kiritimati", "Pacific/Pago_Pago"),
])
def test_dashboard_and_close_use_same_due_day_across_zones(client, make_user, auth_headers, profile_zone, task_zone):
    user = make_user(timezone=profile_zone)
    headers = auth_headers(user)
    day = utcnow().astimezone(ZoneInfo(profile_zone)).date()
    local_start = datetime.combine(day, time.min, ZoneInfo(profile_zone))
    all_day_start = datetime.combine(day, time.min, ZoneInfo(task_zone))

    def add_task(title, **fields):
        response = client.post("/api/v1/planning/tasks", headers=headers, json={"title": title, **fields})
        assert response.status_code == 201, response.text
        return response.json()

    span_start, span_end = local_start - timedelta(days=1), local_start + timedelta(days=1)
    spanning = add_task("Deadline tomorrow", timezone=profile_zone, start_at=span_start.isoformat(), due_at=span_end.isoformat())
    midnight = add_task("Due at midnight", timezone=profile_zone, start_at=(local_start - timedelta(days=1)).isoformat(),
                        due_at=local_start.isoformat())
    all_day = add_task("All-day task", timezone=task_zone, all_day=True, start_at=all_day_start.isoformat())
    for offset in (-1, 1):
        add_task("Adjacent local date", timezone=task_zone, all_day=True, due_at=(all_day_start + timedelta(days=offset)).isoformat())
    dashboard = client.get("/api/v1/dashboard", headers=headers).json()
    planning = dashboard["widgets"]["planning"]
    assert {record["task"]["id"] for record in planning["tasks"]} == {midnight["id"], all_day["id"]}
    [busy] = planning["spanning_tasks"]
    assert busy["title"] == "Deadline tomorrow"
    assert datetime.fromisoformat(busy["start_at"]) == span_start
    assert datetime.fromisoformat(busy["end_at"]) == span_end

    habit = client.post("/api/v1/habits", headers=headers, json={"title": "Walk"}).json()
    assert client.post(f"/api/v1/habits/{habit['id']}/checkins", headers=headers,
                       json={"day": day.isoformat(), "version": habit["version"], "value": 1}).status_code == 200
    assert client.post("/api/v1/health/workouts", headers=headers,
                       json={"title": "Walk", "day": day.isoformat(), "minutes": 30}).status_code == 201
    for task, expected_closed in ((midnight, False), (all_day, True)):
        assert client.post(f"/api/v1/planning/tasks/{task['id']}/complete", headers=headers, json={"version": task["version"]}).status_code == 200
        assert client.get("/api/v1/dashboard", headers=headers).json()["day_progress"]["closed"] is expected_closed
    assert client.post(f"/api/v1/planning/tasks/{spanning['id']}/complete", headers=headers, json={"version": spanning["version"]}).status_code == 200
    assert client.get("/api/v1/dashboard", headers=headers).json()["widgets"]["planning"]["spanning_tasks"] == []
