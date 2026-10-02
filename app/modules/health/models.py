from datetime import date, datetime
from decimal import Decimal
from uuid import UUID
from sqlalchemy import Date, Integer, JSON, Numeric, String, Text, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base, UTCDateTime
from app.core.owned import OwnedRecord


class SleepEntry(OwnedRecord, Base):
    __tablename__ = "health_sleep"
    start_at: Mapped[datetime] = mapped_column(UTCDateTime)
    end_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    quality: Mapped[int] = mapped_column(Integer)


class WeightEntry(OwnedRecord, Base):
    __tablename__ = "health_weight"
    day: Mapped[date] = mapped_column(Date, index=True)
    kg: Mapped[Decimal] = mapped_column(Numeric(7, 3))


class Workout(OwnedRecord, Base):
    __tablename__ = "health_workouts"
    day: Mapped[date] = mapped_column(Date, index=True)
    title: Mapped[str] = mapped_column(String(300))
    minutes: Mapped[int] = mapped_column(Integer)
    notes: Mapped[str] = mapped_column(Text, default="")


class NutritionEntry(OwnedRecord, Base):
    __tablename__ = "health_nutrition"
    day: Mapped[date] = mapped_column(Date, index=True)
    meal: Mapped[str] = mapped_column(String(12))
    title: Mapped[str] = mapped_column(String(300))
    calories: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    protein: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    fat: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    carbs: Mapped[Decimal] = mapped_column(Numeric(10, 2))


class Medication(OwnedRecord, Base):
    __tablename__ = "health_medications"
    title: Mapped[str] = mapped_column(String(300))
    dosage: Mapped[str] = mapped_column(String(100))
    times: Mapped[list[str]] = mapped_column(JSON)


class MedicationIntake(OwnedRecord, Base):
    __tablename__ = "health_medication_intakes"
    medication_id: Mapped[UUID] = mapped_column(ForeignKey("health_medications.id", ondelete="CASCADE"), index=True)
    day: Mapped[date] = mapped_column(Date, index=True)
    time: Mapped[str] = mapped_column(String(5))
    __table_args__ = (UniqueConstraint("medication_id", "day", "time", name="uq_medication_intake_slot"),)


class WorkoutProgram(OwnedRecord, Base):
    __tablename__ = "health_programs"
    title: Mapped[str] = mapped_column(String(300))
    exercises: Mapped[list[dict]] = mapped_column(JSON)


class WeightTarget(OwnedRecord, Base):
    __tablename__ = "health_weight_targets"
    kg: Mapped[Decimal] = mapped_column(Numeric(7, 3))
