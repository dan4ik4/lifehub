"""Expire authentication state without resetting live OTP send budgets."""
from datetime import timedelta

from sqlalchemy import and_, delete, or_

from app.core.database import utcnow
from app.modules.auth.models import EmailChangeChallenge, LoginAttempt, PasswordResetToken, PendingRegistration


def cleanup_expired_auth(session, now=None) -> dict[str, int]:
    now = now or utcnow()
    # An expired 10-minute OTP is not an expired 12-hour send budget.
    # Active pending and email-change budgets therefore survive until the latter.
    # Exhausted registrations may restart once their 60-second cooldown ends.
    conditions = {
        "pending_registrations": (PendingRegistration, and_(
            or_(PendingRegistration.expires_at <= now, PendingRegistration.locked_at.is_not(None)),
            PendingRegistration.last_sent_at <= now - timedelta(seconds=60))),
        "password_reset_tokens": (PasswordResetToken, PasswordResetToken.expires_at <= now),
        "email_change_challenges": (EmailChangeChallenge, EmailChangeChallenge.registration_expires_at <= now),
        "login_attempts": (LoginAttempt, LoginAttempt.blocked_until <= now),
    }
    deleted = {}
    for name, (model, condition) in conditions.items():
        deleted[name] = session.execute(delete(model).where(condition).execution_options(synchronize_session=False)).rowcount
    session.commit()
    return deleted
