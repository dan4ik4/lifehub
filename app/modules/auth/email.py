from typing import Protocol

import httpx

from app.core.errors import AppError


class EmailSender(Protocol):
    def send_otp(self, email: str, otp: str) -> None: ...
    def send_password_reset(self, email: str, otp: str) -> None: ...
    def send_email_change(self, email: str, otp: str) -> None: ...
    def send_export_ready(self, email: str, export_id: str) -> None: ...


class MemoryEmailSender:
    """Explicitly selected test/development delivery; never used as a fallback."""

    def __init__(self):
        self.messages: list[dict[str, str]] = []

    def send_otp(self, email: str, otp: str):
        self.messages.append({"kind": "registration", "email": email, "code": otp})

    def send_password_reset(self, email: str, otp: str):
        self.messages.append({"kind": "password_reset", "email": email, "code": otp})

    def send_email_change(self, email: str, otp: str):
        self.messages.append({"kind": "email_change", "email": email, "code": otp})

    def send_export_ready(self, email: str, export_id: str):
        self.messages.append({"kind": "export_ready", "email": email, "export_id": export_id})


class ResendEmailSender:
    def __init__(self, api_key: str, email_from: str, client: httpx.Client | None = None):
        self.api_key, self.email_from = api_key, email_from
        self.client = client or httpx.Client(timeout=10)

    def _send(self, email: str, code: str, subject: str):
        if not self.api_key or not self.email_from:
            raise AppError(503, "provider_unavailable", "Email delivery is not configured")
        try:
            response = self.client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "from": self.email_from,
                    "to": [email],
                    "subject": subject,
                    "text": f"Your Life Hub code is {code}. It expires in 10 minutes. If you did not request this, ignore this email.",
                },
            )
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise AppError(503, "provider_unavailable", "Email delivery is temporarily unavailable") from exc

    def send_otp(self, email: str, otp: str):
        self._send(email, otp, "Verify your Life Hub email")

    def send_password_reset(self, email: str, otp: str):
        self._send(email, otp, "Reset your Life Hub password")

    def send_email_change(self, email: str, otp: str):
        self._send(email, otp, "Verify your new Life Hub email")

    def send_export_ready(self, email: str, export_id: str):
        if not self.api_key:
            raise AppError(503, "provider_unavailable", "Email is not configured")
        try:
            response = self.client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {self.api_key}", "Idempotency-Key": "export-ready-" + export_id},
                json={
                    "from": self.email_from,
                    "to": [email],
                    "subject": "Your Life Hub data export is ready",
                    "text": "Your data export is ready. Sign in at https://lifehapp.online and open Profile to download it. The file is available for 24 hours. If you did not request it, review your account access.",
                },
            )
            response.raise_for_status()
        except httpx.HTTPError as error:
            raise AppError(503, "provider_unavailable", "Email delivery is temporarily unavailable") from error

    def close(self):
        self.client.close()


def build_email_sender(settings) -> EmailSender:
    if settings.email_backend == "memory":
        if settings.environment == "production":
            raise ValueError("Memory email delivery is forbidden in production")
        return MemoryEmailSender()
    return ResendEmailSender(settings.resend_api_key, settings.email_from)
