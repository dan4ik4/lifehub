"""Disposable PDF UI fixture. Synthetic statement/provider only."""
from contextlib import asynccontextmanager
from sqlalchemy import select
from tests.overview_smoke_app import app
from tests.test_pdf_import import pdf_mapping
from app.modules.auth.models import User

app.state.pdf_import_provider = pdf_mapping
original_pdf_lifespan = app.router.lifespan_context


@asynccontextmanager
async def lifespan(application):
    async with original_pdf_lifespan(application):
        with app.state.session_factory() as db:
            user = db.scalar(select(User).where(User.email == 'overview-qa@example.com'))
            user.chat_preferences = {'messages': True, 'modules': True, 'media': False}
            db.commit()
        yield


app.router.lifespan_context = lifespan
