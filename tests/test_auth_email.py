import httpx
import pytest

from app.core.errors import AppError
from app.modules.auth.email import ResendEmailSender


def test_resend_adapter_sends_real_request_without_secrets_in_subject():
    requests = []
    def transport(request):
        requests.append(request)
        return httpx.Response(200, json={"id": "accepted-message"})
    sender = ResendEmailSender("resend-secret", "Life Hub <auth@example.com>", httpx.Client(transport=httpx.MockTransport(transport)))
    sender.send_password_reset("user@example.com", "123456")
    assert len(requests) == 1 and str(requests[0].url) == "https://api.resend.com/emails"
    assert requests[0].headers["Authorization"] == "Bearer resend-secret"
    assert b"123456" in requests[0].content


@pytest.mark.parametrize("status", [401, 429, 500])
def test_resend_failures_do_not_report_success_or_expose_provider_body(status):
    def transport(request):
        return httpx.Response(status, json={"message": "provider-internal-sensitive-details"})
    sender = ResendEmailSender("key", "auth@example.com", httpx.Client(transport=httpx.MockTransport(transport)))
    with pytest.raises(AppError) as failure:
        sender.send_otp("user@example.com", "123456")
    assert failure.value.status_code == 503
    assert "provider-internal" not in failure.value.message
