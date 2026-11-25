from contextlib import asynccontextmanager
import re
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.core.config import Settings
from app.core.database import Base, build_database
from app.core.errors import ErrorResponse, error_response, register_error_handlers
from app.core.rate_limits import MemoryRateLimiter, RedisRateLimiter
from app.modules.finance.pdf_extract import MAX_CONFIRM_BYTES, MAX_REQUEST_BYTES

PDF_UPLOAD_PATH = '/api/v1/finance/pdf-imports'
IMPORT_CONFIRM_PATH = re.compile(r'/api/v1/finance/csv-imports/[0-9a-fA-F-]{36}/confirm')


def create_app(settings: Settings | None = None) -> FastAPI:
    from app import models  # noqa: F401
    from app.api.v1.router import router
    from app.modules.auth.email import build_email_sender
    from app.modules.auth.oauth import OAuthTokenVerifier

    settings = settings or Settings()
    engine, session_factory = build_database(settings.database_url)

    @asynccontextmanager
    async def lifespan(application):
        if settings.environment == 'test':
            Base.metadata.create_all(engine)
        try:
            yield
        finally:
            application.state.rate_limiter.close()
            for name in ('email_sender', 'oauth_verifier'):
                close = getattr(getattr(application.state, name, None), 'close', None)
                if close:
                    close()
            engine.dispose()

    application = FastAPI(
        title='Life Hub — Auth & Planning', version='1.0.0', lifespan=lifespan,
        description='Python backend for authentication and planning. Dates must include a UTC offset; timezone fields use IANA names.',
        responses={status: {'model': ErrorResponse} for status in (400, 401, 403, 404, 409, 410, 422, 423, 429, 502, 503)},
    )
    application.state.settings = settings
    application.state.engine = engine
    application.state.session_factory = session_factory
    application.state.rate_limiter = MemoryRateLimiter() if settings.environment == 'test' else RedisRateLimiter(settings.redis_url)
    application.state.email_sender = build_email_sender(settings)
    application.state.oauth_verifier = OAuthTokenVerifier(settings)
    register_error_handlers(application)

    @application.middleware('http')
    async def request_metadata(request: Request, call_next):
        request.state.trace_id = uuid4().hex
        length = request.headers.get('content-length')
        path = request.url.path.rstrip('/')
        pdf_upload = request.method == 'POST' and path == PDF_UPLOAD_PATH
        import_confirm = request.method == 'POST' and IMPORT_CONFIRM_PATH.fullmatch(path)
        body_limit = MAX_REQUEST_BYTES if pdf_upload else MAX_CONFIRM_BYTES if import_confirm else 1_048_576
        if length:
            try:
                too_large = int(length) > body_limit or int(length) < 0
            except ValueError:
                too_large = True
            if too_large:
                return error_response(request, 413, 'request_too_large', 'Файл превышает допустимый размер запроса.')
        if pdf_upload or import_confirm:
            chunks, size = [], 0
            async for chunk in request.stream():
                size += len(chunk)
                if size > body_limit:
                    return error_response(request, 413, 'request_too_large', 'Файл превышает допустимый размер запроса.')
                chunks.append(chunk)
            # Starlette's CachedRequest replays this bounded body to FastAPI.
            request._body = b''.join(chunks)
        response = await call_next(request)
        response.headers['X-Trace-ID'] = request.state.trace_id
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        if request.url.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    application.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
    if settings.cors_origins:
        application.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=False,
                                   allow_methods=['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
                                   allow_headers=['Authorization', 'Content-Type', 'Idempotency-Key'],
                                   expose_headers=['X-Trace-ID', 'Retry-After'])
    application.include_router(router)

    @application.get('/health/live', tags=['health'])
    def live():
        return {'status': 'ok'}

    @application.get('/health/ready', tags=['health'])
    def ready(request: Request):
        try:
            with engine.connect() as connection:
                connection.execute(text('SELECT 1'))
            if settings.environment != 'test':
                request.app.state.rate_limiter.redis.ping()
        except Exception:
            return error_response(request, 503, 'not_ready', 'A required service is unavailable')
        return {'status': 'ok'}

    return application
