from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_prefix="PRANAMAP_", extra="ignore")

    # SQLite needs no setup; set PRANAMAP_DATABASE_URL=postgresql+psycopg://... for Postgres.
    database_url: str = f"sqlite:///{(BACKEND_DIR / 'pranamap.db').as_posix()}"
    jwt_secret: str = "dev-only-change-me-before-any-real-deployment"
    jwt_ttl_minutes: int = 12 * 60
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:5174", "http://127.0.0.1:5173"]

    # Facility hours are local (IST); timestamps are stored in UTC.
    local_utc_offset_minutes: int = 330
    escalation_interval_seconds: int = 30
    # Teleconsult when the nearest capable facility is further than this.
    max_travel_minutes: int = 60
    # Loop-closure window for the north-star metric.
    loop_window_days: int = 14
    # Hide map cells with fewer people than this (small-count privacy).
    min_cell_count: int = 5
    jitsi_base_url: str = "https://meet.jit.si"
    # Bhashini speech (register at bhashini.gov.in). Empty = not configured; phones use other engines.
    bhashini_user_id: str = ""
    bhashini_api_key: str = ""
    bhashini_pipeline_id: str = "64392f96daac500b55c543cd"  # MeitY default pipeline
    bhashini_config_url: str = "https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline"
    bhashini_timeout_seconds: float = 15.0
    # Messaging. "console" records messages as simulated and sends nothing.
    sms_provider: str = "console"  # console | twilio | exotel
    whatsapp_enabled: bool = False
    patient_channel: str = "sms"  # sms | whatsapp
    reminder_hours_before: int = 24
    dlt_entity_id: str = ""
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from: str = ""
    exotel_sid: str = ""
    exotel_api_key: str = ""
    exotel_api_token: str = ""
    exotel_subdomain: str = "api.exotel.com"
    exotel_sender_id: str = ""
    whatsapp_phone_number_id: str = ""
    whatsapp_token: str = ""
    whatsapp_api_version: str = "v21.0"
    # ABDM (sandbox credentials from sandbox.abdm.gov.in). Empty = mock ABHA checks only.
    abdm_gateway_url: str = "https://dev.abdm.gov.in/gateway"
    abdm_client_id: str = ""
    abdm_client_secret: str = ""
    # Voice notes for the doctor. Kept for this many days, then deleted (audio is identifiable).
    media_dir: str = str(BACKEND_DIR / "data" / "media")
    media_retention_days: int = 60
    media_max_bytes: int = 600_000
    # Demo controls (fast-forward clock, reset). Off in production.
    demo_mode: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
