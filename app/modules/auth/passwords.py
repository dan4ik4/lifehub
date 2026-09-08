from argon2 import PasswordHasher as Argon2Hasher
from argon2.exceptions import InvalidHashError, VerificationError


class PasswordHasher:
    def __init__(self):
        self.hasher = Argon2Hasher()
        self.dummy_hash = self.hasher.hash("TimingProtectionPassword9")

    def hash(self, password: str) -> str:
        return self.hasher.hash(password)

    def verify(self, password: str, password_hash: str | None) -> bool:
        try:
            valid = self.hasher.verify(password_hash or self.dummy_hash, password)
            return bool(password_hash) and valid
        except (VerificationError, InvalidHashError):
            return False


password_hasher = PasswordHasher()
