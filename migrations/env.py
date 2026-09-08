from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

from app import models  # noqa: F401
from app.core.config import Settings
from app.core.database import Base, UTCDateTime

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)
target_metadata = Base.metadata


def render_item(type_, obj, autogen_context):
    if type_ == 'type' and isinstance(obj, UTCDateTime):
        return 'sa.DateTime(timezone=True)'
    return False


url = context.get_x_argument(as_dictionary=True).get('database_url') or Settings().database_url
if context.is_offline_mode():
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True,
                      dialect_opts={'paramstyle': 'named'}, render_item=render_item)
    with context.begin_transaction():
        context.run_migrations()
else:
    connectable = create_engine(url, poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True, render_item=render_item)
        with context.begin_transaction():
            context.run_migrations()
