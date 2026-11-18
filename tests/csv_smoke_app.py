"""Synthetic CSV UI fixture. No bank credentials or real OpenAI calls."""
from contextlib import asynccontextmanager
from sqlalchemy import select
from tests.overview_smoke_app import app
from tests.test_csv_import import CSV, mapping
from app.modules.auth.models import User
from app.modules.finance.csv_import import CsvMapping, normalize_rows
from app.modules.finance.import_models import CsvImport

app.state.csv_import_provider = mapping
original_csv_lifespan = app.router.lifespan_context


@asynccontextmanager
async def lifespan(application):
    async with original_csv_lifespan(application):
        with app.state.session_factory() as db:
            user = db.scalar(select(User).where(User.email == 'overview-qa@example.com'))
            user.chat_preferences = {'messages': True, 'modules': True, 'media': False}
            table = [row.split(';') for row in CSV.strip().splitlines()]
            db.add(CsvImport(user_id=user.id, request_key='synthetic-ui-preview', request_hash='0' * 64,
                account='mBank · учебная выписка', status='pending',
                rows=normalize_rows(table, CsvMapping.model_validate(mapping(table)), 'PLN', user)))
            db.commit()
        yield


app.router.lifespan_context = lifespan
