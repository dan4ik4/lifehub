from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator


def normalize_email(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("Email must be a string")
    return value.strip().lower()


def validate_password(value: str) -> str:
    if len(value) < 8 or not any(c.isupper() for c in value) or not any(c.islower() for c in value) or not any(c.isdigit() for c in value):
        raise ValueError("Password needs at least 8 characters, an uppercase letter, a lowercase letter and a digit")
    return value


class RequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EmailRequest(RequestModel):
    email: EmailStr = Field(max_length=320)
    _email = field_validator("email", mode="before")(normalize_email)


class PreregisterRequest(EmailRequest):
    name: str = Field(default="", max_length=50)
    password: str = Field(max_length=1024)
    _password = field_validator("password")(validate_password)


class ConfirmRegistrationRequest(RequestModel):
    challenge_id: UUID
    otp: str = Field(pattern=r"^[0-9]{6}$")


class ResendOtpRequest(RequestModel):
    challenge_id: UUID


class LoginRequest(EmailRequest):
    password: str = Field(min_length=1, max_length=1024)


class SocialLoginRequest(RequestModel):
    provider: Literal["google", "apple"]
    token: str = Field(min_length=1, max_length=16384)
    nonce: str | None = Field(default=None, min_length=16, max_length=512)

    @model_validator(mode="after")
    def apple_requires_nonce(self):
        if self.provider == "apple" and not self.nonce:
            raise ValueError("Apple sign-in requires the original random nonce")
        return self


class RefreshTokenRequest(RequestModel):
    refresh_token: str = Field(min_length=1, max_length=8192)


class LogoutRequest(RefreshTokenRequest):
    pass


class ForgotPasswordRequest(EmailRequest):
    pass


class ResetPasswordRequest(EmailRequest):
    code: str = Field(pattern=r"^[0-9]{6}$")
    new_password: str = Field(max_length=1024)
    _password = field_validator("new_password")(validate_password)


class ChangeEmailRequest(RequestModel):
    new_email: EmailStr = Field(max_length=320)
    _email = field_validator("new_email", mode="before")(normalize_email)


class ConfirmEmailChangeRequest(ConfirmRegistrationRequest):
    pass


class ChangePasswordRequest(RequestModel):
    current_password: str = Field(min_length=1, max_length=1024)
    new_password: str = Field(max_length=1024)
    _password = field_validator("new_password")(validate_password)


class OtpChallengeResponse(BaseModel):
    challenge_id: UUID
    otp_expires_at: datetime
    registration_expires_at: datetime
    resend_available_at: datetime
    attempts_left: int


class TokenPairResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    refresh_expires_in: int


class UserAuthResponse(BaseModel):
    id: UUID
    name: str
    email: EmailStr
    email_verified: bool
    auth_providers: list[Literal["password", "google", "apple"]]
    plan: Literal["free", "trial", "pro"]
    trial_ends: datetime | None
    onboarding_completed: bool
    free_modules: list[str]
    timezone: str


class AuthSessionResponse(BaseModel):
    user: UserAuthResponse
    tokens: TokenPairResponse
    is_new_user: bool


class MessageResponse(BaseModel):
    message: str
