import httpx

from tests.test_auth import PASSWORD, register


WEB = {"X-LifeHub-Client": "web", "Sec-Fetch-Site": "same-origin"}


def test_cookie_login_refresh_logout_and_csrf(client, app):
    register(client, app)
    client.base_url = httpx.URL("https://testserver")
    login = client.post("/api/v1/auth/login", headers=WEB, json={"email": "user@example.com", "password": PASSWORD})
    assert login.status_code == 200
    session = login.json()["tokens"]
    assert set(session) == {"token_type", "session_id", "rotation_id", "expires_at"}
    assert session["token_type"] == "cookie"
    cookies = login.headers.get_list("set-cookie")
    assert len(cookies) == 2
    assert all("HttpOnly" in cookie and "Secure" in cookie and "SameSite=strict" in cookie for cookie in cookies)
    assert any("Path=/api/v1/auth;" in cookie for cookie in cookies)
    headers = {**WEB, "X-LifeHub-Session": session["session_id"]}
    assert client.get("/api/v1/users/me", headers=headers).status_code == 200
    assert client.get("/api/v1/users/me").status_code == 401
    cross_site = {**headers, "Sec-Fetch-Site": "cross-site"}
    assert client.post("/api/v1/auth/refresh", headers=cross_site, json={}).status_code == 403
    assert client.post("/api/v1/auth/logout", headers={"X-LifeHub-Session": session["session_id"]}, json={}).status_code == 422
    rotated = client.post("/api/v1/auth/refresh", headers=headers, json={})
    assert rotated.status_code == 200
    assert rotated.json()["session_id"] == session["session_id"]
    assert rotated.json()["rotation_id"] != session["rotation_id"]
    assert client.post("/api/v1/auth/logout", headers=headers, json={}).status_code == 204
    assert client.get("/api/v1/users/me", headers=headers).status_code == 401
    assert client.post("/api/v1/auth/refresh", headers=headers, json={}).status_code == 401


def test_existing_bearer_session_converts_to_browser_cookies(client, app):
    old = register(client, app)
    rotated = client.post("/api/v1/auth/refresh", headers=WEB, json={"refresh_token": old["tokens"]["refresh_token"]})
    assert rotated.status_code == 200 and rotated.json()["token_type"] == "cookie"
    assert "refresh_token" not in rotated.json()
    headers = {**WEB, "X-LifeHub-Session": rotated.json()["session_id"]}
    assert client.get("/api/v1/users/me", headers=headers).json()["id"] == old["user"]["id"]
