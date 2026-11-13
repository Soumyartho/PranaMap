"""Bhashini (MeitY ULCA) speech recognition.

Two-step flow from the Bhashini pipeline documentation:
1. POST the pipeline config endpoint with userID + ulcaApiKey and the task (asr, source language)
   -> inference endpoint URL, an inference API key, and the serviceId for that language.
2. POST the inference endpoint with that key, the serviceId and base64 audio -> transcript.

Step 1 results are cached per language for an hour. Raw audio is never stored; it is passed
through and dropped (blueprint: keep audio only until transcription).
Credentials come from settings; without them `available()` is False and the phone falls back
to its on-device model or the browser recogniser.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import httpx

from app.core.config import get_settings


class BhashiniError(Exception):
    pass


@dataclass
class _Pipeline:
    callback_url: str
    key_name: str
    key_value: str
    service_id: str
    fetched_at: float


class BhashiniClient:
    TTL_SECONDS = 3600

    def __init__(self, transport: httpx.BaseTransport | None = None):
        s = get_settings()
        self.user_id = s.bhashini_user_id
        self.api_key = s.bhashini_api_key
        self.pipeline_id = s.bhashini_pipeline_id
        self.config_url = s.bhashini_config_url
        self._http = httpx.Client(timeout=s.bhashini_timeout_seconds, transport=transport)
        self._pipelines: dict[str, _Pipeline] = {}

    def available(self) -> bool:
        return bool(self.user_id and self.api_key)

    def _pipeline(self, lang: str) -> _Pipeline:
        cached = self._pipelines.get(lang)
        if cached and time.monotonic() - cached.fetched_at < self.TTL_SECONDS:
            return cached
        r = self._http.post(
            self.config_url,
            headers={"userID": self.user_id, "ulcaApiKey": self.api_key, "Content-Type": "application/json"},
            json={
                "pipelineTasks": [{"taskType": "asr", "config": {"language": {"sourceLanguage": lang}}}],
                "pipelineRequestConfig": {"pipelineId": self.pipeline_id},
            },
        )
        if r.status_code != 200:
            raise BhashiniError(f"pipeline config failed ({r.status_code})")
        body = r.json()
        try:
            endpoint = body["pipelineInferenceAPIEndPoint"]
            service_id = body["pipelineResponseConfig"][0]["config"][0]["serviceId"]
            p = _Pipeline(
                callback_url=endpoint["callbackUrl"],
                key_name=endpoint["inferenceApiKey"]["name"],
                key_value=endpoint["inferenceApiKey"]["value"],
                service_id=service_id,
                fetched_at=time.monotonic(),
            )
        except (KeyError, IndexError, TypeError) as exc:
            raise BhashiniError("unexpected pipeline config response") from exc
        self._pipelines[lang] = p
        return p

    def transcribe(self, lang: str, wav_base64: str, sample_rate: int = 16000) -> str:
        if not self.available():
            raise BhashiniError("not configured")
        p = self._pipeline(lang)
        r = self._http.post(
            p.callback_url,
            headers={p.key_name: p.key_value, "Content-Type": "application/json"},
            json={
                "pipelineTasks": [{
                    "taskType": "asr",
                    "config": {"language": {"sourceLanguage": lang}, "serviceId": p.service_id,
                               "audioFormat": "wav", "samplingRate": sample_rate},
                }],
                "inputData": {"audio": [{"audioContent": wav_base64}]},
            },
        )
        if r.status_code == 401:
            self._pipelines.pop(lang, None)  # stale inference key: refetch next time
        if r.status_code != 200:
            raise BhashiniError(f"transcription failed ({r.status_code})")
        try:
            return r.json()["pipelineResponse"][0]["output"][0]["source"].strip()
        except (KeyError, IndexError, TypeError) as exc:
            raise BhashiniError("unexpected transcription response") from exc


_client: BhashiniClient | None = None


def client() -> BhashiniClient:
    global _client
    if _client is None:
        _client = BhashiniClient()
    return _client
