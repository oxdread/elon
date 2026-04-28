#!/usr/bin/env bash
# Runs on the VPS as the `backtest` user from /home/backtest/app.
# Triggered by GitHub Actions on every push to main.
set -euo pipefail

cd /home/backtest/app

echo "[deploy] stopping services..."
sudo systemctl stop backtest-fetcher
sudo systemctl stop backtest-web

echo "[deploy] pulling latest..."
git fetch --all
git reset --hard origin/main

echo "[deploy] python deps..."
./.venv/bin/pip install --quiet -r requirements.txt

echo "[deploy] db migrations..."
./.venv/bin/python3 -c "
from collector.db import init_db
init_db()
print('  schema applied')
"

echo "[deploy] web deps + build..."
cd web
npm ci
npm run build
cd ..

echo "[deploy] starting services..."
sudo systemctl start backtest-fetcher
sudo systemctl start backtest-web

echo "[deploy] ok @ $(date -Is)"
