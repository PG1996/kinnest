import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, validates


def _now() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


def _pk() -> Mapped[uuid.UUID]:
    return mapped_column(primary_key=True, default=uuid.uuid4)


def _fk(table: str) -> Mapped[uuid.UUID]:
    return mapped_column(ForeignKey(f"{table}.id"), index=True)


def _created() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), default=_now)


ROLES = ("admin", "caregiver", "viewer")


class Family(Base):
    __tablename__ = "families"
    id: Mapped[uuid.UUID] = _pk()
    name: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = _created()


class Kid(Base):
    __tablename__ = "kids"
    id: Mapped[uuid.UUID] = _pk()
    family_id: Mapped[uuid.UUID] = _fk("families")
    name: Mapped[str] = mapped_column(String(120))
    birth_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    feed_interval_minutes: Mapped[int] = mapped_column(Integer, default=180)
    diaper_alert_minutes: Mapped[int] = mapped_column(Integer, default=240)
    created_at: Mapped[datetime] = _created()


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = _pk()
    email: Mapped[str] = mapped_column(String(320), unique=True)
    name: Mapped[str] = mapped_column(String(120), default="")
    session_version: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = _created()

    @validates("email")
    def _lower_email(self, _key: str, value: str) -> str:
        return value.strip().lower()


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (
        UniqueConstraint("family_id", "user_id"),
        CheckConstraint("role in ('admin','caregiver','viewer')", name="ck_membership_role"),
    )
    id: Mapped[uuid.UUID] = _pk()
    family_id: Mapped[uuid.UUID] = _fk("families")
    user_id: Mapped[uuid.UUID] = _fk("users")
    role: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = _created()


class Invite(Base):
    __tablename__ = "invites"
    __table_args__ = (
        CheckConstraint("role in ('admin','caregiver','viewer')", name="ck_invite_role"),
    )
    id: Mapped[uuid.UUID] = _pk()
    family_id: Mapped[uuid.UUID] = _fk("families")
    email: Mapped[str] = mapped_column(String(320), index=True)
    role: Mapped[str] = mapped_column(String(20))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = _created()

    @validates("email")
    def _lower_email(self, _key: str, value: str) -> str:
        return value.strip().lower()


FEED_TYPES = ("breast_left", "breast_right", "breast_both", "expressed", "formula")
DIAPER_KINDS = ("wet", "dirty", "both")


class Feed(Base):
    __tablename__ = "feeds"
    __table_args__ = (
        CheckConstraint(
            "type in ('breast_left','breast_right','breast_both','expressed','formula')",
            name="ck_feed_type",
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)  # client-supplied
    family_id: Mapped[uuid.UUID] = _fk("families")
    kid_id: Mapped[uuid.UUID] = _fk("kids")
    type: Mapped[str] = mapped_column(String(20))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    duration_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    quantity_ml: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fed_by_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Diaper(Base):
    __tablename__ = "diapers"
    __table_args__ = (
        CheckConstraint("kind in ('wet','dirty','both')", name="ck_diaper_kind"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)  # client-supplied
    family_id: Mapped[uuid.UUID] = _fk("families")
    kid_id: Mapped[uuid.UUID] = _fk("kids")
    kind: Mapped[str] = mapped_column(String(10))
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    changed_by_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _fk("users")
    endpoint: Mapped[str] = mapped_column(Text, unique=True)
    p256dh: Mapped[str] = mapped_column(Text)
    auth: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = _created()


class ReminderState(Base):
    __tablename__ = "reminder_states"
    # subject_id tells chains of the same kind apart (one per medicine); NULL for feed and diaper chains,
    # and NULLS NOT DISTINCT keeps those unique too.
    __table_args__ = (
        UniqueConstraint(
            "kid_id", "kind", "subject_id", "anchor_at", name="uq_reminder_state_chain", postgresql_nulls_not_distinct=True
        ),
    )
    id: Mapped[uuid.UUID] = _pk()
    kid_id: Mapped[uuid.UUID] = _fk("kids")
    kind: Mapped[str] = mapped_column(String(20))
    subject_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    anchor_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    level: Mapped[int] = mapped_column(Integer, default=0)
    last_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class NotificationPref(Base):
    __tablename__ = "notification_prefs"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), primary_key=True)
    enabled: Mapped[bool] = mapped_column(default=True)


class MagicToken(Base):
    __tablename__ = "magic_tokens"
    id: Mapped[uuid.UUID] = _pk()
    email: Mapped[str] = mapped_column(String(320))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = _created()


class Medicine(Base):
    __tablename__ = "medicines"
    __table_args__ = (
        CheckConstraint("schedule_kind in ('fixed','interval','as_needed')", name="ck_medicine_kind"),
        CheckConstraint(
            "dose_amount is null or (dose_amount > 0 and dose_amount <= 10000)", name="ck_medicine_dose_amount"
        ),
        CheckConstraint(
            "dose_unit is null or dose_unit in ('ml','drops','mg','mcg','g','IU','tablet','puff')",
            name="ck_medicine_dose_unit",
        ),
    )
    id: Mapped[uuid.UUID] = _pk()
    family_id: Mapped[uuid.UUID] = _fk("families")
    kid_id: Mapped[uuid.UUID] = _fk("kids")
    name: Mapped[str] = mapped_column(String(120))
    dose_amount: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)
    dose_unit: Mapped[str | None] = mapped_column(String(10), nullable=True)
    schedule_kind: Mapped[str] = mapped_column(String(20))
    times: Mapped[list[str]] = mapped_column(JSON, default=list)  # "HH:MM" in the family timezone, fixed only
    interval_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    first_dose_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    min_gap_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class MedicineDose(Base):
    __tablename__ = "medicine_doses"
    __table_args__ = (
        CheckConstraint("status in ('given','skipped')", name="ck_dose_status"),
        CheckConstraint("amount is null or amount > 0", name="ck_dose_amount"),
        # a slot can hold several pieces; the API enforces that they never add up to more than the prescribed amount
        Index("ix_dose_slot", "medicine_id", "scheduled_for"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)  # client-supplied
    family_id: Mapped[uuid.UUID] = _fk("families")
    kid_id: Mapped[uuid.UUID] = _fk("kids")
    medicine_id: Mapped[uuid.UUID] = _fk("medicines")
    status: Mapped[str] = mapped_column(String(10))
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    given_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    amount: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)  # None: legacy dose, counts as a full one
    # the dose this slot was prescribed when the piece was given, so editing the medicine later cannot reinterpret it
    prescribed_amount: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)
    prescribed_unit: Mapped[str | None] = mapped_column(String(10), nullable=True)
    by_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SleepSession(Base):
    __tablename__ = "sleep_sessions"
    __table_args__ = (
        # at most one open session per kid
        Index(
            "uq_one_open_sleep", "kid_id", unique=True, postgresql_where=text("ended_at IS NULL AND deleted_at IS NULL")
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)  # client-supplied
    family_id: Mapped[uuid.UUID] = _fk("families")
    kid_id: Mapped[uuid.UUID] = _fk("kids")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_by_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    ended_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class MedicineNudge(Base):
    """A one-off "remind me about the rest of this dose" reminder."""

    __tablename__ = "medicine_nudges"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)  # client-supplied
    family_id: Mapped[uuid.UUID] = _fk("families")
    kid_id: Mapped[uuid.UUID] = _fk("kids")
    medicine_id: Mapped[uuid.UUID] = _fk("medicines")
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    remind_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = _created()
    fired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


PLACE_KINDS = ("home", "hospital", "clinic", "other")
# (column, low, high) — the database refuses anything outside; the API checks first to give a readable message
VITAL_RANGES = (
    ("weight_kg", "0.3", "60"),
    ("height_cm", "20", "150"),
    ("head_cm", "20", "60"),
    ("temperature_c", "30", "45"),
    ("heart_rate", "30", "300"),
    ("resp_rate", "5", "120"),
    ("spo2", "50", "100"),
)


class VitalEntry(Base):
    """One measuring moment: any subset of the measurements, with where and by whom."""

    __tablename__ = "vital_entries"
    __table_args__ = (
        CheckConstraint("place_kind in ('home','hospital','clinic','other')", name="ck_vital_place_kind"),
        *(
            CheckConstraint(f"{col} is null or ({col} >= {lo} and {col} <= {hi})", name=f"ck_vital_{col}")
            for col, lo, hi in VITAL_RANGES
        ),
        CheckConstraint(
            "num_nonnulls(" + ", ".join(col for col, _, _ in VITAL_RANGES) + ") > 0", name="ck_vital_any_measurement"
        ),
        Index("ix_vital_kid_measured", "kid_id", "measured_at"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)  # client-supplied
    family_id: Mapped[uuid.UUID] = _fk("families")
    kid_id: Mapped[uuid.UUID] = _fk("kids")
    measured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    place_kind: Mapped[str] = mapped_column(String(10))
    place_name: Mapped[str] = mapped_column(String(120), default="")
    measured_by: Mapped[str] = mapped_column(String(120), default="")
    note: Mapped[str] = mapped_column(Text, default="")
    weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    height_cm: Mapped[Decimal | None] = mapped_column(Numeric(4, 1), nullable=True)
    head_cm: Mapped[Decimal | None] = mapped_column(Numeric(4, 1), nullable=True)
    temperature_c: Mapped[Decimal | None] = mapped_column(Numeric(3, 1), nullable=True)
    heart_rate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    resp_rate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    spo2: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Vaccination(Base):
    __tablename__ = "vaccinations"
    __table_args__ = (
        CheckConstraint("status in ('pending','given','skipped')", name="ck_vaccination_status"),
        CheckConstraint("source in ('iap','uip','manual')", name="ck_vaccination_source"),
        CheckConstraint("status <> 'given' or given_on is not null", name="ck_vaccination_given_on"),
    )
    id: Mapped[uuid.UUID] = _pk()
    family_id: Mapped[uuid.UUID] = _fk("families")
    kid_id: Mapped[uuid.UUID] = _fk("kids")
    name: Mapped[str] = mapped_column(String(120))
    dose_label: Mapped[str] = mapped_column(String(60), default="")
    due_date: Mapped[date] = mapped_column(Date, index=True)
    given_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(10), default="pending")
    place: Mapped[str] = mapped_column(String(120), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(10), default="manual")
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DoctorVisit(Base):
    __tablename__ = "doctor_visits"
    __table_args__ = (
        CheckConstraint("status in ('upcoming','done','cancelled')", name="ck_visit_status"),
        Index("ix_visit_kid_scheduled", "kid_id", "scheduled_at"),
    )
    id: Mapped[uuid.UUID] = _pk()
    family_id: Mapped[uuid.UUID] = _fk("families")
    kid_id: Mapped[uuid.UUID] = _fk("kids")
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    doctor: Mapped[str] = mapped_column(String(120), default="")
    place: Mapped[str] = mapped_column(String(120), default="")
    reason: Mapped[str] = mapped_column(String(500), default="")
    status: Mapped[str] = mapped_column(String(10), default="upcoming")
    notes: Mapped[str] = mapped_column(Text, default="")
    prescription_notes: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
