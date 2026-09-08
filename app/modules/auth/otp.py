import hashlib
import hmac
import secrets


class OtpService:
    TTL_SECONDS = 600
    PENDING_SECONDS = 43200
    COOLDOWN_SECONDS = 60
    MAX_ATTEMPTS = 5
    MAX_SENDS = 3

    def __init__(self, secret: str):
        self.secret = secret.encode()

    def generate(self) -> str:
        return f"{secrets.randbelow(1_000_000):06d}"

    def hash(self, context: str, code: str) -> str:
        return hmac.new(self.secret, f"{context}:{code}".encode(), hashlib.sha256).hexdigest()

    def verify(self, context: str, code: str, expected: str) -> bool:
        return hmac.compare_digest(self.hash(context, code), expected)
