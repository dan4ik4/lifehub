"""Create local secrets without printing them or overwriting an existing .env."""
import secrets
from pathlib import Path

from cryptography.fernet import Fernet

root = Path(__file__).resolve().parents[1]
target = root / '.env'
if target.exists():
    raise SystemExit('.env already exists; left unchanged')
password = secrets.token_urlsafe(32)
text = (root / '.env.example').read_text(encoding='utf-8')
text = text.replace('POSTGRES_PASSWORD=\n', f'POSTGRES_PASSWORD={password}\n')
text = text.replace('YOUR_PASSWORD', password)
for key in ('JWT_SECRET', 'OTP_SECRET'):
    text = text.replace(f'LIFEHUB_{key}=\n', f'LIFEHUB_{key}={secrets.token_urlsafe(48)}\n')
text = text.replace('LIFEHUB_ENCRYPTION_KEY=\n', f'LIFEHUB_ENCRYPTION_KEY={Fernet.generate_key().decode()}\n')
with target.open('x', encoding='utf-8') as file:
    file.write(text)
print('Created .env with independent local secrets; configure provider credentials before use.')
