def test_catalog_book_identity_survives_progress_updates(client, make_user, auth_headers):
    owner = auth_headers(make_user())
    other = auth_headers(make_user())
    path = "/api/v1/books"
    draft = {"title": "The Adventures", "open_library_key": "/works/OL123W", "cover_id": 42}
    saved = client.post(path, json=draft, headers=owner)
    assert saved.status_code == 201
    item_path = f"{path}/{saved.json()['id']}"

    progress = client.patch(item_path, headers=owner, json={
        "title": "My edition", "status": "reading", "current_page": 12,
        "notes": "Chapter one", "version": saved.json()["version"],
    })
    assert progress.status_code == 200
    assert progress.json()["open_library_key"] == draft["open_library_key"]
    assert progress.json()["cover_id"] == 42

    repeated = client.post(path, json=draft, headers=owner)
    assert repeated.status_code == 409
    assert repeated.json()["error"]["code"] == "book_already_on_shelf"
    assert client.post(path, json=draft, headers=other).status_code == 201
    assert client.post(path, json={"title": draft["title"]}, headers=owner).status_code == 201
    assert client.delete(item_path, headers=owner, params={"version": progress.json()["version"]}).status_code == 204
    assert client.post(path, json=draft, headers=owner).status_code == 201


def test_manual_book_match_is_advisory_and_scoped_to_active_owned_books(client, make_user, auth_headers):
    owner = auth_headers(make_user())
    other = auth_headers(make_user())
    path = "/api/v1/books"
    draft = {"title": "Гордость и предубеждение", "author": "Джейн Остин"}
    params = {"title": "  ГОРДОСТЬ И   ПРЕДУБЕЖДЕНИЕ", "author": "джейн остин"}
    first = client.post(path, json=draft, headers=owner).json()
    assert client.get(path + "/shelf-match", params=params, headers=owner).json() == {"id": first["id"]}
    assert client.get(path + "/shelf-match", params=params, headers=other).json() == {"id": None}
    assert client.get(path + "/shelf-match", params={**params, "author": "Другой автор"}, headers=owner).json() == {"id": None}
    edition = client.post(path, json={**draft, "total_pages": 247}, headers=owner)
    assert edition.status_code == 201
    for item in (first, edition.json()):
        assert client.delete(f"{path}/{item['id']}", params={"version": item["version"]}, headers=owner).status_code == 204
    assert client.get(path + "/shelf-match", params=params, headers=owner).json() == {"id": None}
