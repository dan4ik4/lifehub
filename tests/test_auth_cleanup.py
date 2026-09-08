from datetime import timedelta
from uuid import uuid4

from sqlalchemy import select

from app.core.database import utcnow
from app.modules.auth.cleanup import cleanup_expired_auth
from app.modules.auth.models import EmailChangeChallenge, LoginAttempt, PasswordResetToken, PendingRegistration


def test_cleanup_preserves_live_send_budgets_and_active_lockouts(db, make_user):
    now = utcnow()
    user1, user2 = make_user(), make_user()
    for number, expiry in enumerate([now - timedelta(seconds=1), now + timedelta(hours=1)]):
        db.add(PendingRegistration(email=f"pending{number}@example.com", password_hash="hash", otp_hash="hash", name="",
            expires_at=expiry, otp_expires_at=now - timedelta(minutes=1), last_sent_at=now - timedelta(seconds=61 if number == 0 else 30),
            attempts=5, resend_count=2, locked_at=now - timedelta(minutes=2)))
        user = user1 if number == 0 else user2
        db.add(EmailChangeChallenge(user_id=user.id, new_email=f"changed{number}@example.com", otp_hash="hash",
            registration_expires_at=expiry, expires_at=now - timedelta(minutes=1), last_sent_at=now - timedelta(minutes=11), resend_count=2))
        db.add(PasswordResetToken(user_id=user.id, token_hash="hash", expires_at=expiry, last_sent_at=now - timedelta(minutes=11)))
        db.add(LoginAttempt(email=f"login{number}@example.com", failures=5, blocked_until=expiry))
    db.commit()
    counts = cleanup_expired_auth(db, now)
    assert counts == {"pending_registrations": 1, "password_reset_tokens": 1, "email_change_challenges": 1, "login_attempts": 1}
    db.expire_all()
    pending = db.scalars(select(PendingRegistration)).all()
    assert len(pending) == 1 and pending[0].locked_at is not None and pending[0].resend_count == 2
    changes = db.scalars(select(EmailChangeChallenge)).all()
    assert len(changes) == 1 and changes[0].resend_count == 2


def test_cleanup_releases_exhausted_registration_after_cooldown_but_keeps_active_third_code(db):
    now = utcnow()
    for number, locked in enumerate([True, False]):
        db.add(PendingRegistration(email=f"budget{number}@example.com", password_hash="hash", otp_hash="hash", name="",
            expires_at=now + timedelta(hours=12), otp_expires_at=now + timedelta(minutes=8),
            last_sent_at=now - timedelta(seconds=61), attempts=5 if locked else 0, resend_count=2,
            locked_at=now if locked else None))
    db.commit()
    assert cleanup_expired_auth(db, now)["pending_registrations"] == 1
    remaining = db.scalars(select(PendingRegistration)).all()
    assert len(remaining) == 1 and remaining[0].locked_at is None and remaining[0].resend_count == 2
