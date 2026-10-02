"""Run with ``python -m app.workers.scheduler`` after applying migrations."""

from __future__ import annotations

import logging
import signal
import threading
import time

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import Settings
from app.workers.jobs.calendar_sync import run_calendar_sync

log = logging.getLogger("lifehub.worker")


def run_once(
    session_factory, settings, provider_factory=None, reminder_delivery=None, cleanup_auth=False, maintenance=True
):
    from app.workers.jobs.reminders import run_reminders

    sync = run_calendar_sync(session_factory, settings, provider_factory=provider_factory)
    with session_factory() as session:
        reminders = run_reminders(session, settings, delivery=reminder_delivery)
    result = {"calendar_sync": sync, "reminders": reminders}
    if maintenance:
        from app.modules.users.privacy import run_privacy_jobs
        from app.workers.jobs.product_notifications import run_product_notifications

        with session_factory() as session:
            result["privacy"] = run_privacy_jobs(session, settings)
        with session_factory() as session:
            result["product_notifications"] = run_product_notifications(session, settings)
    if cleanup_auth:
        from app.modules.auth.cleanup import cleanup_expired_auth

        with session_factory() as session:
            result["auth_cleanup"] = cleanup_expired_auth(session)
    return result


def main():
    # Register every mapped class before the first ORM query; tables are migration-owned.
    from app import models  # noqa: F401

    settings = Settings()
    engine = create_engine(settings.database_url, pool_pre_ping=True)
    session_factory = sessionmaker(engine, expire_on_commit=False)
    stopped = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stopped.set())
    logging.basicConfig(level=logging.INFO)
    next_cleanup_at = 0.0
    next_maintenance_at = 0.0
    try:
        while not stopped.is_set():
            try:
                cleanup_due = time.monotonic() >= next_cleanup_at
                maintenance_due = time.monotonic() >= next_maintenance_at
                result = run_once(session_factory, settings, cleanup_auth=cleanup_due, maintenance=maintenance_due)
                if maintenance_due:
                    next_maintenance_at = time.monotonic() + 30
                if cleanup_due:
                    next_cleanup_at = time.monotonic() + 3600
                if result["calendar_sync"]["failed"]:
                    log.warning("Calendar jobs failed; inspect job status via the authenticated API")
            except Exception:
                # Never log exception locals or HTTP credentials.
                log.error("Worker tick failed; next tick will retry")
            stopped.wait(settings.worker_poll_seconds)
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
