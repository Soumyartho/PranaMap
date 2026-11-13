import uuid
from datetime import datetime
from typing import Annotated, Any

from sqlalchemy import JSON, DateTime, String
from sqlalchemy.orm import mapped_column

from app.core.clock import now


def new_id() -> str:
    return str(uuid.uuid4())


PK = Annotated[str, mapped_column(String(36), primary_key=True, default=new_id)]
Created = Annotated[datetime, mapped_column(DateTime, default=now)]
Json = Annotated[Any, mapped_column(JSON)]
