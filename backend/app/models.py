import uuid
from datetime import UTC, date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
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
    __table_args__ = (UniqueConstraint("kid_id", "kind", "anchor_at"),)
    id: Mapped[uuid.UUID] = _pk()
    kid_id: Mapped[uuid.UUID] = _fk("kids")
    kind: Mapped[str] = mapped_column(String(20))
    anchor_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    level: Mapped[int] = mapped_column(Integer, default=0)
    last_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class NotificationPref(Base):
    __tablename__ = "notification_prefs"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), primary_key=True)
    enabled: Mapped[bool] = mapped_column(default=True)
