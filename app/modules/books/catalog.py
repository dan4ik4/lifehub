"""Small, bounded cache for the public Open Library catalog; no personal records are sent."""

from collections import OrderedDict
from threading import Lock
from time import monotonic
import re
import httpx
from app.core.errors import AppError

_cache = OrderedDict()
_lock = Lock()


def search_catalog(query, page=1):
    key = (query.casefold().strip(), page)
    with _lock:
        old = _cache.get(key)
        if old and old[0] > monotonic():
            return old[1]
    try:
        response = httpx.get(
            "https://openlibrary.org/search.json",
            params={
                "q": query,
                "page": page,
                "limit": 20,
                "fields": "key,title,author_name,cover_i,number_of_pages_median",
            },
            headers={"User-Agent": "LifeHub/1.0 (https://lifehapp.online)"},
            timeout=8,
            follow_redirects=False,
        )
        response.raise_for_status()
        data = response.json()
        docs = data.get("docs", [])
        if not isinstance(docs, list):
            raise ValueError("Invalid catalog")
        items = []
        for row in docs[:20]:
            if not isinstance(row, dict) or not isinstance(row.get("title"), str):
                continue
            book_key = row.get("key", "")
            book_key = "/works/" + book_key if isinstance(book_key, str) and book_key.startswith("OL") else book_key
            if not isinstance(book_key, str) or not re.fullmatch(r"/works/OL[0-9]+W", book_key):
                continue
            authors = row.get("author_name", [])
            if not isinstance(authors, list):
                authors = []
            cover = row.get("cover_i")
            pages = row.get("number_of_pages_median")
            items.append(
                {
                    "title": row["title"][:300],
                    "author": ", ".join(a for a in authors[:5] if isinstance(a, str))[:300],
                    "open_library_key": book_key,
                    "cover_id": cover if type(cover) is int and 0 < cover < 2147483648 else None,
                    "total_pages": pages if type(pages) is int and 0 < pages <= 100000 else None,
                }
            )
        result = {"items": items, "has_more": len(docs) >= 20}
    except (httpx.HTTPError, ValueError, TypeError, AttributeError) as error:
        raise AppError(502, "catalog_unavailable", "Book catalog is unavailable; add a book manually") from error
    with _lock:
        _cache[key] = (monotonic() + 3600, result)
        _cache.move_to_end(key)
        while len(_cache) > 100:
            _cache.popitem(last=False)
    return result
