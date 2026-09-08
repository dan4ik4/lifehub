from fastapi import Request


def get_settings(request: Request):
    return request.app.state.settings


def get_db(request: Request):
    with request.app.state.session_factory() as session:
        yield session
