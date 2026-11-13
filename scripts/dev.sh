#!/usr/bin/env sh
# Start PranaMap for development in one command: API on :8000, web app on :5173.
#
#   scripts/dev.sh            first run creates backend/.venv, installs dependencies, seeds the synthetic block
#   scripts/dev.sh --reseed   rebuild the synthetic database (drops all local data)
#   scripts/dev.sh --phone    serve the web app on the LAN over HTTPS (docs/PHONE_TESTING.md)
#
# Later runs only reinstall when requirements.txt or package-lock.json changed. Ctrl+C stops both servers.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
backend="$root/backend"
frontend="$root/frontend"
reseed=0
phone=0
for arg in "$@"; do
  case "$arg" in
    --reseed) reseed=1 ;;
    --phone) phone=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[31m> %s\033[0m\n' "$1"; }
stale() { [ ! -e "$1" ] || [ "$2" -nt "$1" ]; }

python="$backend/.venv/bin/python"
[ -x "$python" ] || python="$backend/.venv/Scripts/python.exe" # Git Bash on Windows
if [ ! -x "$python" ]; then
  step "Creating backend/.venv"
  python3 -m venv "$backend/.venv"
  python="$backend/.venv/bin/python"
fi
if stale "$backend/.venv/.installed" "$backend/requirements.txt"; then
  step "Installing Python dependencies"
  "$python" -m pip install --disable-pip-version-check -q -r "$backend/requirements.txt"
  touch "$backend/.venv/.installed"
fi
if [ "$reseed" = 1 ] || [ ! -e "$backend/pranamap.db" ]; then
  step "Seeding the synthetic block"
  (cd "$backend" && PYTHONIOENCODING=utf-8 "$python" -m scripts.seed_synthetic)
fi
if stale "$frontend/node_modules/.package-lock.json" "$frontend/package-lock.json"; then
  step "Installing Node dependencies"
  (cd "$frontend" && npm install --no-audit --no-fund)
fi

step "API on http://localhost:8000 (docs at /docs)"
(cd "$backend" && exec "$python" -m uvicorn app.main:app --port 8000 --reload) &
api=$!
trap 'kill $api 2>/dev/null; wait $api 2>/dev/null' EXIT INT TERM

step "Web app (Ctrl+C stops both)"
cd "$frontend"
if [ "$phone" = 1 ]; then npm run dev:phone; else npm run dev; fi
