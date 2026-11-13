"""Messaging: provider request formats, template integrity, retry classification."""

import json
from urllib.parse import parse_qs

import httpx
import pytest

from app.core.config import get_settings
from app.integrations.messaging.providers import (
    ExotelSmsProvider,
    OutboundMessage,
    ProviderError,
    TwilioSmsProvider,
    WhatsAppCloudProvider,
)
from app.integrations.messaging.templates import TEMPLATES, render
from app.services.notifications import e164

MSG = OutboundMessage(
    to="+919876543210", body="PranaMap: hello", channel="sms", template="missed_visit",
    dlt_template_id="1107000000000000001", whatsapp_template="pranamap_missed_visit", lang="hi",
    params=["Kadamtala PHC", "Rina"],
)


def configure(monkeypatch, **values):
    s = get_settings()
    for k, v in values.items():
        monkeypatch.setattr(s, k, v)


def test_every_template_fills_every_slot_in_every_language():
    for name, spec in TEMPLATES.items():
        values = {v: f"<{v}>" for v in spec["vars"]}
        for lang in ("en", "hi", "bn"):
            text, params = render(name, lang, values)
            assert "{#var#}" not in text
            assert all(f"<{v}>" in text for v in spec["vars"])
            assert params == [values[v] for v in spec["vars"]]


def test_phone_normalisation():
    assert e164("98765 43210") == "+919876543210"
    assert e164("+91 98765-43210") == "+919876543210"
    assert e164("12345") is None and e164("0123456789") is None and e164(None) is None


def test_twilio_request(monkeypatch):
    configure(monkeypatch, twilio_account_sid="AC1", twilio_auth_token="tok", twilio_from="+15550001111")
    seen = {}

    def handler(req: httpx.Request):
        seen.update(url=str(req.url), auth=req.headers["authorization"], form=parse_qs(req.content.decode()))
        return httpx.Response(201, json={"sid": "SM123"})

    r = TwilioSmsProvider(httpx.MockTransport(handler)).send(MSG)
    assert r.status == "sent" and r.provider_id == "SM123"
    assert seen["url"].endswith("/Accounts/AC1/Messages.json") and seen["auth"].startswith("Basic ")
    assert seen["form"]["To"] == ["+919876543210"] and seen["form"]["Body"] == ["PranaMap: hello"]


def test_exotel_sends_dlt_ids(monkeypatch):
    configure(monkeypatch, exotel_sid="acme", exotel_api_key="k", exotel_api_token="t", exotel_sender_id="PRANAM", dlt_entity_id="1101")
    seen = {}

    def handler(req):
        seen["form"] = parse_qs(req.content.decode())
        return httpx.Response(200, json={"SMSMessage": {"Sid": "ex1"}})

    assert ExotelSmsProvider(httpx.MockTransport(handler)).send(MSG).provider_id == "ex1"
    assert seen["form"]["DltEntityId"] == ["1101"] and seen["form"]["DltTemplateId"] == ["1107000000000000001"]


def test_whatsapp_uses_the_approved_template(monkeypatch):
    configure(monkeypatch, whatsapp_phone_number_id="555", whatsapp_token="wa-token")
    seen = {}

    def handler(req):
        seen.update(url=str(req.url), auth=req.headers["authorization"], body=json.loads(req.content))
        return httpx.Response(200, json={"messages": [{"id": "wamid.1"}]})

    WhatsAppCloudProvider(httpx.MockTransport(handler)).send(MSG)
    t = seen["body"]["template"]
    assert seen["url"].endswith("/555/messages") and seen["auth"] == "Bearer wa-token"
    assert seen["body"]["to"] == "919876543210" and t["name"] == "pranamap_missed_visit" and t["language"]["code"] == "hi"
    assert [p["text"] for p in t["components"][0]["parameters"]] == ["Kadamtala PHC", "Rina"]


def test_client_errors_are_final_server_errors_retry(monkeypatch):
    configure(monkeypatch, twilio_account_sid="AC1")
    with pytest.raises(ProviderError) as e:
        TwilioSmsProvider(httpx.MockTransport(lambda r: httpx.Response(400, text="bad number"))).send(MSG)
    assert e.value.retryable is False
    with pytest.raises(ProviderError) as e:
        TwilioSmsProvider(httpx.MockTransport(lambda r: httpx.Response(503))).send(MSG)
    assert e.value.retryable is True
