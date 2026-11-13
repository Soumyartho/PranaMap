"""ABHA (Ayushman Bharat Health Account) identifiers and the ABDM adapter.

What is implemented and tested here:
- Strict normalisation of ABHA numbers (14 digits, shown as XX-XXXX-XXXX-XXXX) and ABHA
  addresses (user@abdm, or user@sbx in the sandbox). Malformed identifiers are rejected at sync.
- `MockAbhaService`, the default: format checks only, deterministic, no network.
- `AbdmGatewaySession`: the ABDM gateway session-token call (POST {gateway}/v0.5/sessions with
  clientId/clientSecret), cached until expiry, needed by every other ABDM call.

What needs ABDM sandbox credentials (apply at sandbox.abdm.gov.in) and is NOT implemented: ABHA
verification and creation (ABHA v3 APIs, RSA-encrypted OTP flows) and the HIP/HIU consent
flows. They plug in behind `AbhaService.verify` without changing callers. FHIR R4 bundles for
record exchange already exist (app/services/fhir.py).
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Protocol

import httpx

from app.core.config import get_settings

_ADDRESS = re.compile(r"^[a-z0-9][a-z0-9._]{2,31}@(abdm|sbx)$")


def normalize_abha_number(value: str | None) -> str | None:
    """'91 1234 5678 9012' / '91-1234-5678-9012' → '91-1234-5678-9012'; anything else → None."""
    if not value:
        return None
    digits = re.sub(r"[\s-]", "", value)
    if not re.fullmatch(r"\d{14}", digits):
        return None
    return f"{digits[:2]}-{digits[2:6]}-{digits[6:10]}-{digits[10:]}"


def normalize_abha_address(value: str | None) -> str | None:
    if not value:
        return None
    v = value.strip().lower()
    return v if _ADDRESS.fullmatch(v) else None


@dataclass
class AbhaCheck:
    valid: bool
    normalized: str | None
    verified: bool  # True only when ABDM itself confirmed the identifier
    source: str
    reason: str | None = None


class AbhaService(Protocol):
    def verify(self, number: str) -> AbhaCheck: ...


class MockAbhaService:
    """Format checks only. `verified` is always False: nothing has asked ABDM."""

    source = "mock"

    def verify(self, number: str) -> AbhaCheck:
        n = normalize_abha_number(number)
        return AbhaCheck(valid=n is not None, normalized=n, verified=False, source=self.source,
                         reason=None if n else "ABHA number must have 14 digits")


class AbdmGatewaySession:
    """ABDM gateway access token (v0.5 sessions API), refreshed shortly before it expires."""

    def __init__(self, transport: httpx.BaseTransport | None = None):
        s = get_settings()
        self.url = f"{s.abdm_gateway_url.rstrip('/')}/v0.5/sessions"
        self.client_id, self.client_secret = s.abdm_client_id, s.abdm_client_secret
        self.http = httpx.Client(timeout=15, transport=transport)
        self._token: str | None = None
        self._expires_at = 0.0

    def configured(self) -> bool:
        return bool(self.client_id and self.client_secret)

    def token(self) -> str:
        if self._token and time.monotonic() < self._expires_at - 60:
            return self._token
        r = self.http.post(self.url, json={"clientId": self.client_id, "clientSecret": self.client_secret})
        if r.status_code != 200:
            raise RuntimeError(f"ABDM session failed ({r.status_code})")
        body = r.json()
        self._token = body["accessToken"]
        self._expires_at = time.monotonic() + float(body.get("expiresIn", 600))
        return self._token


def abha_service() -> AbhaService:
    # Only the mock exists until sandbox credentials are available (see module docstring).
    return MockAbhaService()
