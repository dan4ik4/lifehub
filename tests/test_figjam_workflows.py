def test_workout_efforts_survive_legacy_edit(client, make_user, auth_headers):
    user = make_user()
    headers = auth_headers(user)
    path = "/api/v1/health/workouts"
    body = {"day": "2026-01-01", "title": "Training", "minutes": 30}
    created = client.post(path, headers=headers, json={
        **body, "efforts": [{"name": "Squat", "kg": 42.5, "reps": 8}],
    })
    assert created.status_code == 201, created.text
    row = created.json()
    updated = client.patch(f"{path}/{row['id']}", headers=headers, json={**body, "title": "Updated", "version": row["version"]})
    assert updated.status_code == 200
    assert updated.json()["efforts"] == [{"name": "Squat", "kg": 42.5, "reps": 8}]
    assert client.get(f"{path}/{row['id']}", headers=auth_headers(make_user())).status_code == 404


def test_diary_mood_and_tags_round_trip(client, make_user, auth_headers):
    user = make_user()
    headers = auth_headers(user)
    path = "/api/v1/diary/entries"
    body = {"day": "2026-01-01", "title": "Private", "text": "A note"}
    created = client.post(path, headers=headers, json={**body, "mood": 4, "tags": ["   Focus ", "Focus", "проверка"]})
    assert created.status_code == 201, created.text
    row = created.json()
    assert row["tags"] == ["Focus", "проверка"]
    matched = client.get(path + "/search", headers=headers, params={"q": "проверка"})
    assert matched.status_code == 200
    assert [item["id"] for item in matched.json()["items"]] == [row["id"]]
    calendar = client.get("/api/v1/diary/calendar", headers=headers, params={"month": "2026-01"})
    assert calendar.json()["days"] == [{"day": "2026-01-01", "count": 1, "mood": 4.0}]
    updated = client.patch(f"{path}/{row['id']}", headers=headers, json={**body, "text": "Edited", "version": row["version"]})
    assert updated.status_code == 200
    assert updated.json()["mood"] == 4 and updated.json()["tags"] == row["tags"]


def test_budget_copy_preserves_existing_limits(client, make_user, auth_headers):
    user = make_user()
    headers = auth_headers(user)
    path = "/api/v1/finance/budgets"
    for month, category, amount in [
        ("2026-10", "food", 500), ("2026-10", "home", 900), ("2026-11", "food", 600),
    ]:
        response = client.post(path, headers=headers, json={
            "month": month, "category": category, "currency": "PLN", "amount": amount,
        })
        assert response.status_code == 201, response.text
    params = {"month": "2026-11", "currency": "PLN"}
    assert client.post(path + "/copy", headers=headers, json=params).json() == {"copied": 1}
    assert client.post(path + "/copy", headers=headers, json=params).json() == {"copied": 0}
    current = client.get("/api/v1/finance/overview", headers=headers, params=params).json()
    assert {row["category"]: float(row["amount"]) for row in current["budgets"]} == {"food": 600, "home": 900}
