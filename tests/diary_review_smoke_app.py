"""Synthetic diary-review UI fixture; no real OpenAI or production data."""
from contextlib import asynccontextmanager
from datetime import timedelta
from zoneinfo import ZoneInfo
from sqlalchemy import select
from tests.overview_smoke_app import app
from app.core.database import utcnow
from app.modules.auth.models import User
from app.modules.books.models import DiaryEntry


def provider(start, end, entries):
    return {'summary': 'Вы описали чтение и прогулку. За остальные дни записей нет, поэтому обзор отражает только отмеченные события.',
        'highlights': [{'text': e['text'], 'entry_ids': [e['id']]} for e in entries], 'themes': [],
        'reflection_question': 'Какое из описанных занятий хочется повторить на следующей неделе?'}


app.state.diary_review_provider = provider
original_diary_lifespan = app.router.lifespan_context


@asynccontextmanager
async def lifespan(application):
    async with original_diary_lifespan(application):
        with app.state.session_factory() as db:
            user = db.scalar(select(User).where(User.email == 'overview-qa@example.com'))
            user.chat_preferences = {'messages': True, 'modules': True, 'media': False}
            day = utcnow().astimezone(ZoneInfo(user.timezone)).date()
            db.add_all([DiaryEntry(user_id=user.id, day=day-timedelta(days=1), title='Прогулка', text='Погулял вечером в парке и встретил друга.'),
                DiaryEntry(user_id=user.id, day=day-timedelta(days=3), title='Чтение', text='Прочитал несколько глав и выписал интересные мысли.')])
            db.commit()
        yield


app.router.lifespan_context = lifespan
