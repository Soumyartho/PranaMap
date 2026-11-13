#!/bin/sh
# Seed the synthetic demo block on first start (empty volume), then serve.
set -e
db="${PRANAMAP_DATABASE_URL#sqlite:///}"
if [ "${PRANAMAP_DEMO_MODE:-true}" = "true" ] && [ "$db" != "$PRANAMAP_DATABASE_URL" ] && [ ! -s "$db" ]; then
  echo "First start: seeding the synthetic block into $db"
  python -m scripts.seed_synthetic
fi
exec python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'
