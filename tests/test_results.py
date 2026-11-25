from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select

from app.modules.books.models import DiaryEntry
from app.modules.dashboard import results
from app.modules.dashboard.results_models import ReadingDelta, ResultsSnapshot
from app.modules.finance.models import Transaction
from app.modules.goals_habits.models import Habit, HabitCheckin
from app.modules.health.models import SleepEntry
from app.modules.notifications.models import ProductNotice, PushSubscription
from app.modules.planning.models import Task
from app.workers.jobs import results as job
from app.workers.jobs.product_notifications import run_product_notifications


def seed(db, user):
    habit = Habit(user_id=user.id, title="Daily", target=1, weekdays=list(range(7)),
                  created_at=datetime(2026, 11, 1, tzinfo=UTC))
    db.add(habit)
    db.flush()
    for index in range(12):
        day = date(2026, 11, 10) + timedelta(days=index)
        wake = datetime.combine(day, datetime.min.time(), UTC) + timedelta(hours=7)
        hours = 6 if index < 6 else 8
        db.add(SleepEntry(user_id=user.id, start_at=wake-timedelta(hours=hours), end_at=wake, quality=3))
        db.add(HabitCheckin(user_id=user.id, habit_id=habit.id, day=day, value=int(hours >= 8)))
    db.add(DiaryEntry(user_id=user.id, day=date(2026, 11, 19), mood=4, title="", text="Private title content"))
    db.add(Task(user_id=user.id, title="On time", timezone=user.timezone,
                due_at=datetime(2026, 11, 18, 14, tzinfo=UTC), completed_at=datetime(2026, 11, 18, 14, tzinfo=UTC)))
    db.add(Transaction(user_id=user.id, day=date(2026, 11, 19), currency="PLN", kind="expense",
                       title="Private merchant", category="food", amount=Decimal("12.34")))
    db.commit()


def test_results_jobs_schedule_once_and_keep_archived_week(client, db, make_user, auth_headers, monkeypatch, settings):
    user = make_user()
    seed(db, user)
    db.add(PushSubscription(user_id=user.id, endpoint_hash="test-results", encrypted_subscription="not-used"))
    db.commit()
    early = datetime(2026, 11, 22, 18, 59, tzinfo=UTC)
    after = early + timedelta(minutes=1)
    monkeypatch.setattr(results, "utcnow", lambda: after)
    job.run_results(db, settings, early)
    query = select(ResultsSnapshot).where(ResultsSnapshot.user_id == user.id, ResultsSnapshot.kind == "week")
    assert db.scalars(query).one().start == date(2026, 11, 9)
    job.run_results(db, settings, after)
    job.run_results(db, settings, after + timedelta(minutes=1))
    assert len(db.scalars(query).all()) == 2
    notice = db.scalars(select(ProductNotice).where(ProductNotice.user_id == user.id)).one()
    assert notice.url == "/modules/insights?start=2026-11-16"

    received = []
    class Delivery:
        def deliver(self, **kwargs):
            received.append(kwargs["entity"].notification_url)
    run_product_notifications(db, settings, Delivery(), after)
    assert received == [notice.url]

    headers = auth_headers(user)
    week = client.get("/api/v1/insights/week", headers=headers).json()
    assert week["start"] == "2026-11-16"
    assert week["built_at"] and week["score"] is not None and week["best_day"]
    assert week["totals"]["expenses"] == "12.34"
    assert week["totals"]["tasks"] == 1
    assert len(week["kpi"]) == 6 and week["kpi"][0] == {"key": "tasks", "value": 1, "previous": None}
    assert week["totals"]["pages"] is None
    assert not week["ai_used"]
    assert len(week["days"]) == 7
    other = make_user()
    assert client.get("/api/v1/insights/week", headers=auth_headers(other)).json()["totals"]["expenses"] is None
    assert client.get("/api/v1/insights/archive?year=2026", headers=headers).json()["items"][0]["start"] == week["start"]
    assert client.get("/api/v1/insights/archive?year=2026&kind=month", headers=headers).json()["items"][0]["start"] == "2026-11-01"


def test_pairs_filters_hidden_preferences_and_ai_are_account_scoped(client, db, make_user, auth_headers, monkeypatch, settings):
    user = make_user()
    seed(db, user)
    now = datetime(2026, 11, 22, 8, tzinfo=UTC)
    monkeypatch.setattr(results, "utcnow", lambda: now)
    headers = auth_headers(user)
    root = "/api/v1/insights"
    assert client.get(root+"/preferences", headers=headers).json() == {"ai_enabled": False, "decided": False}
    data = client.get(root+"/pairs?days=14", headers=headers).json()
    pair = next(item for item in data["found"] if item["id"] == "sleep:habits")
    assert pair["paired_days"] >= 8 and float(pair["upper_average"]) > float(pair["lower_average"])
    assert len(data["days"]) == 14
    assert client.get(root+"/pairs?modules=planning&modules=finance", headers=headers).json()["found"] == []
    assert client.patch(root+"/pairs/visibility", headers=headers, json={"pair":pair["id"],"hidden":True}).status_code == 200
    assert pair["id"] in client.get(root+"/pairs", headers=headers).json()["hidden"]
    assert not client.get(root+"/preferences", headers=headers).json()["decided"]
    assert client.patch(root+"/pairs/visibility", headers=headers, json={"pair":pair["id"],"hidden":False}).status_code == 200
    settings.openai_api_key = "synthetic"
    calls = []
    def fake_model(_, payload):
        calls.append(payload["start"])
        return ["habits"]
    monkeypatch.setattr(job, "select_facts", fake_model)
    job.run_results(db, settings, now)
    assert not calls
    assert client.patch(root+"/preferences", headers=headers, json={"ai_enabled":True}).status_code == 200
    job.run_results(db, settings, now)
    job.run_results(db, settings, now)
    assert len(calls) == 1
    assert client.get(root+"/week", headers=headers).json()["ai_used"]
    assert client.patch(root+"/preferences", headers=headers, json={"ai_enabled":False}).status_code == 200
    assert not client.get(root+"/week", headers=headers).json()["ai_used"]


def test_reading_uses_date_stamped_progress_without_turning_existing_position_into_pages(client, db, make_user, auth_headers):
    user = make_user()
    headers = auth_headers(user)
    base = "/api/v1/books"
    book = client.post(base, headers=headers, json={"title":"Synthetic read","current_page":50,"total_pages":200}).json()
    assert db.scalar(select(func.count()).select_from(ReadingDelta)) == 0
    response = client.patch(base + "/" + book["id"], headers=headers, json={
        "title":"Synthetic read","current_page":80,"total_pages":200,"version":book["version"],
    })
    assert response.status_code == 200, response.text
    item = db.scalars(select(ReadingDelta).where(ReadingDelta.user_id == user.id)).one()
    assert item.pages == 30 and item.day == results.account_day(user).date()
