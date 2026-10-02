"""Administrator-only restoration within the 30-day deletion grace period.
Confirm account ownership through support first. Use the UUID, never ambiguous email.
Dry run by default; --apply requires deliberate operator confirmation.
"""

import argparse
from datetime import timedelta
from pathlib import Path
from uuid import UUID
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from app import models
from app.core.config import Settings
from app.core.database import utcnow
from app.modules.auth.models import User


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("user_id", type=UUID)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    engine = create_engine(Settings().database_url)
    with Session(engine) as db:
        user = db.scalar(select(User).where(User.id == args.user_id).with_for_update())
        if not user or not user.deleted_at:
            raise SystemExit("No deleted account with this UUID")
        if user.deleted_at <= utcnow() - timedelta(days=30):
            raise SystemExit("Recovery window has expired")
        if not args.apply:
            print("Account can be restored. Confirm ownership before using --apply.")
        else:
            user.deleted_at = None
            db.commit()
            print("Account restored. Sign in again; previous sessions remain revoked.")
    engine.dispose()


if __name__ == "__main__":
    main()
