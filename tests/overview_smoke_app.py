"""Synthetic local UI fixture, never imported by production."""

from contextlib import asynccontextmanager
from datetime import datetime, time, timedelta
from decimal import Decimal
from tests.frontend_smoke_app import app
from app.core.database import utcnow
from app.modules.auth.models import User
from app.modules.auth.passwords import password_hasher
from app.modules.planning.models import Task, CalendarEvent
from app.modules.planning.commands import ActionEnvelope
from app.modules.health.models import SleepEntry, WeightEntry, Workout
from app.modules.finance.models import Transaction, Budget
from app.modules.goals_habits.models import Habit, Goal, HabitCheckin
from app.modules.books.models import Book, DiaryEntry
from app.modules.dashboard.results import account_day, latest_week
from app.modules.dashboard.results_models import ReadingDelta
from app.workers.jobs.results import run_results


class LocalModel:
    def generate(self, message, context):
        if "перенеси" in message.lower() and context["events"]:
            e = context["events"][0]
            return ActionEnvelope.model_validate(
                {
                    "action": {
                        "type": "update_event",
                        "payload": {
                            "event_id": e["id"],
                            "version": e["version"],
                            "title": "Встреча перенесена (проверка)",
                            "scope": "all",
                        },
                    }
                }
            )
        return ActionEnvelope.model_validate(
            {
                "action": {
                    "type": "reply",
                    "message": "Сегодня у вас встреча с командой и время для учёбы. Начните с подготовки презентации.\n\nМожем вместе уточнить расписание — я помню наш разговор.",
                }
            }
        )


app.state.planning_command_provider = LocalModel()
original = app.router.lifespan_context


def seed_results_account(db, now):
    user = User(name="Александр", email="results-qa@example.com", password_hash=password_hasher.hash("Local-QA-Only-9182!"),
                email_verified=True, onboarding_completed=True, plan="pro", timezone="Europe/Warsaw",
                free_modules=["planning", "health", "finance"])
    db.add(user)
    db.flush()
    local = account_day(user, now)
    week = latest_week(local)
    habits = [Habit(user_id=user.id, title=title, weekdays=list(range(7)), target=1,
                    created_at=now-timedelta(days=60)) for title in ("Прогулка", "Вода", "Чтение")]
    book = Book(user_id=user.id, title="Книга для проверки итогов", status="reading", current_page=128, total_pages=400)
    db.add_all([*habits, book])
    db.flush()
    first = week - timedelta(days=42)
    for index in range((local.date() - first).days + 1):
        day = first + timedelta(days=index)
        wake = datetime.combine(day, time(8), local.tzinfo)
        long_sleep = index % 4 >= 2
        db.add(SleepEntry(user_id=user.id, start_at=wake-timedelta(hours=8 if long_sleep else 6.5), end_at=wake, quality=4))
        for rank, habit in enumerate(habits):
            db.add(HabitCheckin(user_id=user.id, habit_id=habit.id, day=day, value=int(rank < (3 if long_sleep else 1))))
        db.add(DiaryEntry(user_id=user.id, day=day, mood=2 if index % 5 >= 3 else 5,
                          title="Проверка дневника", text="Синтетическая запись для проверки недельного обзора."))
        db.add(Transaction(user_id=user.id, day=day, currency="PLN", kind="expense", category="food",
                           title="Пример траты", amount=Decimal((120 if index % 5 >= 3 else 35) + index % 3)))
        db.add(Task(user_id=user.id, title="Проверка планов на день", timezone=user.timezone,
                    due_at=wake, completed_at=wake if index % 6 else None))
        if index % 6 == 0:
            db.add(Workout(user_id=user.id, day=day, title="Тренировка", minutes=30+index%5*5, notes=""))
        if index % 3 == 0:
            db.add(ReadingDelta(user_id=user.id, book_id=book.id, day=day, pages=15+index%5))
    end = week + timedelta(days=6)
    db.add(Budget(user_id=user.id, month=end.strftime("%Y-%m"), category="food", amount=Decimal("300"), currency="PLN"))
    db.commit()


@asynccontextmanager
async def lifespan(application):
    async with original(application):
        with app.state.session_factory() as db:
            user = User(
                name="Александр",
                email="overview-qa@example.com",
                password_hash=password_hasher.hash("Local-QA-Only-9182!"),
                email_verified=True,
                onboarding_completed=True,
                plan="pro",
                timezone="Europe/Warsaw",
                free_modules=["planning", "health", "finance"],
            )
            db.add(user)
            db.flush()
            uid = user.id
            now = utcnow()
            day = now.date()
            for i, title in enumerate(["Подготовить презентацию", "Прочитать 20 страниц", "Забрать посылку"]):
                db.add(
                    Task(
                        user_id=uid,
                        title=title,
                        due_at=now,
                        timezone="Europe/Warsaw",
                        completed_at=now if i == 1 else None,
                    )
                )
            for i, title in enumerate(["Встреча с командой", "Время для учёбы"]):
                start = now.replace(hour=10 + i * 4, minute=0, second=0, microsecond=0)
                db.add(
                    CalendarEvent(
                        user_id=uid,
                        title=title,
                        start_at=start,
                        end_at=start + timedelta(hours=1),
                        timezone="Europe/Warsaw",
                    )
                )
            for i, h in enumerate([7.5, 6.8, 8.2, 7.3, 8, 6.5, 7.8]):
                end = (now - timedelta(days=6 - i)).replace(hour=6, minute=0)
                db.add(SleepEntry(user_id=uid, start_at=end - timedelta(hours=h), end_at=end, quality=4))
            db.add(WeightEntry(user_id=uid, day=day, kg=Decimal("72.4")))
            db.add(Workout(user_id=uid, day=day, title="Лёгкая тренировка", minutes=35, notes=""))
            for title in ["Утренняя прогулка", "Стакан воды утром", "Читать каждый день"]:
                db.add(Habit(user_id=uid, title=title, kind="boolean", target=1, weekdays=list(range(7)), unit=""))
            db.add(Goal(user_id=uid, title="Начать свободно говорить по-английски", progress=42, status="active"))
            for kind, amount, category in [("income", "6500", "Работа"), ("expense", "1850", "Повседневное")]:
                db.add(
                    Transaction(
                        user_id=uid,
                        day=day,
                        kind=kind,
                        amount=Decimal(amount),
                        currency="PLN",
                        category=category,
                        title="Пример для проверки",
                    )
                )
            db.add(
                Budget(
                    user_id=uid,
                    month=day.strftime("%Y-%m"),
                    category="Повседневное",
                    amount=Decimal("3000"),
                    currency="PLN",
                )
            )
            db.add(
                Book(
                    user_id=uid,
                    title="Атомные привычки",
                    author="Джеймс Клир",
                    status="reading",
                    current_page=128,
                    total_pages=320,
                )
            )
            db.commit()
            seed_results_account(db, now)
            run_results(db, app.state.settings, now)
        yield


app.router.lifespan_context = lifespan


# Explicit local opt-in; credentials remain server-side and are never printed.
import os
if os.environ.get("LIFEHUB_QA_REAL_AI") == "1" or os.environ.get("LIFEHUB_QA_REAL_VOICE") == "1":
    from dotenv import dotenv_values
    ai_settings = dotenv_values(".env")
    app.state.settings.openai_api_key = ai_settings.get("LIFEHUB_OPENAI_API_KEY") or ""
    app.state.settings.openai_transcription_model = ai_settings.get("LIFEHUB_OPENAI_TRANSCRIPTION_MODEL") or "gpt-4o-mini-transcribe"
    if os.environ.get("LIFEHUB_QA_REAL_AI") == "1":
        app.state.settings.openai_model = ai_settings.get("LIFEHUB_OPENAI_MODEL") or app.state.settings.openai_model
        app.state.planning_command_provider = None
