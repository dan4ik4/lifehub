from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.exc import StaleDataError
from starlette.exceptions import HTTPException


class ErrorDetail(BaseModel):
    field: str | None = None
    message: str
    type: str


class ErrorBody(BaseModel):
    code: str
    message: str
    details: list[ErrorDetail]


class ErrorResponse(BaseModel):
    error: ErrorBody
    trace_id: str


class AppError(Exception):
    def __init__(self, status_code, code, message, details=None, headers=None):
        super().__init__(message)
        self.status_code, self.code, self.message = status_code, code, message
        self.details, self.headers = details or [], headers or {}


def error_response(request, status, code, message, details=None, headers=None):
    trace_id = getattr(request.state, 'trace_id', uuid4().hex)
    return JSONResponse(status_code=status, headers={'X-Trace-ID': trace_id, **(headers or {})}, content={
        'error': {'code': code, 'message': message, 'details': [d.model_dump() if isinstance(d, BaseModel) else d for d in (details or [])]},
        'trace_id': trace_id,
    })


def register_error_handlers(app: FastAPI):
    @app.exception_handler(AppError)
    async def domain_error(request: Request, exc: AppError):
        return error_response(request, exc.status_code, exc.code, exc.message, exc.details, exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        # Do not echo raw input: it can contain passwords, provider tokens or OTPs.
        details = [{'field': '.'.join(map(str, e['loc'])), 'message': e['msg'], 'type': e['type']} for e in exc.errors()]
        return error_response(request, 422, 'validation_error', 'Request validation failed', details)

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        code = {401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 405: 'method_not_allowed'}.get(exc.status_code, 'http_error')
        return error_response(request, exc.status_code, code, str(exc.detail), headers=exc.headers)

    @app.exception_handler(StaleDataError)
    async def stale_data(request: Request, exc: StaleDataError):
        return error_response(request, 409, 'version_conflict', 'Resource was changed by another request')

    @app.exception_handler(IntegrityError)
    async def integrity_error(request: Request, exc: IntegrityError):
        return error_response(request, 409, 'conflict', 'Request conflicts with existing data')

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception):
        # Deliberately omit exception text: database/provider errors may contain credentials.
        return error_response(request, 500, 'internal_error', 'An internal error occurred')
