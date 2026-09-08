import hashlib

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.dependencies import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.auth.schemas import (AuthSessionResponse, ChangeEmailRequest, ChangePasswordRequest, ConfirmEmailChangeRequest,
    ConfirmRegistrationRequest, ForgotPasswordRequest, LoginRequest, LogoutRequest, MessageResponse, OtpChallengeResponse,
    PreregisterRequest, RefreshTokenRequest, ResendOtpRequest, ResetPasswordRequest, SocialLoginRequest, TokenPairResponse, UserAuthResponse)
from app.modules.auth.service import AuthService

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def service(request: Request, db: Session = Depends(get_db)):
    return AuthService(db, request.app.state.settings, request.app.state.email_sender, request.app.state.oauth_verifier)


def ip_limit(request, endpoint, limit):
    ip = request.client.host if request.client else "unknown"
    request.app.state.rate_limiter.hit(f"auth:{endpoint}:ip:{ip}", limit, 3600)


def subject_limit(request, endpoint, subject, limit, window=3600):
    digest = hashlib.sha256(str(subject).encode()).hexdigest()
    request.app.state.rate_limiter.hit(f"auth:{endpoint}:subject:{digest}", limit, window)


def device_info(request):
    return request.headers.get("user-agent", "")[:512]


@router.post("/pre-register", response_model=OtpChallengeResponse, status_code=202, include_in_schema=False)
@router.post("/preregister", response_model=OtpChallengeResponse, status_code=202)
def preregister(payload: PreregisterRequest, request: Request, auth: AuthService = Depends(service)):
    ip_limit(request, "preregister", 5)
    return auth.preregister(payload)


@router.post("/confirm", response_model=AuthSessionResponse, status_code=201)
def confirm(payload: ConfirmRegistrationRequest, request: Request, auth: AuthService = Depends(service)):
    ip_limit(request, "confirm", 30)
    return auth.confirm(payload, device_info(request))


@router.post("/send-code", response_model=OtpChallengeResponse, status_code=202, include_in_schema=False)
@router.post("/resend", response_model=OtpChallengeResponse, status_code=202)
def resend(payload: ResendOtpRequest, request: Request, auth: AuthService = Depends(service)):
    ip_limit(request, "resend", 10)
    return auth.resend(payload.challenge_id)


@router.post("/login", response_model=AuthSessionResponse)
def login(payload: LoginRequest, request: Request, auth: AuthService = Depends(service)):
    ip_limit(request, "login", 20)
    return auth.login(payload, device_info(request))


@router.post("/social", response_model=AuthSessionResponse)
def social(payload: SocialLoginRequest, request: Request, response: Response, auth: AuthService = Depends(service)):
    ip_limit(request, "social", 20)
    result = auth.social(payload, device_info(request))
    response.status_code = 201 if result.is_new_user else 200
    return result


@router.post("/refresh", response_model=TokenPairResponse)
def refresh(payload: RefreshTokenRequest, request: Request, auth: AuthService = Depends(service)):
    ip_limit(request, "refresh", 120)
    return auth.tokens.refresh(payload.refresh_token, device_info(request))


@router.post("/logout", status_code=204)
def logout(payload: LogoutRequest, auth: AuthService = Depends(service)):
    auth.tokens.logout(payload.refresh_token)
    return Response(status_code=204)


@router.post("/forgot-password", response_model=MessageResponse, status_code=202)
def forgot_password(payload: ForgotPasswordRequest, request: Request, auth: AuthService = Depends(service)):
    ip_limit(request, "forgot-password", 10)
    subject_limit(request, "forgot-password", payload.email, 3)
    return auth.forgot_password(payload.email)


@router.post("/reset-password", status_code=204)
def reset_password(payload: ResetPasswordRequest, request: Request, auth: AuthService = Depends(service)):
    ip_limit(request, "reset-password", 30)
    subject_limit(request, "reset-password", payload.email, 15)
    auth.reset_password(payload)
    return Response(status_code=204)


@router.post("/change-email", response_model=OtpChallengeResponse, status_code=202)
def change_email(payload: ChangeEmailRequest, request: Request, user: User = Depends(get_current_user), auth: AuthService = Depends(service)):
    ip_limit(request, "change-email", 20)
    subject_limit(request, "change-email", user.id, 10)
    return auth.change_email(user, payload.new_email)


@router.post("/confirm-email-change", response_model=UserAuthResponse)
def confirm_email_change(payload: ConfirmEmailChangeRequest, request: Request, user: User = Depends(get_current_user), auth: AuthService = Depends(service)):
    ip_limit(request, "confirm-email-change", 30)
    return auth.confirm_email_change(user, payload)


@router.post("/change-password", status_code=204)
def change_password(payload: ChangePasswordRequest, request: Request, user: User = Depends(get_current_user), auth: AuthService = Depends(service)):
    ip_limit(request, "change-password", 20)
    subject_limit(request, "change-password", user.id, 5, 900)
    auth.change_password(user, payload)
    return Response(status_code=204)
