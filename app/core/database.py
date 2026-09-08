from datetime import UTC, datetime

from sqlalchemy import DateTime, MetaData, create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.types import TypeDecorator


def utcnow() -> datetime:
    return datetime.now(UTC)


class UTCDateTime(TypeDecorator):
    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError('A timezone-aware datetime is required')
        return value.astimezone(UTC)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention={
        'ix': 'ix_%(column_0_label)s', 'uq': 'uq_%(table_name)s_%(column_0_name)s',
        'ck': 'ck_%(table_name)s_%(constraint_name)s', 'fk': 'fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s',
        'pk': 'pk_%(table_name)s',
    })


def build_database(url: str):
    kwargs = {'pool_pre_ping': True}
    if url.startswith('sqlite'):
        kwargs['connect_args'] = {'check_same_thread': False}
        if ':memory:' in url or url == 'sqlite://':
            kwargs['poolclass'] = StaticPool
    engine = create_engine(url, **kwargs)
    if url.startswith('sqlite'):
        @event.listens_for(engine, 'connect')
        def sqlite_foreign_keys(connection, _):
            connection.execute('PRAGMA foreign_keys=ON')
    return engine, sessionmaker(bind=engine, expire_on_commit=False)
