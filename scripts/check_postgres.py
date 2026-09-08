"""Apply/check migrations and run tests in per-test PostgreSQL schemas.

Reads credentials from Settings without displaying connection strings. Tests only
drop their own randomly named schemas; application tables remain intact.
"""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.core.config import Settings

settings = Settings()
environment = os.environ.copy()
environment['LIFEHUB_TEST_DATABASE_URL'] = settings.database_url
environment['LIFEHUB_TEST_REDIS_URL'] = settings.redis_url
environment['LIFEHUB_TEST_ALL_POSTGRES'] = '1'
for args in (['-m', 'alembic', 'upgrade', 'head'], ['-m', 'alembic', 'check'],
             ['-m', 'pytest', '-q', '-p', 'no:cacheprovider', '--basetemp=.test-tmp-postgres', *sys.argv[1:]]):
    result = subprocess.run([sys.executable, *args], cwd=ROOT, env=environment)
    if result.returncode:
        raise SystemExit(result.returncode)
