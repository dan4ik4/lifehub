from datetime import timedelta
from uuid import UUID

import jwt
import pytest
from sqlalchemy import func, select

from app.core.database import utcnow
from app.modules.auth.models import EmailChangeChallenge, LoginAttempt, PasswordResetToken, PendingRegistration, RefreshSession, User
from app.modules.auth.oauth import VerifiedIdentity
from app.modules.auth.passwords import password_hasher


PASSWORD = "CorrectPassword9"


def register(client, app, email="user@example.com"):
    response = client.post("/api/v1/auth/preregister", json={"email": email, "password": PASSWORD})
    assert response.status_code == 202, response.text
    challenge = response.json()
    code = app.state.email_sender.messages[-1]["code"]
    response = client.post("/api/v1/auth/confirm", json={"challenge_id": challenge["challenge_id"], "otp": code})
    assert response.status_code == 201, response.text
    return response.json()


def bearer(session):
    return {"Authorization": "Bearer " + session["tokens"]["access_token"]}


def test_registration_stores_only_hashes_normalizes_email_and_issues_separate_tokens(client, app, db, settings):
    result = register(client, app, " User@EXAMPLE.com ")
    assert result["user"]["email"] == "user@example.com"
    assert result["user"]["plan"] == "free"
    assert result["user"]["trial_ends"] is None
    assert result["user"]["auth_providers"] == ["password"]
    assert result["tokens"]["expires_in"] == 900
    assert result["tokens"]["refresh_expires_in"] == 2592000
    assert "password_hash" not in result["user"] and PASSWORD not in str(result)
    user = db.get(User, UUID(result["user"]["id"]))
    assert user.password_hash != PASSWORD and password_hasher.verify(PASSWORD, user.password_hash)
    saved = db.scalar(select(RefreshSession).where(RefreshSession.user_id == user.id))
    assert saved.token_hash != result["tokens"]["refresh_token"]
    assert db.scalar(select(func.count()).select_from(PendingRegistration)) == 0
    for kind in ("access", "refresh"):
        token = jwt.decode(result["tokens"][f"{kind}_token"], settings.jwt_secret, algorithms=["HS256"], audience=settings.jwt_audience)
        assert token["token_use"] == kind
    assert client.get("/api/v1/users/me", headers=bearer(result)).status_code == 200
    assert client.get("/api/v1/users/me", headers={"Authorization": "Bearer " + result["tokens"]["refresh_token"]}).status_code == 401


def test_exhausted_attempts_allow_fresh_registration_after_cooldown(client, app, db):
    response = client.post("/api/v1/auth/preregister", json={"email": "locked@example.com", "password": PASSWORD})
    challenge_id = response.json()["challenge_id"]
    code = app.state.email_sender.messages[-1]["code"]
    wrong = "111111" if code != "111111" else "222222"
    for attempt in range(5):
        reply = client.post("/api/v1/auth/confirm", json={"challenge_id": challenge_id, "otp": wrong})
        assert reply.status_code == (423 if attempt == 4 else 400)
    assert client.post("/api/v1/auth/confirm", json={"challenge_id": challenge_id, "otp": code}).status_code == 423
    assert client.post("/api/v1/auth/resend", json={"challenge_id": challenge_id}).status_code == 429
    assert client.post("/api/v1/auth/preregister", json={"email": "locked@example.com", "password": PASSWORD}).status_code == 429
    saved = db.get(PendingRegistration, UUID(challenge_id))
    assert saved.locked_at is not None and saved.otp_hash != code
    saved.last_sent_at = utcnow() - timedelta(seconds=61)
    db.commit()
    fresh = client.post("/api/v1/auth/preregister", json={"email": "locked@example.com", "password": "FreshPassword4"})
    assert fresh.status_code == 202, fresh.text
    assert fresh.json()["challenge_id"] != challenge_id and fresh.json()["attempts_left"] == 5
    new_code = app.state.email_sender.messages[-1]["code"]
    assert client.post("/api/v1/auth/confirm", json={"challenge_id": challenge_id, "otp": code}).status_code == 404
    assert client.post("/api/v1/auth/confirm", json={"challenge_id": fresh.json()["challenge_id"], "otp": new_code}).status_code == 201


def test_resend_cooldown_and_three_total_sends(client, app, db):
    response = client.post("/api/v1/auth/pre-register", json={"email": "resend@example.com", "password": PASSWORD})
    challenge_id = response.json()["challenge_id"]
    assert client.post("/api/v1/auth/resend", json={"challenge_id": challenge_id}).status_code == 429
    for _ in range(2):
        pending = db.get(PendingRegistration, UUID(challenge_id))
        pending.last_sent_at = utcnow() - timedelta(seconds=61)
        db.commit()
        assert client.post("/api/v1/auth/resend", json={"challenge_id": challenge_id}).status_code == 202
        db.expire_all()
    reply = client.post("/api/v1/auth/resend", json={"challenge_id": challenge_id})
    assert reply.status_code == 429 and "retry-after" in reply.headers
    assert len(app.state.email_sender.messages) == 3
    third_code = app.state.email_sender.messages[-1]["code"]
    assert client.post("/api/v1/auth/confirm", json={"challenge_id": challenge_id, "otp": third_code}).status_code == 423
    assert client.post("/api/v1/auth/preregister", json={"email": "resend@example.com", "password": PASSWORD}).status_code == 429
    db.expire_all()
    pending = db.get(PendingRegistration, UUID(challenge_id))
    pending.last_sent_at = utcnow() - timedelta(seconds=61)
    db.commit()
    fresh = client.post("/api/v1/auth/preregister", json={"email": "resend@example.com", "password": PASSWORD})
    assert fresh.status_code == 202 and fresh.json()["challenge_id"] != challenge_id
    assert len(app.state.email_sender.messages) == 4
    assert client.post("/api/v1/auth/confirm", json={"challenge_id": challenge_id, "otp": third_code}).status_code == 404


def test_repeated_preregister_shares_budget_until_exhausted_then_starts_new_challenge(client, app, db):
    payload = {"email": "repeated@example.com", "password": PASSWORD}
    first = client.post("/api/v1/auth/preregister", json=payload).json()
    for _ in range(2):
        pending = db.get(PendingRegistration, UUID(first["challenge_id"]))
        pending.last_sent_at = utcnow() - timedelta(seconds=61)
        db.commit()
        repeat = client.post("/api/v1/auth/preregister", json=payload)
        assert repeat.status_code == 202 and repeat.json()["challenge_id"] == first["challenge_id"]
        db.expire_all()
    assert len(app.state.email_sender.messages) == 3
    pending = db.get(PendingRegistration, UUID(first["challenge_id"]))
    assert pending.resend_count == 2 and pending.locked_at is None
    pending.last_sent_at = utcnow() - timedelta(seconds=61)
    db.commit()
    fresh = client.post("/api/v1/auth/preregister", json=payload)
    assert fresh.status_code == 202 and fresh.json()["challenge_id"] != first["challenge_id"]
    new_pending = db.get(PendingRegistration, UUID(fresh.json()["challenge_id"]))
    assert new_pending.resend_count == new_pending.attempts == 0
    assert new_pending.expires_at > utcnow() + timedelta(hours=11, minutes=59)


def test_restarting_active_registration_uses_the_latest_password(client, app, db):
    first = client.post("/api/v1/auth/preregister", json={"email": "restart@example.com", "password": PASSWORD}).json()
    first_code = app.state.email_sender.messages[-1]["code"]
    pending = db.get(PendingRegistration, UUID(first["challenge_id"]))
    pending.last_sent_at = utcnow() - timedelta(seconds=61)
    db.commit()
    updated_password = "UserChosenPassword3"
    response = client.post("/api/v1/auth/preregister", json={"email": "restart@example.com", "password": updated_password})
    assert response.status_code == 202
    new_code = app.state.email_sender.messages[-1]["code"]
    assert client.post("/api/v1/auth/confirm", json={"challenge_id": first["challenge_id"], "otp": new_code}).status_code == 201
    assert client.post("/api/v1/auth/login", json={"email": "restart@example.com", "password": PASSWORD}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"email": "restart@example.com", "password": updated_password}).status_code == 200


def test_login_failure_lock_and_expiry_are_persistent(client, app, db):
    register(client, app)
    for attempt in range(5):
        reply = client.post("/api/v1/auth/login", json={"email": "user@example.com", "password": "wrong"})
        assert reply.status_code == (429 if attempt == 4 else 401)
    assert client.post("/api/v1/auth/login", json={"email": "user@example.com", "password": PASSWORD}).status_code == 429
    lock = db.get(LoginAttempt, "user@example.com")
    lock.blocked_until = utcnow() - timedelta(seconds=1)
    db.commit()
    assert client.post("/api/v1/auth/login", json={"email": "user@example.com", "password": PASSWORD}).status_code == 200
    db.expire_all()
    assert db.get(LoginAttempt, "user@example.com").failures == 0


def test_refresh_reuse_revokes_entire_family_but_not_other_device(client, app):
    session = register(client, app)
    other = client.post("/api/v1/auth/login", json={"email": "user@example.com", "password": PASSWORD}).json()
    token = session["tokens"]["refresh_token"]
    rotated = client.post("/api/v1/auth/refresh", json={"refresh_token": token})
    assert rotated.status_code == 200
    assert rotated.json()["refresh_token"] != token
    reuse = client.post("/api/v1/auth/refresh", json={"refresh_token": token})
    assert reuse.status_code == 401 and reuse.json()["error"]["code"] == "invalid_expired_or_reused_refresh"
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": rotated.json()["refresh_token"]}).status_code == 401
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": other["tokens"]["refresh_token"]}).status_code == 200


def test_password_reset_is_otp_email_bound_single_use_and_revokes_all_sessions(client, app, db):
    original = register(client, app)
    second = client.post("/api/v1/auth/login", json={"email": "user@example.com", "password": PASSWORD}).json()
    known = client.post("/api/v1/auth/forgot-password", json={"email": "user@example.com"})
    unknown = client.post("/api/v1/auth/forgot-password", json={"email": "unknown@example.com"})
    assert known.status_code == unknown.status_code == 202 and known.json() == unknown.json()
    code = app.state.email_sender.messages[-1]["code"]
    assert len(code) == 6 and code.isdigit()
    saved = db.scalar(select(PasswordResetToken))
    assert saved.token_hash != code
    assert client.post("/api/v1/auth/reset-password", json={"email": "unknown@example.com", "code": code, "new_password": "NewPassword4"}).status_code == 400
    request = {"email": "user@example.com", "code": code, "new_password": "NewPassword4"}
    assert client.post("/api/v1/auth/reset-password", json=request).status_code == 204
    assert client.post("/api/v1/auth/reset-password", json=request).status_code == 400
    for session in (original, second):
        assert client.post("/api/v1/auth/refresh", json={"refresh_token": session["tokens"]["refresh_token"]}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"email": "user@example.com", "password": PASSWORD}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"email": "user@example.com", "password": "NewPassword4"}).status_code == 200


def test_reset_five_wrong_attempts_cannot_be_bypassed_with_valid_code(client, app):
    register(client, app)
    client.post("/api/v1/auth/forgot-password", json={"email": "user@example.com"})
    code = app.state.email_sender.messages[-1]["code"]
    wrong = "999999" if code != "999999" else "888888"
    for _ in range(5):
        assert client.post("/api/v1/auth/reset-password", json={"email": "user@example.com", "code": wrong, "new_password": PASSWORD}).status_code == 400
    assert client.post("/api/v1/auth/reset-password", json={"email": "user@example.com", "code": code, "new_password": PASSWORD}).status_code == 400


def test_social_accounts_do_not_link_by_email_or_acquire_passwords(client, app, db):
    password = register(client, app)
    class Verifier:
        def verify(self, provider, token, nonce=None):
            return VerifiedIdentity(provider, token, "user@example.com", "Provider Name")
    app.state.oauth_verifier = Verifier()
    google = client.post("/api/v1/auth/social", json={"provider": "google", "token": "google-subject"})
    apple = client.post("/api/v1/auth/social", json={"provider": "apple", "token": "apple-subject", "nonce": "random-nonce-long-enough"})
    assert google.status_code == apple.status_code == 201
    assert len({password["user"]["id"], google.json()["user"]["id"], apple.json()["user"]["id"]}) == 3
    assert client.post("/api/v1/auth/social", json={"provider": "google", "token": "google-subject"}).status_code == 200
    assert client.post("/api/v1/auth/change-password", json={"current_password": PASSWORD, "new_password": "PasswordNew4"}, headers=bearer(google.json())).status_code == 401
    assert client.post("/api/v1/auth/change-email", json={"new_email": "social-new@example.com"}, headers=bearer(google.json())).status_code == 403
    assert db.scalar(select(func.count()).select_from(User)) == 3


def test_social_only_forgot_is_neutral_without_sending(client, app):
    class Verifier:
        def verify(self, provider, token, nonce=None):
            return VerifiedIdentity(provider, token, "social@example.com")
    app.state.oauth_verifier = Verifier()
    assert client.post("/api/v1/auth/social", json={"provider": "google", "token": "identity"}).status_code == 201
    assert client.post("/api/v1/auth/forgot-password", json={"email": "social@example.com"}).status_code == 202
    assert not app.state.email_sender.messages


def test_email_change_remains_old_until_confirm_and_challenge_is_owner_scoped(client, app):
    first, second = register(client, app), register(client, app, "second@example.com")
    response = client.post("/api/v1/auth/change-email", json={"new_email": "new@example.com"}, headers=bearer(first))
    assert response.status_code == 202
    code = app.state.email_sender.messages[-1]["code"]
    confirmation = {"challenge_id": response.json()["challenge_id"], "otp": code}
    assert client.get("/api/v1/users/me", headers=bearer(first)).json()["email"] == "user@example.com"
    assert client.post("/api/v1/auth/confirm-email-change", json=confirmation, headers=bearer(second)).status_code == 400
    result = client.post("/api/v1/auth/confirm-email-change", json=confirmation, headers=bearer(first))
    assert result.status_code == 200 and result.json()["email"] == "new@example.com"
    assert client.post("/api/v1/auth/login", json={"email": "user@example.com", "password": PASSWORD}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"email": "new@example.com", "password": PASSWORD}).status_code == 200


def test_profile_prevents_entitlement_escalation_and_trial_reactivation(client, app, db):
    session = register(client, app)
    headers = bearer(session)
    for payload in ({"plan": "pro"}, {"trial_ends": "2030-01-01T00:00:00Z"}, {"email_verified": True}, {"password_hash": "hacked"}, {"free_modules": ["health"]}, {"name": None}):
        assert client.patch("/api/v1/users/me", json=payload, headers=headers).status_code == 422
    initial = client.patch("/api/v1/users/me", json={"name": "Alice", "timezone": "Europe/Warsaw", "free_modules": ["planning", "health", "books_diary"], "onboarding_completed": True, "plan": "trial"}, headers=headers)
    assert initial.status_code == 200 and initial.json()["free_modules"] == ["planning", "health", "books"]
    expiry = initial.json()["trial_ends"]
    assert client.patch("/api/v1/users/me", json={"plan": "trial"}, headers=headers).json()["trial_ends"] == expiry
    assert client.patch("/api/v1/users/me", json={"free_modules": ["planning", "health", "finance"]}, headers=headers).status_code == 409
    user = db.get(User, UUID(session["user"]["id"]))
    user.trial_ends = utcnow() - timedelta(seconds=1)
    db.commit()
    assert client.get("/api/v1/users/me", headers=headers).json()["plan"] == "free"
    assert client.patch("/api/v1/users/me", json={"plan": "trial"}, headers=headers).status_code == 409


def test_change_password_and_logout_revoke_sessions(client, app):
    session = register(client, app)
    assert client.post("/api/v1/auth/change-password", json={"current_password": "wrong", "new_password": "NextPassword7"}, headers=bearer(session)).status_code == 401
    assert client.post("/api/v1/auth/change-password", json={"current_password": PASSWORD, "new_password": "NextPassword7"}, headers=bearer(session)).status_code == 204
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": session["tokens"]["refresh_token"]}).status_code == 401
    fresh = client.post("/api/v1/auth/login", json={"email": "user@example.com", "password": "NextPassword7"}).json()
    assert client.post("/api/v1/auth/logout", json={"refresh_token": fresh["tokens"]["refresh_token"]}).status_code == 204
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": fresh["tokens"]["refresh_token"]}).status_code == 401


def test_otp_and_registration_expiry_are_distinct(client, app, db):
    response = client.post("/api/v1/auth/preregister", json={"email": "expiry@example.com", "password": PASSWORD})
    challenge_id = response.json()["challenge_id"]
    code = app.state.email_sender.messages[-1]["code"]
    pending = db.get(PendingRegistration, UUID(challenge_id))
    pending.otp_expires_at = utcnow() - timedelta(seconds=1)
    db.commit()
    expired = client.post("/api/v1/auth/confirm", json={"challenge_id": challenge_id, "otp": code})
    assert expired.status_code == 410 and expired.json()["error"]["code"] == "otp_expired"
    pending.expires_at = utcnow() - timedelta(seconds=1)
    pending.last_sent_at = utcnow() - timedelta(seconds=61)
    db.commit()
    expired = client.post("/api/v1/auth/resend", json={"challenge_id": challenge_id})
    assert expired.status_code == 410 and expired.json()["error"]["code"] == "registration_expired"
    fresh = client.post("/api/v1/auth/preregister", json={"email": "expiry@example.com", "password": PASSWORD})
    assert fresh.status_code == 202 and fresh.json()["challenge_id"] != challenge_id


def test_twelve_hour_expiry_does_not_bypass_cooldown_after_last_minute_resend(client, app, db):
    from app.modules.auth.cleanup import cleanup_expired_auth
    payload = {"email": "expiry-cooldown@example.com", "password": PASSWORD}
    first = client.post("/api/v1/auth/preregister", json=payload).json()
    pending = db.get(PendingRegistration, UUID(first["challenge_id"]))
    pending.expires_at = utcnow() - timedelta(seconds=1)
    pending.last_sent_at = utcnow() - timedelta(seconds=30)
    db.commit()
    assert cleanup_expired_auth(db)["pending_registrations"] == 0
    response = client.post("/api/v1/auth/preregister", json=payload)
    assert response.status_code == 429 and 0 < int(response.headers["retry-after"]) <= 30
    assert len(app.state.email_sender.messages) == 1
    pending.last_sent_at = utcnow() - timedelta(seconds=61)
    db.commit()
    response = client.post("/api/v1/auth/preregister", json=payload)
    assert response.status_code == 202 and response.json()["challenge_id"] != first["challenge_id"]


def test_forgot_password_cooldown_does_not_leak_account_existence(client, app):
    register(client, app)
    first = client.post("/api/v1/auth/forgot-password", json={"email": "user@example.com"})
    second = client.post("/api/v1/auth/forgot-password", json={"email": "user@example.com"})
    missing = client.post("/api/v1/auth/forgot-password", json={"email": "missing@example.com"})
    assert first.status_code == second.status_code == missing.status_code == 202
    assert first.json() == second.json() == missing.json()
    assert len([message for message in app.state.email_sender.messages if message["kind"] == "password_reset"]) == 1


def test_expired_access_and_tampered_refresh_are_rejected(client, app, settings):
    result = register(client, app)
    claims = jwt.decode(result["tokens"]["access_token"], settings.jwt_secret, algorithms=["HS256"], audience=settings.jwt_audience)
    claims["exp"] = 1
    expired = jwt.encode(claims, settings.jwt_secret, algorithm="HS256")
    assert client.get("/api/v1/users/me", headers={"Authorization": "Bearer " + expired}).status_code == 401
    refresh = result["tokens"]["refresh_token"]
    header, payload, signature = refresh.split(".")
    tampered = ".".join([header, payload, ("A" if signature[0] != "A" else "B") + signature[1:]])
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": tampered}).status_code == 401


@pytest.mark.parametrize("email", [123, None, {}, "not-an-email"])
def test_invalid_input_is_sanitized_validation_error(client, email):
    response = client.post("/api/v1/auth/preregister", json={"email": email, "password": "SecretPassword3"})
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "validation_error" and body["trace_id"]
    assert "SecretPassword3" not in response.text
