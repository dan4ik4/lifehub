"""Disposable browser-QA server. Never imported or shipped by the application.

Run locally: python -m uvicorn tests.frontend_smoke_app:app --host 127.0.0.1 --port 8001
Uses a temporary file-backed SQLite database and mail sink; no production data.
"""
from contextlib import asynccontextmanager
from pathlib import Path
import secrets
from tempfile import TemporaryDirectory
from typing import Literal

from cryptography.fernet import Fernet
from fastapi import HTTPException, Request
from sqlalchemy import event

from app.core.config import Settings
from app.main import create_app

_database_directory = TemporaryDirectory(prefix='lifehub-frontend-qa-')
_database_path = Path(_database_directory.name) / 'browser-qa.sqlite3'

app = create_app(Settings(
    _env_file=None, environment='test',
    database_url=f'sqlite:///{_database_path.as_posix()}', email_backend='memory',
    jwt_secret=secrets.token_urlsafe(48), otp_secret=secrets.token_urlsafe(48),
    encryption_key=Fernet.generate_key().decode(),
    google_client_ids=[], apple_client_ids=[], openai_api_key='',
    allowed_hosts=['127.0.0.1', 'localhost'],
))


@event.listens_for(app.state.engine, 'connect')
def configure_qa_connection(connection, _):
    connection.execute('PRAGMA busy_timeout=10000')


# File-backed SQLite uses separate pooled connections for concurrent browser
# requests. WAL lets readers proceed while a different request is committing.
with app.state.engine.connect() as connection:
    connection.exec_driver_sql('PRAGMA journal_mode=WAL')

_application_lifespan = app.router.lifespan_context


@asynccontextmanager
async def qa_lifespan(application):
    try:
        async with _application_lifespan(application):
            yield
    finally:
        # The original lifespan closes the engine before Windows removes files.
        _database_directory.cleanup()


app.router.lifespan_context = qa_lifespan


@app.get('/api/v1/_test/latest-code', include_in_schema=False)
def latest_code(request: Request, email: Literal['frontend-smoke@example.com']):
    if request.client.host not in {'127.0.0.1', '::1'}:
        raise HTTPException(403)
    messages = [message for message in app.state.email_sender.messages if message['email'] == email]
    if not messages:
        raise HTTPException(404)
    return {'code': messages[-1]['code']}
