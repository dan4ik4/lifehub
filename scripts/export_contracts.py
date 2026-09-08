"""Export OpenAPI and PostgreSQL DDL without connecting to providers."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.core.config import Settings
from app.main import create_app

settings = Settings(_env_file=None, environment='test', database_url='sqlite://', email_backend='memory')
app = create_app(settings)
(ROOT / 'docs/openapi.json').write_text(json.dumps(app.openapi(), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
result = subprocess.run([sys.executable, '-m', 'alembic', '-x', 'database_url=postgresql+psycopg2://localhost/lifehub', 'upgrade', 'head', '--sql'],
                        cwd=ROOT, capture_output=True, text=True, check=True)
(ROOT / 'docs/schema-postgresql.sql').write_text(result.stdout, encoding='utf-8')
print(f'Exported {len(app.openapi()["paths"])} API paths and PostgreSQL schema')
