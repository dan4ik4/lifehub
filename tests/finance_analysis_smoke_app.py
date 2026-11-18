"""Synthetic monthly finance UI fixture, never shipped to production."""
from contextlib import asynccontextmanager
from datetime import timedelta
from decimal import Decimal
from sqlalchemy import select
from tests.overview_smoke_app import app
from app.core.database import utcnow
from app.modules.auth.models import User
from app.modules.finance.models import Transaction, Budget, Subscription

original_analysis_lifespan = app.router.lifespan_context


def provider(data):
    ids = [fact['id'] for fact in data['facts']]
    selected = ['observed'] + (['forecast'] if 'forecast' in ids else [])
    selected += [key for key in ids if key.startswith('budget:')][:1]
    selected += [key for key in ids if key.startswith('category:')][:1]
    return {'fact_ids': selected, 'question': 'review_categories'}


app.state.finance_review_provider = provider


@asynccontextmanager
async def lifespan(application):
    async with original_analysis_lifespan(application):
        with app.state.session_factory() as db:
            user = db.scalar(select(User).where(User.email == 'overview-qa@example.com'))
            user.chat_preferences = {'messages': True, 'modules': True, 'media': False}
            day = utcnow().date()
            for index in range(1, day.day):
                db.add(Transaction(user_id=user.id, day=day.replace(day=index), title=f'Учебная покупка {index}',
                    notes='', amount=Decimal('25.50'), kind='expense', currency='PLN', category='food'))
            db.add(Transaction(user_id=user.id, day=day.replace(day=1), title='Учебный доход', notes='',
                amount=Decimal('6500'), kind='income', currency='PLN', category='income'))
            db.add(Budget(user_id=user.id, month=day.strftime('%Y-%m'), currency='PLN', category='food', amount=Decimal('400')))
            db.add(Subscription(user_id=user.id, title='Учебная подписка', amount=Decimal('30'), currency='PLN',
                period='monthly', next_payment=day + timedelta(days=2)))
            db.commit()
        yield


app.router.lifespan_context = lifespan
