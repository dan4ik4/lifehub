from datetime import timedelta
from math import ceil
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.database import utcnow
from app.core.errors import AppError
from app.modules.auth.crud import AuthCrud, UserCrud
from app.modules.auth.models import AuthIdentity, EmailChangeChallenge, LoginAttempt, PasswordResetToken, PendingRegistration, User
from app.modules.auth.otp import OtpService
from app.modules.auth.passwords import password_hasher
from app.modules.auth.schemas import AuthSessionResponse, MessageResponse, OtpChallengeResponse
from app.modules.auth.tokens import TokenService
from app.modules.users.service import user_response


NEUTRAL_RESET_MESSAGE = "If an eligible account exists, a password reset code will be sent."


class AuthService:
    def __init__(self, db, settings, email_sender, oauth_verifier=None):
        self.db, self.settings = db, settings
        self.email_sender, self.oauth_verifier = email_sender, oauth_verifier
        self.crud, self.users = AuthCrud(db), UserCrud(db)
        self.otp = OtpService(settings.otp_secret)
        self.tokens = TokenService(db, settings)

    def _challenge(self, pending):
        registration_expires = pending.expires_at if isinstance(pending, PendingRegistration) else pending.registration_expires_at
        otp_expires = pending.otp_expires_at if isinstance(pending, PendingRegistration) else pending.expires_at
        return OtpChallengeResponse(challenge_id=pending.id, otp_expires_at=otp_expires,
            registration_expires_at=registration_expires, resend_available_at=pending.last_sent_at + timedelta(seconds=60),
            attempts_left=max(0, 5 - pending.attempts))

    @staticmethod
    def _cooldown(last_sent_at):
        remaining = ceil((last_sent_at + timedelta(seconds=60) - utcnow()).total_seconds())
        if remaining > 0:
            raise AppError(429, "cooldown_or_limit", "Wait before requesting another code", headers={"Retry-After": str(remaining)})

    def _pending(self, challenge_id):
        initial = self.db.get(PendingRegistration, challenge_id)
        if not initial:
            raise AppError(404, "challenge_not_found", "Registration challenge was not found")
        self.crud.lock_key("registration:" + initial.email)
        pending = self.db.scalar(select(PendingRegistration).where(PendingRegistration.id == challenge_id).with_for_update().execution_options(populate_existing=True))
        if not pending:
            raise AppError(404, "challenge_not_found", "Registration challenge was not found")
        if pending.expires_at <= utcnow():
            raise AppError(410, "registration_expired", "Registration has expired; start again")
        return pending

    def preregister(self, payload):
        email = str(payload.email)
        self.crud.lock_key("registration:" + email)
        if self.crud.password_user(email):
            raise AppError(409, "email_in_use", "This email already has a password account")
        now = utcnow()
        pending = self.db.scalar(select(PendingRegistration).where(PendingRegistration.email == email).with_for_update())
        if pending and pending.expires_at <= now:
            self._cooldown(pending.last_sent_at)
            self.db.delete(pending)
            self.db.flush()
            pending = None
        if pending and (pending.locked_at is not None or pending.resend_count >= 2):
            # Development specifies a fresh registration after exhaustion, not
            # a 12-hour account lock. Keep the invalidated challenge only long
            # enough to preserve the inter-email cooldown.
            pending.locked_at = pending.locked_at or now
            remaining = ceil((pending.last_sent_at + timedelta(seconds=60) - now).total_seconds())
            if remaining > 0:
                self.db.commit()
                raise AppError(429, "cooldown_or_limit", "Wait before starting a new registration", headers={"Retry-After": str(remaining)})
            self.db.delete(pending)
            self.db.flush()
            pending = None
        if pending:
            self._cooldown(pending.last_sent_at)
            pending.resend_count += 1
            pending.name = payload.name.strip()
            pending.password_hash = password_hasher.hash(payload.password)
        else:
            pending = PendingRegistration(id=uuid4(), email=email, name=payload.name.strip(), password_hash=password_hasher.hash(payload.password),
                expires_at=now + timedelta(hours=12), attempts=0, resend_count=0)
            self.db.add(pending)
        code = self.otp.generate()
        pending.otp_hash = self.otp.hash(f"register:{pending.id}", code)
        pending.otp_expires_at, pending.last_sent_at, pending.attempts = now + timedelta(minutes=10), now, 0
        self.db.flush()
        self.email_sender.send_otp(email, code)
        self.db.commit()
        return self._challenge(pending)

    def resend(self, challenge_id):
        pending = self._pending(challenge_id)
        now = utcnow()
        if pending.locked_at is not None or pending.resend_count >= 2:
            pending.locked_at = pending.locked_at or now
            remaining = max(0, ceil((pending.last_sent_at + timedelta(seconds=60) - now).total_seconds()))
            self.db.commit()
            raise AppError(429, "cooldown_or_limit", "Registration code limit reached; start a new registration", headers={"Retry-After": str(remaining)})
        self._cooldown(pending.last_sent_at)
        code = self.otp.generate()
        pending.otp_hash = self.otp.hash(f"register:{pending.id}", code)
        pending.otp_expires_at, pending.last_sent_at, pending.attempts = now + timedelta(minutes=10), now, 0
        pending.resend_count += 1
        self.email_sender.send_otp(pending.email, code)
        self.db.commit()
        return self._challenge(pending)

    def confirm(self, payload, device_info=None):
        pending = self._pending(payload.challenge_id)
        if pending.locked_at is not None or pending.attempts >= 5:
            raise AppError(423, "otp_locked", "Registration attempts are exhausted")
        if pending.otp_expires_at <= utcnow():
            raise AppError(410, "otp_expired", "The verification code has expired")
        if not self.otp.verify(f"register:{pending.id}", payload.otp, pending.otp_hash):
            pending.attempts += 1
            if pending.attempts >= 5:
                pending.locked_at = utcnow()
            self.db.commit()
            raise AppError(423 if pending.locked_at else 400, "otp_locked" if pending.locked_at else "invalid_otp", "Invalid verification code")
        if self.crud.password_user(pending.email):
            raise AppError(409, "email_in_use", "This email already has a password account")
        user = User(id=uuid4(), email=pending.email, name=pending.name, password_hash=pending.password_hash, email_verified=True)
        self.db.add(user)
        self.db.delete(pending)
        try:
            self.db.flush()
            tokens = self.tokens.issue(user, device_info=device_info)
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise AppError(409, "email_in_use", "This email already has a password account") from exc
        return AuthSessionResponse(user=user_response(user), tokens=tokens, is_new_user=True)

    def login(self, payload, device_info=None):
        email, now = str(payload.email), utcnow()
        self.crud.lock_key("login:" + email)
        attempts = self.db.scalar(select(LoginAttempt).where(LoginAttempt.email == email).with_for_update())
        if not attempts:
            attempts = LoginAttempt(email=email, failures=0)
            self.db.add(attempts)
        if attempts.blocked_until and attempts.blocked_until > now:
            raise AppError(429, "rate_limit", "Too many sign-in attempts; try again later", headers={"Retry-After": str(max(1, ceil((attempts.blocked_until - now).total_seconds())))})
        if attempts.blocked_until:
            attempts.failures, attempts.blocked_until = 0, None
        user = self.crud.password_user(email, lock=True)
        if not password_hasher.verify(payload.password, user.password_hash if user else None):
            attempts.failures += 1
            if attempts.failures >= 5:
                attempts.blocked_until = now + timedelta(minutes=15)
            self.db.commit()
            if attempts.blocked_until:
                raise AppError(429, "rate_limit", "Too many sign-in attempts; try again later", headers={"Retry-After": "900"})
            raise AppError(401, "invalid_credentials", "Invalid email or password")
        if user.deleted_at is not None or not user.email_verified:
            raise AppError(403, "account_unavailable", "Account is unavailable")
        attempts.failures, attempts.blocked_until = 0, None
        tokens = self.tokens.issue(user, device_info=device_info)
        self.db.commit()
        return AuthSessionResponse(user=user_response(user), tokens=tokens, is_new_user=False)

    def social(self, payload, device_info=None):
        identity = self.oauth_verifier.verify(payload.provider, payload.token, nonce=payload.nonce)
        self.crud.lock_key(f"identity:{identity.provider}:{identity.subject}")
        existing = self.db.scalar(select(AuthIdentity).where(AuthIdentity.provider == identity.provider, AuthIdentity.provider_subject == identity.subject))
        is_new = existing is None
        if existing:
            user = self.users.by_id(existing.user_id, lock=True)
            if not user or user.deleted_at is not None:
                raise AppError(403, "account_unavailable", "Account is unavailable")
        else:
            user = User(id=uuid4(), email=identity.email, name=identity.name, email_verified=True, password_hash=None)
            user.identities.append(AuthIdentity(provider=identity.provider, provider_subject=identity.subject))
            self.db.add(user)
        try:
            self.db.flush()
            tokens = self.tokens.issue(user, device_info=device_info)
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise AppError(409, "identity_conflict", "The provider identity is already in use") from exc
        return AuthSessionResponse(user=user_response(user), tokens=tokens, is_new_user=is_new)

    def forgot_password(self, email):
        email, now = str(email), utcnow()
        self.crud.lock_key("reset:" + email)
        user = self.crud.password_user(email, lock=True)
        if not user or user.deleted_at is not None or not user.email_verified:
            return MessageResponse(message=NEUTRAL_RESET_MESSAGE)
        reset = self.db.scalar(select(PasswordResetToken).where(PasswordResetToken.user_id == user.id).with_for_update())
        if reset and reset.last_sent_at + timedelta(seconds=60) > now:
            return MessageResponse(message=NEUTRAL_RESET_MESSAGE)
        if not reset:
            reset = PasswordResetToken(id=uuid4(), user_id=user.id)
            self.db.add(reset)
        code = self.otp.generate()
        reset.token_hash = self.otp.hash(f"reset:{reset.id}", code)
        reset.expires_at, reset.last_sent_at, reset.attempts, reset.used_at = now + timedelta(minutes=10), now, 0, None
        self.db.flush()
        self.email_sender.send_password_reset(email, code)
        self.db.commit()
        return MessageResponse(message=NEUTRAL_RESET_MESSAGE)

    def reset_password(self, payload):
        email = str(payload.email)
        self.crud.lock_key("reset:" + email)
        user = self.crud.password_user(email, lock=True)
        if not user or user.deleted_at is not None:
            raise AppError(400, "invalid_token", "Invalid password reset code")
        reset = self.db.scalar(select(PasswordResetToken).where(PasswordResetToken.user_id == user.id).with_for_update())
        if not reset or reset.used_at is not None or reset.attempts >= 5:
            raise AppError(400, "invalid_token", "Invalid password reset code")
        if reset.expires_at <= utcnow():
            raise AppError(410, "token_expired", "The password reset code has expired")
        if not self.otp.verify(f"reset:{reset.id}", payload.code, reset.token_hash):
            reset.attempts += 1
            if reset.attempts >= 5:
                reset.used_at = utcnow()
            self.db.commit()
            raise AppError(400, "invalid_token", "Invalid password reset code")
        user.password_hash = password_hasher.hash(payload.new_password)
        reset.used_at = utcnow()
        self.tokens.revoke_all(user.id)
        self.db.commit()

    def change_password(self, current_user, payload):
        user = self.users.by_id(current_user.id, lock=True)
        if not user.password_hash or not password_hasher.verify(payload.current_password, user.password_hash):
            raise AppError(401, "invalid_current_password", "The current password is invalid")
        user.password_hash = password_hasher.hash(payload.new_password)
        self.tokens.revoke_all(user.id)
        reset = self.db.scalar(select(PasswordResetToken).where(PasswordResetToken.user_id == user.id))
        if reset:
            reset.used_at = utcnow()
        self.db.commit()

    def change_email(self, current_user, new_email):
        user = self.users.by_id(current_user.id, lock=True)
        if not user.password_hash:
            raise AppError(403, "password_account_required", "Email changes are available only for password accounts")
        new_email, now = str(new_email), utcnow()
        existing = self.crud.password_user(new_email)
        if existing:
            raise AppError(409, "email_in_use", "This email already has a password account")
        challenge = self.db.scalar(select(EmailChangeChallenge).where(EmailChangeChallenge.user_id == user.id).with_for_update())
        if challenge and (challenge.registration_expires_at <= now or challenge.used_at is not None):
            self.db.delete(challenge)
            self.db.flush()
            challenge = None
        if challenge:
            if challenge.attempts >= 5:
                raise AppError(423, "otp_locked", "Email verification attempts are exhausted")
            if challenge.resend_count >= 2:
                raise AppError(429, "cooldown_or_limit", "Email verification send limit reached", headers={"Retry-After": str(max(1, ceil((challenge.registration_expires_at - now).total_seconds())))})
            self._cooldown(challenge.last_sent_at)
            challenge.resend_count += 1
        else:
            challenge = EmailChangeChallenge(id=uuid4(), user_id=user.id, registration_expires_at=now + timedelta(hours=12), resend_count=0)
            self.db.add(challenge)
        code = self.otp.generate()
        challenge.new_email, challenge.attempts, challenge.last_sent_at, challenge.expires_at = new_email, 0, now, now + timedelta(minutes=10)
        challenge.otp_hash = self.otp.hash(f"email:{challenge.id}", code)
        self.db.flush()
        self.email_sender.send_email_change(new_email, code)
        self.db.commit()
        return self._challenge(challenge)

    def confirm_email_change(self, current_user, payload):
        user = self.users.by_id(current_user.id, lock=True)
        challenge = self.db.scalar(select(EmailChangeChallenge).where(EmailChangeChallenge.id == payload.challenge_id,
            EmailChangeChallenge.user_id == user.id).with_for_update())
        if not challenge or challenge.used_at is not None:
            raise AppError(400, "invalid_otp", "Invalid email verification code")
        if challenge.attempts >= 5:
            raise AppError(423, "otp_locked", "Email verification attempts are exhausted")
        if challenge.expires_at <= utcnow() or challenge.registration_expires_at <= utcnow():
            raise AppError(410, "otp_expired", "The email verification code has expired")
        if not self.otp.verify(f"email:{challenge.id}", payload.otp, challenge.otp_hash):
            challenge.attempts += 1
            self.db.commit()
            raise AppError(423 if challenge.attempts >= 5 else 400, "otp_locked" if challenge.attempts >= 5 else "invalid_otp", "Invalid email verification code")
        if self.crud.password_user(challenge.new_email):
            raise AppError(409, "email_in_use", "This email already has a password account")
        user.email, user.email_verified, challenge.used_at = challenge.new_email, True, utcnow()
        # Reset codes sent to the old address must stop being usable immediately.
        reset = self.db.scalar(select(PasswordResetToken).where(PasswordResetToken.user_id == user.id))
        if reset:
            reset.used_at = utcnow()
        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise AppError(409, "email_in_use", "This email already has a password account") from exc
        return user_response(user)
