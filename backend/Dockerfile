# PranaMap API. Build from the repository root (the engine reads ../shared):
#   docker build -f backend/Dockerfile -t pranamap-api .
FROM python:3.13-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONIOENCODING=utf-8 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_CACHE_DIR=1
WORKDIR /srv/backend
COPY backend/requirements.txt .
RUN pip install -r requirements.txt

COPY shared /srv/shared
COPY backend/app ./app
COPY backend/scripts ./scripts
COPY backend/pyproject.toml ./
COPY deploy/api-entrypoint.sh /usr/local/bin/api-entrypoint
RUN chmod +x /usr/local/bin/api-entrypoint \
 && useradd --system --uid 10001 --home /srv pranamap \
 && mkdir -p /data && chown pranamap /data
USER pranamap

# SQLite and voice notes live on a volume; point PRANAMAP_DATABASE_URL at Postgres for anything shared.
ENV PRANAMAP_DATABASE_URL=sqlite:////data/pranamap.db \
    PRANAMAP_MEDIA_DIR=/data/media
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=60s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2)"
ENTRYPOINT ["api-entrypoint"]
