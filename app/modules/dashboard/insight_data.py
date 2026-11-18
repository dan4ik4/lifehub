"""Bounded daily comparisons: missing days stay missing; observations never imply causes."""
import hashlib
import itertools
import json
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal, ROUND_HALF_UP
from statistics import median
from zoneinfo import ZoneInfo
from sqlalchemy import select
from app.core.database import utcnow
from app.core.errors import AppError
from app.core.owned import require_module
from app.modules.books.models import DiaryEntry
from app.modules.finance.models import Transaction
from app.modules.goals_habits.models import Habit, HabitCheckin
from app.modules.health.models import SleepEntry, Workout, HealthConnection, HealthDaily
from app.modules.planning.models import Task, TaskOccurrence

MODULES = {'planning': 'Планирование', 'goals_habits': 'Привычки', 'health': 'Здоровье', 'finance': 'Финансы', 'books': 'Дневник'}


def number(value):
    return format(Decimal(value).quantize(Decimal('.01'), rounding=ROUND_HALF_UP), '.2f')


def scope(user, end_day, days, modules, currency):
    selected = sorted(set(modules))
    if len(selected) != len(modules) or len(selected) < 2 or any(m not in MODULES for m in selected):
        raise AppError(422, 'invalid_scope', 'Выберите от двух до пяти разных модулей.')
    if days not in (14, 28) or end_day < date(1900, 1, 28) or end_day >= utcnow().astimezone(ZoneInfo(user.timezone)).date():
        raise AppError(422, 'invalid_period', 'Выберите 14 или 28 завершённых дней, заканчивая не позже вчерашнего дня.')
    for module in selected:
        require_module(user, module)
    value = {'end_day': str(end_day), 'days': days, 'modules': selected, 'currency': currency}
    return selected, hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def compare(left, right):
    common = sorted(set(left['values']) & set(right['values']))
    if len(common) < 8:
        return None
    for x, y in ((left, right), (right, left)):
        threshold = median([x['values'][day] for day in common])
        lower = [day for day in common if x['values'][day] < threshold]
        upper = [day for day in common if x['values'][day] >= threshold]
        if min(len(lower), len(upper)) < 3:
            continue
        threshold_text = format(threshold.normalize(), 'f')
        low = sum((y['values'][day] for day in lower), Decimal(0)) / len(lower)
        high = sum((y['values'][day] for day in upper), Decimal(0)) / len(upper)
        key = x['key'] + ':' + y['key']
        return {'id': key, 'modules': [x['module'], y['module']], 'x': x['key'], 'y': y['key'],
            'paired_days': len(common), 'lower_days': len(lower), 'upper_days': len(upper),
            'threshold': threshold_text, 'lower_average': number(low), 'upper_average': number(high),
            'text': (f'Среди {len(common)} дней с записями обоих показателей: когда «{x["label"]}» ниже личной медианы '
                f'{threshold_text} {x["unit"]} ({len(lower)} дн.), среднее «{y["label"]}» — {number(low)} {y["unit"]}; '
                f'при значении не ниже медианы ({len(upper)} дн.) — {number(high)} {y["unit"]}. '
                'Это описательное сравнение выбранных записей, не доказательство связи или её причины.'),
            'evidence': [{'day': day, 'x': number(x['values'][day]), 'y': number(y['values'][day]),
                'group': 'lower' if day in lower else 'upper'} for day in common]}
    return None


def build(db, user, end_day, days, modules, currency):
    selected, scope_hash = scope(user, end_day, days, modules, currency)
    start = end_day - timedelta(days=days - 1)
    tz = ZoneInfo(user.timezone)
    lower = datetime.combine(start, time.min, tz)
    upper = datetime.combine(end_day + timedelta(days=1), time.min, tz)
    versions, metrics, notes = [], [], []

    def rows(statement, name):
        values = db.execute(statement.limit(2001)).all()
        if len(values) > 2000:
            raise AppError(422, 'insights_too_large', 'Для одного обзора — до 2000 записей каждого вида. Выберите 14 дней или другой период.')
        versions.append([name, [[str(v) for v in row] for row in values]])
        return values

    def metric(key, module, label, unit, values):
        metrics.append({'key': key, 'module': module, 'label': label, 'unit': unit,
            'values': {day: Decimal(number(value)) for day, value in values.items()}})

    if 'planning' in selected:
        values = defaultdict(Decimal)
        completed = rows(select(Task.id, Task.completed_at, Task.version).where(Task.user_id == user.id,
            Task.deleted_at.is_(None), Task.rrule.is_(None), Task.completed_at >= lower, Task.completed_at < upper)
            .order_by(Task.id), 'tasks')
        occurrences = rows(select(TaskOccurrence.id, TaskOccurrence.completed_at, Task.version).join(Task,
            Task.id == TaskOccurrence.task_id).where(Task.user_id == user.id, Task.deleted_at.is_(None),
            TaskOccurrence.user_id == user.id, TaskOccurrence.status == 'completed',
            TaskOccurrence.completed_at >= lower, TaskOccurrence.completed_at < upper).order_by(TaskOccurrence.id), 'task_occurrences')
        for _, completed_at, _ in completed + occurrences:
            values[str(completed_at.astimezone(tz).date())] += 1
        metric('tasks', 'planning', 'Зафиксированные выполнения задач', 'выполнений', values)

    if 'goals_habits' in selected:
        values = defaultdict(Decimal)
        for _, day, _ in rows(select(HabitCheckin.id, HabitCheckin.day, HabitCheckin.version).join(Habit,
            Habit.id == HabitCheckin.habit_id).where(Habit.user_id == user.id, Habit.deleted_at.is_(None),
            HabitCheckin.user_id == user.id, HabitCheckin.deleted_at.is_(None), HabitCheckin.day >= start,
            HabitCheckin.day <= end_day).order_by(HabitCheckin.id), 'habit_checkins'):
            values[str(day)] += 1
        metric('habit_checkins', 'goals_habits', 'Внесённые отметки привычек', 'отметок', values)
        notes.append('Отметка привычки учитывается как запись, включая нулевое значение; это не число выполненных привычек.')

    if 'health' in selected:
        sleeps = rows(select(SleepEntry.id, SleepEntry.start_at, SleepEntry.end_at, SleepEntry.version).where(
            SleepEntry.user_id == user.id, SleepEntry.deleted_at.is_(None), SleepEntry.end_at >= lower,
            SleepEntry.end_at < upper).order_by(SleepEntry.id), 'sleep')
        sleep_values, invalid, manual_days = defaultdict(Decimal), set(), set()
        for _, a, b, _ in sleeps:
            day = str(b.astimezone(tz).date())
            manual_days.add(day)
            sleep_values[day] += Decimal(str((b - a).total_seconds())) / 3600
        cluster_end, cluster_days = None, set()
        for _, a, b, _ in sorted(sleeps, key=lambda row: (row[1], row[2])):
            day = str(b.astimezone(tz).date())
            if cluster_end is not None and a < cluster_end:
                invalid.update(cluster_days | {day})
                cluster_days.add(day)
                cluster_end = max(cluster_end, b)
            else:
                cluster_end, cluster_days = b, {day}
        invalid.update(day for day, value in sleep_values.items() if value > 25 or value <= 0)
        for day in invalid:
            sleep_values.pop(day, None)
        connection = db.get(HealthConnection, user.id)
        if connection:
            versions.append(['health_connection', connection.provider, connection.enabled, connection.revision])
        if connection and connection.enabled:
            snapshots = rows(select(HealthDaily.day, HealthDaily.sleep_seconds, HealthDaily.updated_at).where(
                HealthDaily.user_id == user.id, HealthDaily.provider == connection.provider,
                HealthDaily.timezone == user.timezone, HealthDaily.day >= start, HealthDaily.day <= end_day)
                .order_by(HealthDaily.day), 'device_sleep')
            for day, seconds, _ in snapshots:
                if seconds is not None and str(day) not in manual_days:
                    sleep_values[str(day)] = Decimal(seconds) / 3600
        metric('sleep_hours', 'health', 'Записанный сон', 'ч', sleep_values)
        if invalid:
            notes.append(f'Исключено дней с пересекающимися или некорректными записями сна: {len(invalid)}. Проверьте исходные записи.')
        notes.append('Сон относится к местной дате пробуждения. Ручные записи имеют приоритет над импортом за тот же день.')
        workouts = defaultdict(Decimal)
        for _, day, minutes, _ in rows(select(Workout.id, Workout.day, Workout.minutes, Workout.version).where(
            Workout.user_id == user.id, Workout.deleted_at.is_(None), Workout.day >= start,
            Workout.day <= end_day).order_by(Workout.id), 'workouts'):
            workouts[str(day)] += minutes
        metric('workout_minutes', 'health', 'Записанные тренировки', 'мин', workouts)

    if 'finance' in selected:
        values = defaultdict(Decimal)
        for _, day, amount, _ in rows(select(Transaction.id, Transaction.day, Transaction.amount, Transaction.version).where(
            Transaction.user_id == user.id, Transaction.deleted_at.is_(None), Transaction.kind == 'expense',
            Transaction.currency == currency, Transaction.day >= start, Transaction.day <= end_day)
            .order_by(Transaction.id), 'expenses'):
            values[str(day)] += amount
        metric('expenses', 'finance', 'Внесённые расходы', currency, values)

    if 'books' in selected:
        values = defaultdict(Decimal)
        for _, day, _ in rows(select(DiaryEntry.id, DiaryEntry.day, DiaryEntry.version).where(DiaryEntry.user_id == user.id,
            DiaryEntry.deleted_at.is_(None), DiaryEntry.day >= start, DiaryEntry.day <= end_day)
            .order_by(DiaryEntry.id), 'diary_entries'):
            values[str(day)] += 1
        metric('diary_entries', 'books', 'Записи дневника', 'записей', values)

    comparisons, coverage = [], []
    for left, right in itertools.combinations(metrics, 2):
        if left['module'] == right['module']:
            continue
        common = set(left['values']) & set(right['values'])
        candidate = compare(left, right)
        coverage.append({'x': left['key'], 'y': right['key'], 'paired_days': len(common), 'comparable': bool(candidate)})
        if candidate:
            comparisons.append(candidate)
    notes.append('Дневные показатели округлены до 0,01 перед сравнением. Медиана и группы рассчитаны по этим отображаемым значениям.')
    data = {'start_day': str(start), 'end_day': str(end_day), 'days': days, 'modules': selected, 'currency': currency,
        'metrics': [{**m, 'values': {day: number(v) for day, v in sorted(m['values'].items())},
            'recorded_days': len(m['values'])} for m in metrics], 'comparisons': comparisons, 'coverage': coverage,
        'notes': notes, 'limitation': 'Пропуски не считаются нулями. Сравниваются только общие дни с записями; выборка мала и может быть неполной. Причинные, медицинские и финансовые рекомендации не формируются.'}
    source = {'scope': scope_hash, 'timezone': user.timezone, 'versions': versions, 'data': data}
    digest = hashlib.sha256(json.dumps(source, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return data, digest, scope_hash
