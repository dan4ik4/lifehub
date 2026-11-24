from uuid import UUID

from fastapi import Request, Response

from app.core.errors import AppError
from app.modules.auth.schemas import BrowserAuthSession, BrowserSessionTokens


def web_client(request: Request) -> bool:
    # This custom header is intentionally excluded from the CORS allowlist.
    if request.headers.get("x-lifehub-client") != "web":
        return False
    if request.headers.get("sec-fetch-site") not in (None, "same-origin"):
        raise AppError(403, "invalid_origin", "A same-origin request is required")
    return True


def cookie_keys(request: Request, family: str):
    secure = request.app.state.settings.environment == "production" or request.url.scheme == "https"
    prefix = "__Secure-" if secure else ""
    return [
        (f"{prefix}lifehub_access_{family}", "/api/v1", secure),
        (f"{prefix}lifehub_refresh_{family}", "/api/v1/auth", secure),
    ]


def browser_token(request: Request, *, refresh: bool) -> str | None:
    if not web_client(request):
        return None
    family = request.headers.get("x-lifehub-session", "")
    try:
        family = str(UUID(family))
    except ValueError:
        return None
    name, _, _ = cookie_keys(request, family)[int(refresh)]
    return request.cookies.get(name)


def token_response(request, response, auth, tokens):
    if not web_client(request):
        return tokens
    refresh = auth.tokens.decode(tokens.refresh_token, "refresh")
    access = auth.tokens.decode(tokens.access_token, "access")
    family = refresh["family_id"]
    values = [(tokens.access_token, tokens.expires_in), (tokens.refresh_token, tokens.refresh_expires_in)]
    for (name, path, secure), (value, ttl) in zip(cookie_keys(request, family), values, strict=True):
        response.set_cookie(name, value, max_age=ttl, path=path, secure=secure, httponly=True, samesite="strict")
    return BrowserSessionTokens(session_id=family, rotation_id=refresh["jti"], expires_at=access["exp"])


def sign_in_response(request, response, auth, session):
    if not web_client(request):
        return session
    return BrowserAuthSession(user=session.user, is_new_user=session.is_new_user,
                              tokens=token_response(request, response, auth, session.tokens))


def presented_refresh(request, payload):
    # An existing JSON token can be exchanged once to migrate an older browser session.
    if payload.refresh_token:
        return payload.refresh_token
    token = browser_token(request, refresh=True)
    if token:
        return token
    if web_client(request):
        raise AppError(401, "invalid_refresh", "Sign in again")
    raise AppError(422, "validation_error", "A refresh token is required")


def expire_cookies(request: Request, response: Response):
    if web_client(request):
        family = request.headers.get("x-lifehub-session", "")
        try:
            family = str(UUID(family))
        except ValueError:
            return
        for name, path, secure in cookie_keys(request, family):
            response.delete_cookie(name, path=path, secure=secure, httponly=True, samesite="strict")
