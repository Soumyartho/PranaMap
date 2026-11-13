from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
_is_sqlite = settings.database_url.startswith("sqlite")
engine = create_engine(
    settings.database_url,
    # 15 s busy timeout: the escalation worker and API requests share one SQLite file.
    connect_args={"check_same_thread": False, "timeout": 15} if _is_sqlite else {},
)

if _is_sqlite:

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(conn, _):  # noqa: ANN001
        # Let SQLAlchemy own transactions so SAVEPOINTs work (pysqlite recipe from the SQLAlchemy docs).
        conn.isolation_level = None
        cur = conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA journal_mode=WAL")
        cur.close()

    @event.listens_for(engine, "begin")
    def _sqlite_begin(conn):  # noqa: ANN001
        # IMMEDIATE: take the write lock when the transaction starts. With deferred BEGIN, a request
        # that reads, then writes after the worker has committed, fails at once with "database is
        # locked" (a stale WAL snapshot cannot be upgraded). Serialising writers avoids that race.
        conn.exec_driver_sql("BEGIN IMMEDIATE")


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from app import models  # noqa: F401  (registers tables)

    Base.metadata.create_all(engine)
