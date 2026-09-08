from typing import Literal

from cryptography.fernet import Fernet
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', env_prefix='LIFEHUB_', extra='ignore')

    environment: Literal['development', 'test', 'production'] = 'development'
    database_url: str = 'postgresql+psycopg2://lifehub:lifehub@localhost:5432/lifehub'
    redis_url: str = 'redis://localhost:6379/0'
    jwt_secret: str = ''
    jwt_issuer: str = 'lifehub'
    jwt_audience: str = 'lifehub-client'
    access_token_minutes: int = 15
    refresh_token_days: int = 30
    otp_secret: str = ''
    encryption_key: str = ''
    email_backend: Literal['resend', 'memory'] = 'resend'
    resend_api_key: str = ''
    email_from: str = 'Life Hub <noreply@example.com>'
    google_client_ids: list[str] = Field(default_factory=list)
    apple_client_ids: list[str] = Field(default_factory=list)
    google_calendar_client_id: str = ''
    google_calendar_client_secret: str = ''
    calendar_redirect_uris: list[str] = Field(default_factory=list)
    openai_api_key: str = ''
    openai_model: str = 'gpt-5.6-luna'
    cors_origins: list[str] = Field(default_factory=list)
    allowed_hosts: list[str] = Field(default_factory=lambda: ['localhost', '127.0.0.1', 'testserver'])
    reminder_webhook_url: str | None = None
    reminder_webhook_token: str | None = None
    calendar_sync_interval_seconds: int = Field(default=300, ge=10)
    worker_poll_seconds: float = Field(default=1, ge=0.1, le=60)

    @model_validator(mode='after')
    def secure_configuration(self):
        if self.environment != 'test':
            if len(self.jwt_secret) < 32 or len(self.otp_secret) < 32:
                raise ValueError('Set independent LIFEHUB_JWT_SECRET and LIFEHUB_OTP_SECRET of at least 32 characters')
            if self.jwt_secret == self.otp_secret:
                raise ValueError('JWT and OTP secrets must be different')
            if self.email_backend == 'memory':
                raise ValueError('The in-memory email backend is available only for tests')
            if not self.database_url.startswith('postgresql'):
                raise ValueError('Application runtime requires PostgreSQL; SQLite is only for tests')
            if not self.encryption_key:
                raise ValueError('Set LIFEHUB_ENCRYPTION_KEY to a Fernet key')
        if self.encryption_key:
            Fernet(self.encryption_key.encode())
        if self.environment == 'production':
            if not self.resend_api_key:
                raise ValueError('Production requires LIFEHUB_RESEND_API_KEY')
            if '*' in self.allowed_hosts or '*' in self.cors_origins:
                raise ValueError('Production requires explicit allowed hosts and CORS origins')
        return self
