from datetime import date
from decimal import Decimal
from typing import Annotated, Literal
from pydantic import Field, model_validator
from app.modules.planning.schemas import InputModel

Money = Annotated[Decimal, Field(gt=0, max_digits=16, decimal_places=2)]
Nonnegative = Annotated[Decimal, Field(ge=0, max_digits=16, decimal_places=2)]
Currency = Annotated[str, Field(pattern=r"^[A-Z]{3}$")]
Title = Annotated[str, Field(min_length=1, max_length=300)]


class TransactionInput(InputModel):
    day: date
    title: Title
    kind: Literal["income", "expense"]
    amount: Money
    currency: Currency
    category: str = Field(min_length=1, max_length=100)
    notes: str = Field(default="", max_length=20000)


class BudgetInput(InputModel):
    month: str = Field(pattern=r"^[1-8][0-9]{3}-(0[1-9]|1[0-2])$")
    category: str = Field(min_length=1, max_length=100)
    amount: Money
    currency: Currency


class SubscriptionInput(InputModel):
    title: Title
    amount: Money
    currency: Currency
    period: Literal["weekly", "monthly", "yearly"]
    next_payment: date


class SavingsInput(InputModel):
    title: Title
    kind: Literal["cash", "bank", "deposit", "investment", "other"]
    amount: Nonnegative
    currency: Currency


class FinancialGoalInput(InputModel):
    title: Title
    target: Money
    saved: Nonnegative = Decimal(0)
    currency: Currency
    due_date: date


class DebtInput(InputModel):
    title: Title
    direction: Literal["i_owe", "owed_to_me"]
    amount: Money
    currency: Currency
    due_date: date | None = None
    status: Literal["active", "archived"] = "active"


class PaymentInput(InputModel):
    day: date
    amount: Money
    version: int = Field(ge=1)
