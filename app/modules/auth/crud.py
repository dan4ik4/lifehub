import hashlib

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.modules.auth.models import User


class AuthCrud:
    def __init__(self, db: Session):
        self.db = db

    def lock_key(self, key: str):
        """Serialize security counters even before a row exists (PostgreSQL)."""
        if self.db.get_bind().dialect.name == "postgresql":
            number = int.from_bytes(hashlib.sha256(key.encode()).digest()[:8], "big", signed=True)
            self.db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": number})

    def password_user(self, email: str, *, lock: bool = False) -> User | None:
        query = select(User).where(User.email == email, User.password_hash.is_not(None))
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        return self.db.scalar(query)


class UserCrud(AuthCrud):
    def by_id(self, user_id, *, lock=False):
        query = select(User).where(User.id == user_id)
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        return self.db.scalar(query)
