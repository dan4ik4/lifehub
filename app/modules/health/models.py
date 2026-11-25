from datetime import date, datetime
from decimal import Decimal
from uuid import UUID
from sqlalchemy import Date, Integer, JSON, Numeric, String, Text, ForeignKey, UniqueConstraint, Boolean, Uuid
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
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")


class Workout(OwnedRecord, Base):
    __tablename__ = "health_workouts"
    day: Mapped[date] = mapped_column(Date, index=True)
    title: Mapped[str] = mapped_column(String(300))
    minutes: Mapped[int] = mapped_column(Integer)
    notes: Mapped[str] = mapped_column(Text, default="")
    efforts: Mapped[list[dict]] = mapped_column(JSON, default=list, server_default="[]")
    program_id: Mapped[UUID | None] = mapped_column(Uuid, nullable=True)


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
    weekdays: Mapped[list[int]] = mapped_column(JSON, default=lambda: list(range(7)), server_default="[0,1,2,3,4,5,6]")
    course_end: Mapped[date | None] = mapped_column(Date)
    stock: Mapped[int | None] = mapped_column(Integer)
    stock_since: Mapped[datetime | None] = mapped_column(UTCDateTime)

    def scheduled(self, day):
        return day.weekday() in self.weekdays and (self.course_end is None or day <= self.course_end)


class MedicationIntake(OwnedRecord, Base):
    __tablename__ = "health_medication_intakes"
    medication_id: Mapped[UUID] = mapped_column(ForeignKey("health_medications.id", ondelete="CASCADE"), index=True)
    day: Mapped[date] = mapped_column(Date, index=True)
    time: Mapped[str] = mapped_column(String(5))
    skipped: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    taken_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    __table_args__ = (UniqueConstraint("medication_id", "day", "time", name="uq_medication_intake_slot"),)


class WorkoutProgram(OwnedRecord, Base):
    __tablename__ = "health_programs"
    title: Mapped[str] = mapped_column(String(300))
    exercises: Mapped[list[dict]] = mapped_column(JSON)


class WeightTarget(OwnedRecord, Base):
    __tablename__ = "health_weight_targets"
    kg: Mapped[Decimal] = mapped_column(Numeric(7, 3))
    mode: Mapped[str] = mapped_column(String(8), default="maintain", server_default="maintain")


class NutritionTarget(OwnedRecord, Base):
    __tablename__ = "health_nutrition_targets"
    calories: Mapped[int] = mapped_column(Integer)
    protein: Mapped[int] = mapped_column(Integer)
    fat: Mapped[int] = mapped_column(Integer)
    carbs: Mapped[int] = mapped_column(Integer)


class HealthConnection(Base):
    __tablename__ = "health_connections"
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    provider: Mapped[str] = mapped_column(String(20))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    sync_token: Mapped[UUID] = mapped_column(Uuid)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    last_synced_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)


class HealthDaily(Base):
    __tablename__ = "health_device_days"
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    provider: Mapped[str] = mapped_column(String(20), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    timezone: Mapped[str] = mapped_column(String(100))
    steps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sleep_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime)
