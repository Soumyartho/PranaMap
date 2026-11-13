"""Outbound messaging behind one interface. Pick a provider in settings:

    PRANAMAP_SMS_PROVIDER = console | twilio | exotel
    PRANAMAP_WHATSAPP_ENABLED = true   (Meta WhatsApp Cloud API)

`console` sends nothing: messages are recorded as "simulated" so the whole pipeline (templates,
consent check, reminders, retries) runs in development and demos without a contract.
Indian SMS needs DLT registration: every template carries its DLT template id and the entity id
goes with every send. Request formats follow each provider's public REST API.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from app.core.config import get_settings


@dataclass
class OutboundMessage:
    to: str  # E.164, e.g. +919876543210
    body: str
    channel: str  # sms | whatsapp
    template: str
    dlt_template_id: str | None = None
    whatsapp_template: str | None = None
    lang: str = "en"
    params: list[str] | None = None


@dataclass
class SendResult:
    status: str  # sent | simulated
    provider: str
    provider_id: str | None = None


class ProviderError(Exception):
    """Delivery failed; `retryable` tells the dispatcher whether to try again later."""

    def __init__(self, message: str, retryable: bool = True):
        super().__init__(message)
        self.retryable = retryable


def _raise_for(r: httpx.Response, provider: str) -> None:
    if r.status_code < 300:
        return
    # 4xx (bad number, unapproved template) will fail again; 5xx and 429 may not.
    raise ProviderError(f"{provider} {r.status_code}: {r.text[:200]}", retryable=r.status_code >= 500 or r.status_code == 429)


class ConsoleProvider:
    name = "console"

    def send(self, m: OutboundMessage) -> SendResult:
        return SendResult(status="simulated", provider=self.name)


class TwilioSmsProvider:
    name = "twilio"

    def __init__(self, transport: httpx.BaseTransport | None = None):
        s = get_settings()
        self.sid, self.token, self.sender = s.twilio_account_sid, s.twilio_auth_token, s.twilio_from
        self.http = httpx.Client(timeout=15, transport=transport)

    def send(self, m: OutboundMessage) -> SendResult:
        r = self.http.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{self.sid}/Messages.json",
            auth=(self.sid, self.token),
            data={"To": m.to, "From": self.sender, "Body": m.body},
        )
        _raise_for(r, self.name)
        return SendResult(status="sent", provider=self.name, provider_id=r.json().get("sid"))


class ExotelSmsProvider:
    name = "exotel"

    def __init__(self, transport: httpx.BaseTransport | None = None):
        s = get_settings()
        self.sid, self.key, self.token = s.exotel_sid, s.exotel_api_key, s.exotel_api_token
        self.subdomain, self.sender, self.entity = s.exotel_subdomain, s.exotel_sender_id, s.dlt_entity_id
        self.http = httpx.Client(timeout=15, transport=transport)

    def send(self, m: OutboundMessage) -> SendResult:
        r = self.http.post(
            f"https://{self.subdomain}/v1/Accounts/{self.sid}/Sms/send.json",
            auth=(self.key, self.token),
            data={"From": self.sender, "To": m.to, "Body": m.body, "DltEntityId": self.entity, "DltTemplateId": m.dlt_template_id or ""},
        )
        _raise_for(r, self.name)
        sms = (r.json().get("SMSMessage") or {})
        return SendResult(status="sent", provider=self.name, provider_id=sms.get("Sid"))


class WhatsAppCloudProvider:
    """Meta WhatsApp Cloud API. Business-initiated messages must use an approved template."""

    name = "whatsapp"

    def __init__(self, transport: httpx.BaseTransport | None = None):
        s = get_settings()
        self.phone_id, self.token, self.version = s.whatsapp_phone_number_id, s.whatsapp_token, s.whatsapp_api_version
        self.http = httpx.Client(timeout=15, transport=transport)

    def send(self, m: OutboundMessage) -> SendResult:
        r = self.http.post(
            f"https://graph.facebook.com/{self.version}/{self.phone_id}/messages",
            headers={"Authorization": f"Bearer {self.token}"},
            json={
                "messaging_product": "whatsapp",
                "to": m.to.lstrip("+"),
                "type": "template",
                "template": {
                    "name": m.whatsapp_template or m.template,
                    "language": {"code": {"en": "en", "hi": "hi", "bn": "bn"}.get(m.lang, "en")},
                    "components": [{"type": "body", "parameters": [{"type": "text", "text": p} for p in (m.params or [])]}],
                },
            },
        )
        _raise_for(r, self.name)
        ids = r.json().get("messages") or [{}]
        return SendResult(status="sent", provider=self.name, provider_id=ids[0].get("id"))


def sms_provider(transport: httpx.BaseTransport | None = None):
    name = get_settings().sms_provider
    if name == "twilio":
        return TwilioSmsProvider(transport)
    if name == "exotel":
        return ExotelSmsProvider(transport)
    return ConsoleProvider()


def whatsapp_provider(transport: httpx.BaseTransport | None = None):
    return WhatsAppCloudProvider(transport) if get_settings().whatsapp_enabled else ConsoleProvider()

