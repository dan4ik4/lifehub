import hashlib
import hmac
from datetime import timedelta
from uuid import UUID, uuid4

import jwt
from sqlalchemy import select, update

from app.core.database import utcnow
from app.core.errors import AppError
from app.modules.auth.models import RefreshSession, User
from app.modules.auth.schemas import TokenPairResponse


class TokenService:
    def __init__(self, db, settings):
        self.db, self.settings = db, settings

    @staticmethod
    def digest(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    def decode(self, token: str, token_use: str) -> dict:
        try:
            claims = jwt.decode(token, self.settings.jwt_secret, algorithms=["HS256"],
                issuer=self.settings.jwt_issuer, audience=self.settings.jwt_audience,
                options={"require": ["exp", "iat", "iss", "aud", "sub", "jti", "token_use"]})
            if claims["token_use"] != token_use:
                raise ValueError("Incorrect token use")
            UUID(claims["sub"])
            UUID(claims["jti"])
            if token_use == "refresh":
                UUID(claims["family_id"])
            return claims
        except (jwt.PyJWTError, ValueError, TypeError, KeyError) as exc:
            code = "unauthorized" if token_use == "access" else "invalid_expired_or_reused_refresh"
            raise AppError(401, code, "Invalid or expired authentication token") from exc

    def issue(self, user: User, *, family_id: UUID | None = None, device_info=None, session_id=None):
        now = utcnow()
        family_id = family_id or uuid4()
        session_id = session_id or uuid4()
        access_seconds = self.settings.access_token_minutes * 60
        refresh_seconds = self.settings.refresh_token_days * 86400
        common = {"sub": str(user.id), "iss": self.settings.jwt_issuer, "aud": self.settings.jwt_audience, "iat": now}
        access = jwt.encode({**common, "exp": now + timedelta(seconds=access_seconds), "jti": str(uuid4()), "token_use": "access"}, self.settings.jwt_secret, algorithm="HS256")
        refresh = jwt.encode({**common, "exp": now + timedelta(seconds=refresh_seconds), "jti": str(session_id), "token_use": "refresh", "family_id": str(family_id)}, self.settings.jwt_secret, algorithm="HS256")
        self.db.add(RefreshSession(id=session_id, user_id=user.id, token_hash=self.digest(refresh), family_id=family_id,
            expires_at=now + timedelta(seconds=refresh_seconds), device_info=device_info))
        self.db.flush()
        return TokenPairResponse(access_token=access, refresh_token=refresh, expires_in=access_seconds, refresh_expires_in=refresh_seconds)

    def revoke_all(self, user_id):
        self.db.execute(update(RefreshSession).where(RefreshSession.user_id == user_id, RefreshSession.revoked_at.is_(None)).values(revoked_at=utcnow()))

    def refresh(self, token, device_info=None):
        claims = self.decode(token, "refresh")
        session_id, family_id = UUID(claims["jti"]), UUID(claims["family_id"])
        now, replacement_id = utcnow(), uuid4()
        session = self.db.get(RefreshSession, session_id)
        if not session or not hmac.compare_digest(session.token_hash, self.digest(token)) or str(session.user_id) != claims["sub"] or session.family_id != family_id:
            raise AppError(401, "invalid_expired_or_reused_refresh", "Invalid or expired refresh token")
        # Lock the user before session rows, matching password reset/change order.
        # A reset cannot miss a concurrently inserted replacement session.
        user = self.db.scalar(select(User).where(User.id == session.user_id).with_for_update().execution_options(populate_existing=True))
        # An atomic claim, rather than a read-then-write, prevents two winners.
        claimed = self.db.execute(update(RefreshSession).where(RefreshSession.id == session_id,
            RefreshSession.revoked_at.is_(None), RefreshSession.expires_at > now).values(
                revoked_at=now, replaced_by_id=replacement_id).execution_options(synchronize_session=False)).rowcount
        if claimed != 1:
            self.db.execute(update(RefreshSession).where(RefreshSession.family_id == family_id,
                RefreshSession.revoked_at.is_(None)).values(revoked_at=now))
            self.db.commit()
            raise AppError(401, "invalid_expired_or_reused_refresh", "Refresh token expired or reused; sign in again")
        if not user or user.deleted_at is not None:
            self.revoke_all(session.user_id)
            self.db.commit()
            raise AppError(401, "invalid_expired_or_reused_refresh", "Account is unavailable")
        tokens = self.issue(user, family_id=family_id, device_info=device_info or session.device_info, session_id=replacement_id)
        self.db.commit()
        return tokens

    def logout(self, token):
        try:
            claims = self.decode(token, "refresh")
        except AppError as exc:
            raise AppError(401, "invalid_refresh", "Invalid refresh token") from exc
        count = self.db.execute(update(RefreshSession).where(RefreshSession.id == UUID(claims["jti"]),
            RefreshSession.user_id == UUID(claims["sub"]), RefreshSession.token_hash == self.digest(token),
            RefreshSession.revoked_at.is_(None), RefreshSession.expires_at > utcnow()).values(revoked_at=utcnow())).rowcount
        self.db.commit()
        if count != 1:
            raise AppError(401, "invalid_refresh", "Invalid refresh token")
