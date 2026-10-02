from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, Query
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select, func
from app.core.database import utcnow
from app.core.dependencies import get_db
from app.core.errors import AppError
from app.core.owned import owned, record, require_module
from app.core.resource_api import add_resource
from app.modules.auth.dependencies import get_current_user
from app.modules.planning.dependencies import EntitlementService
from app.modules.finance.models import Transaction, Budget, Subscription, Savings, FinancialGoal, Debt, DebtPayment
from app.modules.finance.schemas import (
    TransactionInput,
    BudgetInput,
    SubscriptionInput,
    SavingsInput,
    FinancialGoalInput,
    DebtInput,
    PaymentInput,
)

router = APIRouter(prefix="/api/v1/finance", tags=["finance"])
BASE_CATEGORIES = ["food", "transport", "home", "health", "leisure", "other", "income"]


def member(user=Depends(get_current_user)):
    return require_module(user, "finance")


def today(user):
    return utcnow().astimezone(ZoneInfo(user.timezone)).date()


def transaction_valid(db, user, values, item):
    if values["day"] > today(user):
        raise AppError(422, "invalid_date", "Record actual transactions; use planning for future payments")
    if values["category"] not in BASE_CATEGORIES:
        EntitlementService.require_pro(user)


def budget_valid(db, user, values, item):
    query = select(Budget.id).where(
        Budget.user_id == user.id,
        Budget.deleted_at.is_(None),
        Budget.month == values["month"],
        Budget.category == values["category"],
        Budget.currency == values["currency"],
    )
    if item:
        query = query.where(Budget.id != item.id)
    if db.scalar(query):
        raise AppError(409, "duplicate_budget", "A budget already exists for this category, month and currency")


def debt_valid(db, user, values, item):
    if item:
        paid = db.scalar(
            select(func.coalesce(func.sum(DebtPayment.amount), 0)).where(
                DebtPayment.debt_id == item.id, DebtPayment.deleted_at.is_(None)
            )
        )
        if paid and (values["currency"] != item.currency or values["direction"] != item.direction):
            raise AppError(409, "debt_has_payments", "Currency and direction cannot change after a payment")
        if values["amount"] < paid:
            raise AppError(422, "invalid_amount", "Debt cannot be smaller than recorded payments")


@router.get("/categories")
def categories(user=Depends(member), db=Depends(get_db)):
    custom = (
        list(
            db.scalars(
                select(Transaction.category)
                .where(Transaction.user_id == user.id, Transaction.deleted_at.is_(None))
                .distinct()
            )
        )
        if EntitlementService.is_pro(user)
        else []
    )
    return {"items": sorted(set(BASE_CATEGORIES + custom))}


@router.get("/overview")
def overview(
    month: str = Query(pattern=r"^[1-8][0-9]{3}-(0[1-9]|1[0-2])$"),
    currency: str = Query(pattern=r"^[A-Z]{3}$"),
    user=Depends(member),
    db=Depends(get_db),
):
    start = date.fromisoformat(month + "-01")
    end = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    rows = db.execute(
        select(Transaction.kind, Transaction.category, func.sum(Transaction.amount))
        .where(
            Transaction.user_id == user.id,
            Transaction.deleted_at.is_(None),
            Transaction.currency == currency,
            Transaction.day >= start,
            Transaction.day < end,
        )
        .group_by(Transaction.kind, Transaction.category)
    ).all()
    income = sum((v for kind, c, v in rows if kind == "income"), Decimal(0))
    expense = sum((v for kind, c, v in rows if kind == "expense"), Decimal(0))
    result = {
        "month": month,
        "currency": currency,
        "income": income,
        "expense": expense,
        "balance": income - expense,
        "categories": [{"category": c, "amount": v} for kind, c, v in rows if kind == "expense"],
    }
    if EntitlementService.is_pro(user):
        budgets = db.scalars(
            select(Budget).where(
                Budget.user_id == user.id,
                Budget.deleted_at.is_(None),
                Budget.month == month,
                Budget.currency == currency,
            )
        ).all()
        spent = {c: v for kind, c, v in rows if kind == "expense"}
        result["budgets"] = [
            {
                **record(b),
                "spent": spent.get(b.category, 0),
                "remaining": b.amount - spent.get(b.category, 0),
                "percent": round(100 * spent.get(b.category, 0) / b.amount),
            }
            for b in budgets
        ]
        savings = db.scalar(
            select(func.coalesce(func.sum(Savings.amount), 0)).where(
                Savings.user_id == user.id, Savings.deleted_at.is_(None), Savings.currency == currency
            )
        )
        net = savings
        for debt in db.scalars(
            select(Debt).where(
                Debt.user_id == user.id, Debt.deleted_at.is_(None), Debt.status == "active", Debt.currency == currency
            )
        ):
            paid = db.scalar(
                select(func.coalesce(func.sum(DebtPayment.amount), 0)).where(
                    DebtPayment.debt_id == debt.id, DebtPayment.deleted_at.is_(None)
                )
            )
            net += (debt.amount - paid) * (1 if debt.direction == "owed_to_me" else -1)
        result["net_worth"] = net
    return jsonable_encoder(result, custom_encoder={Decimal: str})


@router.post("/debts/{debt_id}/payments", status_code=201)
def pay(debt_id: UUID, body: PaymentInput, user=Depends(member), db=Depends(get_db)):
    EntitlementService.require_pro(user)
    debt = owned(db, Debt, user, debt_id, body.version)
    if debt.status != "active":
        raise AppError(409, "debt_archived", "Restore the debt first")
    if body.day > today(user):
        raise AppError(422, "invalid_date", "Payment must not be in the future")
    paid = db.scalar(
        select(func.coalesce(func.sum(DebtPayment.amount), 0)).where(
            DebtPayment.debt_id == debt.id, DebtPayment.deleted_at.is_(None)
        )
    )
    if paid + body.amount > debt.amount:
        raise AppError(422, "payment_exceeds_debt", "Payment exceeds the outstanding balance")
    item = DebtPayment(user_id=user.id, debt_id=debt.id, day=body.day, amount=body.amount)
    db.add(item)
    debt.updated_at = utcnow()
    if paid + body.amount == debt.amount:
        debt.status = "archived"
    db.commit()
    return {"payment": record(item), "debt": record(debt), "remaining": str(debt.amount - paid - body.amount)}


@router.get("/debts/{debt_id}/payments")
def payments(debt_id: UUID, user=Depends(member), db=Depends(get_db)):
    EntitlementService.require_pro(user)
    debt = owned(db, Debt, user, debt_id)
    items = db.scalars(
        select(DebtPayment)
        .where(DebtPayment.debt_id == debt.id, DebtPayment.deleted_at.is_(None))
        .order_by(DebtPayment.day)
    ).all()
    return {
        "items": [record(p) for p in items],
        "remaining": str(debt.amount - sum((p.amount for p in items), Decimal(0))),
    }


from app.modules.finance.models import SavingsHistory


def record_savings_history(db, user, item, previous):
    if previous and Decimal(previous["amount"]) == item.amount and previous["currency"] == item.currency:
        return
    db.add(
        SavingsHistory(
            user_id=user.id,
            savings_id=item.id,
            amount=item.amount,
            currency=item.currency,
            previous_amount=Decimal(previous["amount"]) if previous else None,
            previous_currency=previous["currency"] if previous else None,
        )
    )


@router.get("/savings/{savings_id}/history")
def savings_history(savings_id: UUID, offset: int = Query(0, ge=0), user=Depends(member), db=Depends(get_db)):
    EntitlementService.require_pro(user)
    owned(db, Savings, user, savings_id)
    rows = db.scalars(
        select(SavingsHistory)
        .where(SavingsHistory.savings_id == savings_id, SavingsHistory.user_id == user.id)
        .order_by(SavingsHistory.created_at.desc(), SavingsHistory.id)
        .offset(offset)
        .limit(101)
    ).all()
    return {"items": [record(r) for r in rows[:100]], "has_more": len(rows) > 100}


for path, model, schema, paid, validator in [
    ("/transactions", Transaction, TransactionInput, False, transaction_valid),
    ("/budgets", Budget, BudgetInput, True, budget_valid),
    ("/subscriptions", Subscription, SubscriptionInput, True, None),
    ("/savings", Savings, SavingsInput, True, None),
    ("/goals", FinancialGoal, FinancialGoalInput, True, None),
    ("/debts", Debt, DebtInput, True, debt_valid),
]:

    def serialize(item, user):
        result = record(item)
        if isinstance(item, Subscription):
            from app.modules.finance.recurring import next_payment

            result["next_due"] = next_payment(item, today(user))
        if isinstance(item, FinancialGoal):
            from decimal import ROUND_CEILING

            day = today(user)
            months = max(
                1,
                (item.due_date.year - day.year) * 12 + item.due_date.month - day.month + (item.due_date.day >= day.day),
            )
            result["monthly_needed"] = str(
                (max(Decimal(0), item.target - item.saved) / months).quantize(Decimal(".01"), rounding=ROUND_CEILING)
            )
        return result

    add_resource(
        router,
        path,
        model,
        schema,
        "finance",
        pro_only=paid,
        validate=validator,
        serialize=serialize,
        after_write=record_savings_history if model is Savings else None,
    )
