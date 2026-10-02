from datetime import timedelta
from decimal import Decimal
from app.core.database import utcnow


def test_free_goal_habit_limits_and_checkin_version(client, make_user, auth_headers):
    user = make_user(plan="free", free_modules=["goals_habits", "health", "books"])
    h = auth_headers(user)
    first = client.post("/api/v1/goals", headers=h, json={"title": "Learn"})
    assert first.status_code == 201, first.text
    assert client.post("/api/v1/goals", headers=h, json={"title": "Other"}).status_code == 403
    for i in range(3):
        res = client.post("/api/v1/habits", headers=h, json={"title": str(i), "kind": "boolean"})
        assert res.status_code == 201, res.text
    assert client.post("/api/v1/habits", headers=h, json={"title": "extra", "kind": "boolean"}).status_code == 403
    habit = res.json()
    day = utcnow().date().isoformat()
    endpoint = f"/api/v1/habits/{habit['id']}/checkins"
    body = {"day": day, "value": 1, "version": habit["version"]}
    assert client.post(endpoint, headers=h, json=body).json()["today_complete"] is True
    assert client.post(endpoint, headers=h, json=body).status_code == 409
    history = client.get(endpoint, headers=h, params={"from": day, "to": day}).json()
    assert history["completion_percent"] == 100


def test_resources_are_owner_scoped_and_versioned(client, make_user, auth_headers):
    owner = auth_headers(make_user())
    other = auth_headers(make_user())
    body = {"day": utcnow().date().isoformat(), "kg": "70.5"}
    res = client.post("/api/v1/health/weight", headers=owner, json=body)
    assert res.status_code == 201, res.text
    item = res.json()
    path = "/api/v1/health/weight/" + item["id"]
    assert client.get(path, headers=other).status_code == 404
    assert client.patch(path, headers=other, json={**body, "version": item["version"]}).status_code == 404
    assert client.delete(path, headers=other, params={"version": item["version"]}).status_code == 404
    assert client.patch(path, headers=owner, json={**body, "kg": "71", "version": item["version"]}).status_code == 200
    assert client.patch(path, headers=owner, json={**body, "version": item["version"]}).status_code == 409


def test_health_history_gate_covers_list_and_detail(client, db, make_user, auth_headers):
    user = make_user()
    h = auth_headers(user)
    day = (utcnow() - timedelta(days=40)).date().isoformat()
    res = client.post("/api/v1/health/weight", headers=h, json={"day": day, "kg": 70})
    assert res.status_code == 201, res.text
    user.plan = "free"
    user.free_modules = ["health", "planning", "books"]
    db.commit()
    assert client.get("/api/v1/health/weight", headers=h).json()["items"] == []
    assert client.get("/api/v1/health/weight/" + res.json()["id"], headers=h).status_code == 403
    assert client.post("/api/v1/health/weight", headers=h, json={"day": day, "kg": 70}).status_code == 403
    assert (
        client.post(
            "/api/v1/health/nutrition",
            headers=h,
            json={
                "day": utcnow().date().isoformat(),
                "title": "Lunch",
                "meal": "lunch",
                "calories": 1,
                "protein": 0,
                "fat": 0,
                "carbs": 0,
            },
        ).status_code
        == 403
    )


def test_finance_currency_and_partial_payment(client, make_user, auth_headers):
    h = auth_headers(make_user())
    day = utcnow().date().isoformat()
    for currency, amount in [("PLN", "20.25"), ("USD", "99.50")]:
        r = client.post(
            "/api/v1/finance/transactions",
            headers=h,
            json={
                "day": day,
                "title": "Food",
                "kind": "expense",
                "amount": amount,
                "currency": currency,
                "category": "food",
            },
        )
        assert r.status_code == 201, r.text
    result = client.get("/api/v1/finance/overview", headers=h, params={"month": day[:7], "currency": "PLN"}).json()
    assert Decimal(str(result["expense"])) == Decimal("20.25")
    assert (
        client.post(
            "/api/v1/finance/budgets",
            headers=h,
            json={"month": day[:7], "currency": "PLN", "amount": "25", "category": "food"},
        ).status_code
        == 201
    )
    budgets = client.get("/api/v1/dashboard", headers=h).json()["widgets"]["budgets"]
    assert len(budgets) == 1 and Decimal(budgets[0]["remaining"]) == Decimal("4.75")

    assert (
        client.get("/api/v1/finance/overview", headers=h, params={"month": "0000-01", "currency": "PLN"}).status_code
        == 422
    )
    debt = client.post(
        "/api/v1/finance/debts",
        headers=h,
        json={"title": "Loan", "direction": "i_owe", "amount": "100", "currency": "PLN"},
    ).json()
    path = f"/api/v1/finance/debts/{debt['id']}/payments"
    paid = client.post(path, headers=h, json={"day": day, "amount": "30", "version": debt["version"]})
    assert paid.status_code == 201, paid.text
    assert Decimal(str(paid.json()["remaining"])) == 70
    assert (
        client.post(
            path, headers=h, json={"day": day, "amount": "80", "version": paid.json()["debt"]["version"]}
        ).status_code
        == 422
    )
    res = client.post(path, headers=h, json={"day": day, "amount": "70", "version": paid.json()["debt"]["version"]})
    assert res.json()["debt"]["status"] == "archived"


def test_books_and_diary_visibility(client, db, make_user, auth_headers):
    user = make_user()
    h = auth_headers(user)
    other = auth_headers(make_user())
    book = client.post(
        "/api/v1/books",
        headers=h,
        json={"title": "Book", "status": "read", "total_pages": 200, "rating": 4, "notes": "Private"},
    )
    assert book.status_code == 201, book.text
    assert book.json()["current_page"] == 200
    assert client.get("/api/v1/books/" + book.json()["id"], headers=other).status_code == 404
    entry = client.post(
        "/api/v1/diary/entries", headers=h, json={"day": utcnow().date().isoformat(), "text": "100% joy"}
    )
    assert entry.status_code == 201, entry.text
    assert len(client.get("/api/v1/diary/entries/search", headers=h, params={"q": "%"}).json()["items"]) == 1
    assert client.get("/api/v1/diary/entries/search", headers=other, params={"q": "joy"}).json()["items"] == []
    user.plan = "free"
    user.free_modules = ["books", "planning", "health"]
    db.commit()
    assert client.get("/api/v1/books", headers=h).json()["items"][0]["notes"] == ""
    assert client.get("/api/v1/diary/entries/search", headers=h, params={"q": "joy"}).status_code == 403


def test_module_selection_enforced(client, make_user, auth_headers):
    h = auth_headers(make_user(plan="free", free_modules=["planning", "health", "finance"]))
    assert client.get("/api/v1/books", headers=h).status_code == 403
    assert client.get("/api/v1/goals", headers=h).status_code == 403


def test_programs_targets_and_dashboard_gates(client, make_user, auth_headers):
    h = auth_headers(make_user())
    result = client.post(
        "/api/v1/health/programs",
        headers=h,
        json={"title": "Personal routine", "exercises": [{"name": "Custom movement", "sets": 3, "reps": 10, "kg": 0}]},
    )
    assert result.status_code == 201, result.text
    assert client.post("/api/v1/health/weight-targets", headers=h, json={"kg": "70"}).status_code == 201
    assert client.post("/api/v1/health/weight-targets", headers=h, json={"kg": "69"}).status_code == 409
    free = auth_headers(make_user(plan="free", free_modules=["books", "finance", "health"]))
    assert client.get("/api/v1/health/programs", headers=free).status_code == 403
    dashboard = client.get("/api/v1/dashboard", headers=free)
    assert dashboard.status_code == 200, dashboard.text
    assert set(dashboard.json()["widgets"]) == {"books", "finance", "sleep"}


def test_diary_day_filter_and_book_status(client, make_user, auth_headers):
    h = auth_headers(make_user())
    day = utcnow().date()
    yesterday = day - timedelta(days=1)
    for d in (day, yesterday):
        assert client.post("/api/v1/diary/entries", headers=h, json={"day": str(d), "text": "Hello"}).status_code == 201
    result = client.get("/api/v1/diary/entries", headers=h, params={"day": str(day)}).json()
    assert len(result["items"]) == 1 and result["items"][0]["day"] == str(day)
    for status in ("want", "reading"):
        client.post("/api/v1/books", headers=h, json={"title": status, "status": status})
    assert len(client.get("/api/v1/books", headers=h, params={"status": "reading"}).json()["items"]) == 1


def test_savings_audit_is_atomic_and_owner_scoped(client, make_user, auth_headers):
    h = auth_headers(make_user())
    body = {"title": "Reserve", "kind": "bank", "amount": "1234.56", "currency": "PLN"}
    response = client.post("/api/v1/finance/savings", headers=h, json=body)
    assert response.status_code == 201, response.text
    item = response.json()
    path = "/api/v1/finance/savings/" + item["id"]
    initial = client.get(path + "/history", headers=h).json()["items"]
    assert len(initial) == 1 and Decimal(initial[0]["amount"]) == Decimal("1234.56")
    response = client.patch(path, headers=h, json={**body, "title": "Renamed", "version": item["version"]})
    assert response.status_code == 200, response.text
    assert len(client.get(path + "/history", headers=h).json()["items"]) == 1
    response = client.patch(path, headers=h, json={**body, "amount": "1500.57", "version": response.json()["version"]})
    assert response.status_code == 200, response.text
    rows = client.get(path + "/history", headers=h).json()["items"]
    assert len(rows) == 2 and Decimal(rows[0]["previous_amount"]) == Decimal("1234.56")
    assert client.get(path + "/history", headers=auth_headers(make_user())).status_code == 404


def test_diary_calendar_counts_only_owned_entries(client, make_user, auth_headers):
    user = make_user()
    headers = auth_headers(user)
    day = utcnow().date().isoformat()
    for title in ("A", "B"):
        assert (
            client.post(
                "/api/v1/diary/entries", headers=headers, json={"day": day, "title": title, "text": "Text"}
            ).status_code
            == 201
        )
    calendar = client.get("/api/v1/diary/calendar", headers=headers, params={"month": day[:7]})
    assert calendar.json() == {"days": [{"day": day, "count": 2}]}
    assert client.get(
        "/api/v1/diary/calendar", headers=auth_headers(make_user()), params={"month": day[:7]}
    ).json() == {"days": []}
    updated = client.patch("/api/v1/users/me", headers=headers, json={"weight_unit": "lb"})
    assert updated.status_code == 200 and updated.json()["weight_unit"] == "lb"
    assert client.patch("/api/v1/users/me", headers=headers, json={"weight_unit": "stone"}).status_code == 422


def test_postgres_free_goal_quota_is_atomic(client, db, make_user, auth_headers):
    import pytest
    from concurrent.futures import ThreadPoolExecutor

    if db.bind.dialect.name != "postgresql":
        pytest.skip("PostgreSQL row-lock test")
    headers = auth_headers(make_user(plan="free", free_modules=["goals_habits", "planning", "health"]))

    def create(i):
        return client.post("/api/v1/goals", headers=headers, json={"title": str(i)}).status_code

    with ThreadPoolExecutor(max_workers=3) as pool:
        statuses = list(pool.map(create, range(3)))
    assert sorted(statuses) == [201, 403, 403]
