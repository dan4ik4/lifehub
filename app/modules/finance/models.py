from datetime import date
from decimal import Decimal
from uuid import UUID
from sqlalchemy import Date, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.core.owned import OwnedRecord


class Transaction(OwnedRecord, Base):
    __tablename__ = "finance_transactions"
    day: Mapped[date] = mapped_column(Date, index=True)
    title: Mapped[str] = mapped_column(String(300))
    kind: Mapped[str] = mapped_column(String(8))
    amount: Mapped[Decimal] = mapped_column(Numeric(16, 2))
    currency: Mapped[str] = mapped_column(String(3))
    category: Mapped[str] = mapped_column(String(100))
    notes: Mapped[str] = mapped_column(Text, default="")


class Budget(OwnedRecord, Base):
    __tablename__ = "finance_budgets"
    month: Mapped[str] = mapped_column(String(7), index=True)
    category: Mapped[str] = mapped_column(String(100))
    amount: Mapped[Decimal] = mapped_column(Numeric(16, 2))
    currency: Mapped[str] = mapped_column(String(3))


class Subscription(OwnedRecord, Base):
    __tablename__ = "finance_subscriptions"
    title: Mapped[str] = mapped_column(String(300))
    amount: Mapped[Decimal] = mapped_column(Numeric(16, 2))
    currency: Mapped[str] = mapped_column(String(3))
    period: Mapped[str] = mapped_column(String(12))
    next_payment: Mapped[date] = mapped_column(Date)


class Savings(OwnedRecord, Base):
    __tablename__ = "finance_savings"
    title: Mapped[str] = mapped_column(String(300))
    kind: Mapped[str] = mapped_column(String(20))
    amount: Mapped[Decimal] = mapped_column(Numeric(16, 2))
    currency: Mapped[str] = mapped_column(String(3))


class FinancialGoal(OwnedRecord, Base):
    __tablename__ = "finance_goals"
    title: Mapped[str] = mapped_column(String(300))
    target: Mapped[Decimal] = mapped_column(Numeric(16, 2))
    saved: Mapped[Decimal] = mapped_column(Numeric(16, 2))
    currency: Mapped[str] = mapped_column(String(3))
    due_date: Mapped[date] = mapped_column(Date)


class Debt(OwnedRecord, Base):
    __tablename__ = "finance_debts"
    title: Mapped[str] = mapped_column(String(300))
    direction: Mapped[str] = mapped_column(String(12))
    amount: Mapped[Decimal] = mapped_column(Numeric(16, 2))
    currency: Mapped[str] = mapped_column(String(3))
    due_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(10), default="active")


class DebtPayment(OwnedRecord, Base):
    __tablename__ = "finance_debt_payments"
    debt_id: Mapped[UUID] = mapped_column(ForeignKey("finance_debts.id", ondelete="CASCADE"), index=True)
    day: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Numeric(16, 2))


class SavingsHistory(OwnedRecord, Base):
    __tablename__ = "finance_savings_history"
    savings_id: Mapped[UUID] = mapped_column(ForeignKey("finance_savings.id", ondelete="CASCADE"), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(16, 2))
    currency: Mapped[str] = mapped_column(String(3))
    previous_amount: Mapped[Decimal | None] = mapped_column(Numeric(16, 2))
    previous_currency: Mapped[str | None] = mapped_column(String(3))
