"""Verify provider ID tokens against trusted, cached public signing keys."""
import hashlib
import hmac
import threading
import time
from dataclasses import dataclass

import httpx
import jwt
from pydantic import EmailStr, TypeAdapter, ValidationError

from app.core.errors import AppError


@dataclass(frozen=True)
class VerifiedIdentity:
    provider: str
    subject: str
    email: str
    name: str = ""


class OAuthTokenVerifier:
    PROVIDERS = {
        "google": ("https://www.googleapis.com/oauth2/v3/certs", ["accounts.google.com", "https://accounts.google.com"]),
        "apple": ("https://appleid.apple.com/auth/keys", ["https://appleid.apple.com"]),
    }

    def __init__(self, settings, client: httpx.Client | None = None):
        self.settings = settings
        self.client = client or httpx.Client(timeout=10)
        self._keys: dict[str, tuple[float, dict]] = {}
        self._lock = threading.Lock()

    def _key(self, provider: str, kid: str):
        with self._lock:
            expires, keys = self._keys.get(provider, (0, {}))
            if time.monotonic() >= expires or kid not in keys:
                try:
                    response = self.client.get(self.PROVIDERS[provider][0])
                    response.raise_for_status()
                    jwks = response.json()["keys"]
                    keys = {key["kid"]: jwt.PyJWK.from_dict(key).key for key in jwks if key.get("kty") == "RSA" and key.get("use", "sig") == "sig"}
                    self._keys[provider] = (time.monotonic() + 3600, keys)
                except (httpx.HTTPError, ValueError, KeyError, TypeError, jwt.PyJWTError) as exc:
                    raise AppError(503, "provider_unavailable", "Identity provider keys are unavailable") from exc
            if kid not in keys:
                raise AppError(401, "invalid_provider_token", "Invalid provider token")
            return keys[kid]

    def verify(self, provider: str, token: str, nonce: str | None = None) -> VerifiedIdentity:
        if provider not in self.PROVIDERS:
            raise AppError(401, "invalid_provider_token", "Invalid identity provider")
        audiences = self.settings.google_client_ids if provider == "google" else self.settings.apple_client_ids
        if not audiences:
            raise AppError(503, "provider_unavailable", "This sign-in provider is not configured")
        try:
            header = jwt.get_unverified_header(token)
            if header.get("alg") != "RS256" or not isinstance(header.get("kid"), str):
                raise ValueError("Unsupported signing algorithm")
            claims = jwt.decode(token, self._key(provider, header["kid"]), algorithms=["RS256"],
                issuer=self.PROVIDERS[provider][1], audience=audiences,
                options={"require": ["exp", "iat", "iss", "aud", "sub", "email", "email_verified"]})
            if not isinstance(claims["sub"], str) or not claims["sub"] or len(claims["sub"]) > 255:
                raise ValueError("Missing subject")
            if claims["email_verified"] is not True and claims["email_verified"] != "true":
                raise ValueError("Unverified email")
            if provider == "google" and claims.get("azp") and claims["azp"] not in audiences:
                raise ValueError("Invalid authorized party")
            if provider == "apple" and nonce is None:
                raise ValueError("Missing nonce")
            if nonce is not None:
                expected = hashlib.sha256(nonce.encode()).hexdigest() if provider == "apple" else nonce
                if not isinstance(claims.get("nonce"), str) or not hmac.compare_digest(claims["nonce"], expected):
                    raise ValueError("Nonce mismatch")
            email = str(TypeAdapter(EmailStr).validate_python(claims["email"].strip().lower()))
            name = claims.get("name", "")
            return VerifiedIdentity(provider, claims["sub"], email, name[:50] if isinstance(name, str) else "")
        except (jwt.PyJWTError, ValueError, KeyError, TypeError, AttributeError, ValidationError) as exc:
            raise AppError(401, "invalid_provider_token", "Invalid provider token") from exc

    def close(self):
        self.client.close()
