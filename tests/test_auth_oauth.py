import hashlib
import json
from datetime import timedelta

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.core.database import utcnow
from app.core.errors import AppError
from app.modules.auth.oauth import OAuthTokenVerifier


@pytest.fixture
def provider(settings):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
    jwk.update(kid="test-key", use="sig", alg="RS256")
    calls = []
    def transport(request):
        calls.append(str(request.url))
        return httpx.Response(200, json={"keys": [jwk]})
    verifier = OAuthTokenVerifier(settings, httpx.Client(transport=httpx.MockTransport(transport)))
    def token(provider="google", **overrides):
        claims = {"sub": "external-identity", "iss": "https://accounts.google.com" if provider == "google" else "https://appleid.apple.com",
            "aud": "test-google-client" if provider == "google" else "test-apple-client", "iat": utcnow(), "exp": utcnow() + timedelta(minutes=5),
            "email": "Verified@Example.com", "email_verified": True}
        claims.update(overrides)
        return jwt.encode(claims, key, algorithm="RS256", headers={"kid": "test-key"})
    return verifier, token, calls


def test_google_verifies_signature_identity_claims_and_caches_keys(provider):
    verifier, token, calls = provider
    first = verifier.verify("google", token())
    assert first.email == "verified@example.com" and first.subject == "external-identity"
    verifier.verify("google", token())
    assert len(calls) == 1


@pytest.mark.parametrize("overrides", [
    {"iss": "https://attacker.example"}, {"aud": "another-app"}, {"email_verified": False},
    {"exp": 1}, {"iat": 9999999999}, {"sub": ""}, {"azp": "different-app"},
])
def test_google_rejects_invalid_claims(provider, overrides):
    verifier, token, _ = provider
    with pytest.raises(AppError) as failure:
        verifier.verify("google", token(**overrides))
    assert failure.value.status_code == 401 and failure.value.code == "invalid_provider_token"


def test_apple_requires_hashed_nonce(provider):
    verifier, token, _ = provider
    raw = "secure-random-client-generated-nonce"
    encoded = token(provider="apple", email_verified="true", nonce=hashlib.sha256(raw.encode()).hexdigest())
    assert verifier.verify("apple", encoded, nonce=raw).provider == "apple"
    for nonce in (None, "wrong-client-nonce"):
        with pytest.raises(AppError) as failure:
            verifier.verify("apple", encoded, nonce=nonce)
        assert failure.value.status_code == 401


def test_hmac_signed_provider_token_is_rejected(provider):
    verifier, _, _ = provider
    forged = jwt.encode({"sub": "attacker"}, "a-long-enough-attacker-controlled-secret", algorithm="HS256", headers={"kid": "test-key"})
    with pytest.raises(AppError):
        verifier.verify("google", forged)


def test_missing_provider_configuration_does_not_fake_success(settings):
    settings.google_client_ids = []
    with pytest.raises(AppError) as failure:
        OAuthTokenVerifier(settings).verify("google", "anything")
    assert failure.value.status_code == 503
