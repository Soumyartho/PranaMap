"""Bhashini adapter against a mocked ULCA API (no network, no credentials needed)."""

import json

import httpx
import pytest

from app.core.config import get_settings
from app.integrations.bhashini.client import BhashiniClient, BhashiniError

CALLBACK = "https://dhruva-api.example/services/inference/pipeline"


def make_client(handler, monkeypatch, configured=True):
    s = get_settings()
    monkeypatch.setattr(s, "bhashini_user_id", "user-1" if configured else "")
    monkeypatch.setattr(s, "bhashini_api_key", "ulca-key" if configured else "")
    return BhashiniClient(transport=httpx.MockTransport(handler))


def ulca(calls):
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        calls.append((str(request.url), dict(request.headers), body))
        if "getModelsPipeline" in str(request.url):
            assert request.headers["userID"] == "user-1" and request.headers["ulcaApiKey"] == "ulca-key"
            lang = body["pipelineTasks"][0]["config"]["language"]["sourceLanguage"]
            return httpx.Response(200, json={
                "pipelineInferenceAPIEndPoint": {"callbackUrl": CALLBACK, "inferenceApiKey": {"name": "Authorization", "value": "inf-key"}},
                "pipelineResponseConfig": [{"config": [{"serviceId": f"asr-{lang}"}]}],
            })
        assert request.headers["Authorization"] == "inf-key"
        task = body["pipelineTasks"][0]["config"]
        assert task["serviceId"] == "asr-hi" and task["audioFormat"] == "wav" and task["samplingRate"] == 16000
        assert body["inputData"]["audio"][0]["audioContent"] == "UklGRg=="
        return httpx.Response(200, json={"pipelineResponse": [{"output": [{"source": " एक सौ पचास बटा पचानवे "}]}]})
    return handler


def test_two_step_flow_and_config_cache(monkeypatch):
    calls = []
    c = make_client(ulca(calls), monkeypatch)
    assert c.transcribe("hi", "UklGRg==") == "एक सौ पचास बटा पचानवे"
    assert c.transcribe("hi", "UklGRg==") == "एक सौ पचास बटा पचानवे"
    assert sum("getModelsPipeline" in u for u, _, _ in calls) == 1  # pipeline config fetched once


def test_unconfigured_is_unavailable(monkeypatch):
    c = make_client(ulca([]), monkeypatch, configured=False)
    assert c.available() is False
    with pytest.raises(BhashiniError):
        c.transcribe("hi", "UklGRg==")


def test_stale_inference_key_is_dropped(monkeypatch):
    state = {"n": 0}

    def handler(request):
        if "getModelsPipeline" in str(request.url):
            state["n"] += 1
            return httpx.Response(200, json={
                "pipelineInferenceAPIEndPoint": {"callbackUrl": CALLBACK, "inferenceApiKey": {"name": "Authorization", "value": "k"}},
                "pipelineResponseConfig": [{"config": [{"serviceId": "s"}]}],
            })
        return httpx.Response(401)

    c = make_client(handler, monkeypatch)
    for _ in range(2):
        with pytest.raises(BhashiniError):
            c.transcribe("bn", "UklGRg==")
    assert state["n"] == 2  # the 401 forced a fresh pipeline config
