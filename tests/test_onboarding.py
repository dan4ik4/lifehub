from datetime import datetime, timedelta

import pytest


def test_planning_only_onboarding_completes_without_starting_trial(client, make_user, auth_headers):
    user = make_user(plan="free", free_modules=[], onboarding_completed=False)
    response = client.patch("/api/v1/users/me", headers=auth_headers(user), json={
        "name": "Alice", "timezone": "Europe/Warsaw", "free_modules": ["planning"],
        "onboarding_completed": True, "plan": "free",
    })
    assert response.status_code == 200, response.text
    assert response.json()["free_modules"] == ["planning"]
    assert response.json()["onboarding_completed"] is True
    assert response.json()["plan"] == "free"
    assert response.json()["trial_ends"] is None


def test_planning_trial_is_explicit_lasts_72_hours_and_cannot_be_extended(client, make_user, auth_headers):
    user = make_user(plan="free", free_modules=[], onboarding_completed=False)
    headers = auth_headers(user)
    response = client.patch("/api/v1/users/me", headers=headers, json={
        "free_modules": ["planning"], "onboarding_completed": True, "plan": "trial",
    })
    assert response.status_code == 200, response.text
    expiry = datetime.fromisoformat(response.json()["trial_ends"].replace("Z", "+00:00"))
    assert timedelta(hours=71, minutes=59) < expiry - datetime.now(expiry.tzinfo) <= timedelta(hours=72)
    again = client.patch("/api/v1/users/me", headers=headers, json={"plan": "trial"})
    assert again.status_code == 200
    assert again.json()["trial_ends"] == response.json()["trial_ends"]


@pytest.mark.parametrize("modules", [[], ["health"], ["planning", "health"],
    ["planning", "health", "finance", "books"], ["planning", "planning", "health"]])
def test_invalid_module_selection_cannot_complete_onboarding(client, make_user, auth_headers, modules):
    user = make_user(plan="free", free_modules=[], onboarding_completed=False)
    headers = auth_headers(user)
    response = client.patch("/api/v1/users/me", headers=headers, json={
        "free_modules": modules, "onboarding_completed": True,
    })
    assert response.status_code == 422
    assert client.get("/api/v1/users/me", headers=headers).json()["onboarding_completed"] is False


def test_onboarding_requires_selection_and_preserves_legacy_modules(client, make_user, auth_headers):
    fresh = make_user(plan="free", free_modules=[], onboarding_completed=False)
    assert client.patch("/api/v1/users/me", headers=auth_headers(fresh), json={"onboarding_completed": True}).status_code == 422
    legacy = make_user(plan="free", free_modules=["health", "finance", "books"], onboarding_completed=False)
    headers = auth_headers(legacy)
    response = client.patch("/api/v1/users/me", headers=headers, json={"onboarding_completed": True, "name": "Existing user"})
    assert response.status_code == 200
    assert response.json()["free_modules"] == ["health", "finance", "books"]
    assert client.patch("/api/v1/users/me", headers=headers, json={"free_modules": ["planning"]}).status_code == 409
