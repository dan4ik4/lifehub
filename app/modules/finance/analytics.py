"""Exact, owner-scoped monthly facts and an explicitly conditional spending scenario."""
import calendar
import hashlib
import json
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo

from sqlalchemy import select
from app.core.database import utcnow
from app.core.errors import AppError
from app.modules.finance.models import Transaction, Budget, Subscription
from app.modules.finance.recurring import next_payment

CATEGORY_NAMES = {'food': 'Еда', 'transport': 'Транспорт', 'home': 'Дом', 'health': 'Здоровье',
    'leisure': 'Досуг', 'other': 'Другое', 'income': 'Доход'}


def money(value):
    return format(Decimal(value).quantize(Decimal('.01'), rounding=ROUND_HALF_UP), '.2f')


def month_end(start):
    return start.replace(day=calendar.monthrange(start.year, start.month)[1])


def build(db, user, month, currency, coverage_start=None):
    start = date.fromisoformat(month + '-01')
    today = utcnow().astimezone(ZoneInfo(user.timezone)).date()
    if start > today.replace(day=1):
        raise AppError(422, 'invalid_month', 'Выберите текущий или прошедший месяц.')
    end = month_end(start)
    current = today <= end
    cutoff = min(end, today - timedelta(days=1))
    elapsed = max(0, (cutoff - start).days + 1)
    previous_start = (start - timedelta(days=1)).replace(day=1)
    previous_end = previous_start.replace(day=min(elapsed, month_end(previous_start).day)) if elapsed else previous_start - timedelta(days=1)
    if coverage_start and (not current or not start <= coverage_start <= cutoff):
        raise AppError(422, 'invalid_coverage', 'Для прогноза выберите начало полного учёта в текущем месяце, не позже вчерашнего дня.')
    rows = db.scalars(select(Transaction).where(Transaction.user_id == user.id,
        Transaction.deleted_at.is_(None), Transaction.currency == currency,
        Transaction.day >= previous_start, Transaction.day <= cutoff).order_by(Transaction.id).limit(10001)).all()
    budgets = db.scalars(select(Budget).where(Budget.user_id == user.id, Budget.deleted_at.is_(None),
        Budget.month == month, Budget.currency == currency).order_by(Budget.id).limit(301)).all()
    subscriptions = db.scalars(select(Subscription).where(Subscription.user_id == user.id,
        Subscription.deleted_at.is_(None), Subscription.currency == currency).order_by(Subscription.id).limit(301)).all() if current else []
    if len(rows) > 10000 or len(budgets) > 300 or len(subscriptions) > 300:
        raise AppError(422, 'analysis_too_large', 'Для одного разбора: до 10 000 операций за два месяца, 300 бюджетов и 300 подписок.')
    values = [r for r in rows if start <= r.day <= cutoff]
    previous = [r for r in rows if previous_start <= r.day <= previous_end]
    expense = sum((r.amount for r in values if r.kind == 'expense'), Decimal(0))
    income = sum((r.amount for r in values if r.kind == 'income'), Decimal(0))
    prior_expense = sum((r.amount for r in previous if r.kind == 'expense'), Decimal(0))
    categories = defaultdict(Decimal)
    for row in values:
        if row.kind == 'expense':
            categories[row.category] += row.amount
    if len(categories) > 100:
        raise AppError(422, 'analysis_too_large', 'Для одного разбора: до 100 категорий расходов.')
    facts = []
    def fact(key, text):
        facts.append({'id': key, 'text': text})
    fact('observed', f'В расчёте {len(values)} операций за {elapsed} завершённых дней. Дни без записей не подтверждают отсутствие расходов.')
    if values:
        fact('totals', f'Внесено: доходы {money(income)} {currency}, расходы {money(expense)} {currency}. Разница {money(income - expense)} {currency}; это не остаток банковского счёта.')
    if previous and values:
        fact('comparison', f'Расходы за {start} — {cutoff}: {money(expense)} {currency}; за {previous_start} — {previous_end}: {money(prior_expense)} {currency}. Полнота учёта может отличаться.')
    category_data = []
    for category, value in sorted(categories.items(), key=lambda pair: (-pair[1], pair[0])):
        key = 'category:' + hashlib.sha256(category.encode()).hexdigest()[:16]
        share = (value * 100 / expense).quantize(Decimal('.1'), rounding=ROUND_HALF_UP) if expense else Decimal(0)
        label = CATEGORY_NAMES.get(category, category)
        category_data.append({'category': category, 'label': label, 'amount': money(value), 'share': str(share)})
        fact(key, f'Категория «{label}»: {money(value)} {currency}, {share}% внесённых расходов.')
    budget_data = []
    for budget in budgets:
        spent = categories.get(budget.category, Decimal(0))
        budget_data.append({'id': str(budget.id), 'category': budget.category, 'amount': money(budget.amount),
            'spent': money(spent), 'remaining': money(budget.amount - spent)})
        label = CATEGORY_NAMES.get(budget.category, budget.category)
        fact('budget:' + str(budget.id), f'Бюджет «{label}»: внесено расходов {money(spent)} из {money(budget.amount)} {currency}; разница {money(budget.amount - spent)} {currency}.')
    upcoming_count, upcoming_total = 0, Decimal(0)
    if current:
        for subscription in subscriptions:
            day = next_payment(subscription, max(start, cutoff + timedelta(days=1)))
            while day <= end:
                upcoming_count += 1
                upcoming_total += subscription.amount
                day = next_payment(subscription, day + timedelta(days=1))
        if upcoming_count:
            fact('recurring', f'По расписаниям подписок до конца месяца: {upcoming_count} платежей на {money(upcoming_total)} {currency}. Они показаны отдельно и не прибавляются к прогнозу, чтобы избежать двойного счёта; это не подтверждение неоплаченных счетов.')
    forecast = None
    reason = 'closed_month' if not current else 'coverage_required'
    if coverage_start:
        observed_days = (cutoff - coverage_start).days + 1
        window_expense = sum((r.amount for r in values if r.kind == 'expense' and r.day >= coverage_start), Decimal(0))
        if observed_days < 7:
            reason = 'too_few_days'
        elif not any(r.kind == 'expense' and r.day >= coverage_start for r in values):
            reason = 'no_expenses'
        else:
            remaining = (end - cutoff).days
            extra = window_expense * remaining / observed_days
            forecast = {'coverage_start': str(coverage_start), 'coverage_end': str(cutoff), 'observed_days': observed_days,
                'observed_expense': money(window_expense), 'daily_average': money(window_expense / observed_days),
                'remaining_days': remaining, 'additional_expense': money(extra), 'month_expense': money(expense + extra)}
            reason = None
            gap = f' Полнота учёта до {coverage_start} не подтверждена; пропущенные расходы не восстанавливаются.' if coverage_start > start else ''
            fact('forecast', f'Если средний темп сохранится: за оставшиеся {remaining} дней около {money(extra)} {currency}; внесённые расходы месяца плюс сценарий — около {money(expense + extra)} {currency}. Основа: {money(window_expense)} {currency} за {observed_days} подтверждённых пользователем дней. Это условный сценарий, не гарантия.' + gap)
    data = {'month': month, 'currency': currency, 'current': current, 'start_day': str(start), 'end_day': str(end),
        'cutoff': str(cutoff) if elapsed else None, 'completed_days': elapsed, 'transaction_count': len(values),
        'income': money(income), 'expense': money(expense), 'net_flow': money(income - expense),
        'previous': {'start_day': str(previous_start), 'end_day': str(previous_end) if elapsed else None,
            'expense': money(prior_expense), 'transaction_count': len(previous)},
        'categories': category_data, 'budgets': budget_data,
        'upcoming_subscriptions': {'count': upcoming_count, 'amount': money(upcoming_total)},
        'forecast': forecast, 'forecast_reason': reason, 'facts': facts,
        'questions': ['check_coverage', 'review_categories'] + (['review_budget'] if budgets else []) + (['check_recurring'] if upcoming_count else [])}
    # Include relevant source versions, even if an edit happens to retain the same totals.
    source = {'data': data, 'timezone': user.timezone, 'coverage_start': str(coverage_start),
        'versions': [(str(r.id), r.version) for r in rows + budgets + subscriptions]}
    encoded = json.dumps(source, sort_keys=True, ensure_ascii=False)
    if len(json.dumps(data, ensure_ascii=False)) > 60000:
        raise AppError(422, 'analysis_too_large', 'Слишком много данных для одного разбора. Сократите число категорий или бюджетов.')
    return data, hashlib.sha256(encoded.encode()).hexdigest()
