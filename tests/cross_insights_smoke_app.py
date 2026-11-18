"""Synthetic cross-module browser fixture, no real health or banking data."""
from contextlib import asynccontextmanager
from datetime import datetime, time, timedelta
from decimal import Decimal
from sqlalchemy import select, delete
from tests.overview_smoke_app import app
from app.core.database import utcnow
from app.modules.auth.models import User
from app.modules.health.models import SleepEntry
from app.modules.finance.models import Transaction

original_insight_lifespan = app.router.lifespan_context


def provider(data):
    return {'comparison_ids': [value['id'] for value in data['comparisons'][:3]]}


app.state.cross_review_provider = provider


@asynccontextmanager
async def lifespan(application):
    async with original_insight_lifespan(application):
        with app.state.session_factory() as db:
            user = db.scalar(select(User).where(User.email == 'overview-qa@example.com'))
            user.chat_preferences = {'messages': True, 'modules': True, 'media': False}
            db.execute(delete(SleepEntry).where(SleepEntry.user_id == user.id))
            end = utcnow().date()-timedelta(days=1)
            for index in range(8):
                day = end-timedelta(days=7-index)
                wake = datetime.combine(day, time(8), utcnow().tzinfo)
                db.add(SleepEntry(user_id=user.id, start_at=wake-timedelta(hours=6 if index<4 else 8), end_at=wake, quality=3))
                db.add(Transaction(user_id=user.id, day=day, title='Учебная покупка', notes='', category='other',
                    kind='expense', currency='PLN', amount=Decimal('20' if index<4 else '10')))
            db.commit()
        yield


app.router.lifespan_context = lifespan
