import httpx

from app.core.config import get_settings
from app.integrations.abdm.abha import AbdmGatewaySession, MockAbhaService, normalize_abha_address, normalize_abha_number


def test_abha_number_normalisation():
    assert normalize_abha_number("91 1234 5678 9012") == "91-1234-5678-9012"
    assert normalize_abha_number("91-1234-5678-9012") == "91-1234-5678-9012"
    assert normalize_abha_number("9112345678901") is None  # 13 digits
    assert normalize_abha_number("91-1234-5678-90AB") is None
    assert normalize_abha_number(None) is None


def test_abha_address_normalisation():
    assert normalize_abha_address("Rina.Mondal@abdm") == "rina.mondal@abdm"
    assert normalize_abha_address("rina@sbx") == "rina@sbx"
    assert normalize_abha_address("rina@gmail.com") is None


def test_mock_never_claims_verification():
    check = MockAbhaService().verify("91 1234 5678 9012")
    assert check.valid and check.normalized == "91-1234-5678-9012" and check.verified is False


def test_gateway_session_token_is_cached(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "abdm_client_id", "SBX_001")
    monkeypatch.setattr(s, "abdm_client_secret", "secret")
    calls = []

    def handler(req: httpx.Request):
        calls.append(req.url.path)
        assert req.url.path.endswith("/v0.5/sessions")
        return httpx.Response(200, json={"accessToken": "tok-1", "expiresIn": 1200})

    session = AbdmGatewaySession(httpx.MockTransport(handler))
    assert session.configured() and session.token() == "tok-1" and session.token() == "tok-1"
    assert len(calls) == 1
