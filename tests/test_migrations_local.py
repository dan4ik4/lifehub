"""Migration parity check independent of any application database."""

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.autogenerate import compare_metadata
from sqlalchemy import create_engine
from app.core.database import Base


def test_migration_roundtrip_matches_models(tmp_path, monkeypatch, settings):
    url = "sqlite:///" + str(tmp_path / "migration.db")
    monkeypatch.setenv("LIFEHUB_ENVIRONMENT", "test")
    monkeypatch.setenv("LIFEHUB_DATABASE_URL", url)
    monkeypatch.setenv("LIFEHUB_ENCRYPTION_KEY", settings.encryption_key)
    config = Config("alembic.ini")
    command.upgrade(config, "head")
    engine = create_engine(url)
    with engine.connect() as connection:
        assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []
    engine.dispose()
    command.downgrade(config, "0001")
    command.upgrade(config, "head")
