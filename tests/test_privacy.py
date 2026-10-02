import base64, io, json, zipfile
from datetime import timedelta
from PIL import Image
from sqlalchemy import select
from app.core.database import utcnow
from app.modules.auth.models import User
from app.modules.auth.passwords import password_hasher
from app.modules.users.models import DataExport
from app.modules.users.privacy import run_privacy_jobs


def test_export_owner_scope_and_excludes_secrets(client, db, settings, make_user, auth_headers):
    user = make_user(password_hash=password_hasher.hash("Test-password9"))
    other = make_user()
    h = auth_headers(user)
    client.post("/api/v1/books", headers=h, json={"title": "My book"})
    client.post("/api/v1/books", headers=auth_headers(other), json={"title": "Other private book"})
    response = client.post("/api/v1/users/me/exports", headers=h, json={"format": "json"})
    assert response.status_code == 202, response.text
    item_id = response.json()["id"]
    run_privacy_jobs(db, settings)
    assert client.get("/api/v1/users/me/exports/" + item_id, headers=auth_headers(other)).status_code == 404
    data = json.loads(base64.b64decode(client.get("/api/v1/users/me/exports/" + item_id, headers=h).json()["data"]))
    assert [b["title"] for b in data["books"]] == ["My book"]
    serialized = json.dumps(data)
    assert (
        "password_hash" not in serialized
        and "encrypted_credentials" not in serialized
        and "token_hash" not in serialized
    )


def test_avatar_normalization_and_validation(client, make_user, auth_headers):
    h = auth_headers(make_user())
    other = auth_headers(make_user())
    out = io.BytesIO()
    Image.new("RGB", (300, 400), "blue").save(out, format="PNG")
    response = client.post(
        "/api/v1/users/me/avatar",
        headers=h,
        json={"data": "data:image/png;base64," + base64.b64encode(out.getvalue()).decode()},
    )
    assert response.status_code == 204, response.text
    image = Image.open(
        io.BytesIO(base64.b64decode(client.get("/api/v1/users/me/avatar", headers=h).json()["data"].split(",")[1]))
    )
    assert image.size == (256, 256) and image.format == "JPEG"
    assert client.get("/api/v1/users/me/avatar", headers=other).json()["data"] is None
    assert (
        client.post(
            "/api/v1/users/me/avatar", headers=h, json={"data": "data:image/svg+xml;base64,PHN2Zz4="}
        ).status_code
        == 422
    )


def test_deletion_closes_access_and_purges_after_grace(client, db, settings, make_user, auth_headers):
    user = make_user(password_hash=password_hasher.hash("Test-password9"))
    uid = user.id
    h = auth_headers(user)
    client.post("/api/v1/books", headers=h, json={"title": "Private book"})
    assert (
        client.request(
            "DELETE", "/api/v1/users/me", headers=h, json={"password": "bad", "confirm": "DELETE"}
        ).status_code
        == 400
    )
    assert (
        client.request(
            "DELETE", "/api/v1/users/me", headers=h, json={"password": "Test-password9", "confirm": "DELETE"}
        ).status_code
        == 204
    )
    assert client.get("/api/v1/users/me", headers=h).status_code == 401
    db.refresh(user)
    assert user.deleted_at
    run_privacy_jobs(db, settings)
    assert db.scalar(select(User.id).where(User.id == uid)) is not None
    user.deleted_at = utcnow() - timedelta(days=31)
    db.commit()
    run_privacy_jobs(db, settings)
    assert db.scalar(select(User.id).where(User.id == uid)) is None


def test_csv_formula_text_is_escaped():
    from app.modules.users.privacy import make_export

    data = {"profile": {}, "exported_at": "now", "diary_entries": [{"title": "=CMD()", "text": "private"}]}
    archive = zipfile.ZipFile(io.BytesIO(make_export(data, "csv")))
    assert "'=CMD()" in archive.read("diary_entries.csv").decode("utf-8-sig")
