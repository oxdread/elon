#!/usr/bin/env bash
# Run as ubuntu on VPS: sudo bash /home/backtest/app/deploy/check-real-db.sh
sudo -u backtest /home/backtest/app/.venv/bin/python3 - <<'EOF'
import sqlite3, os

p = "/home/backtest/app/data/backtest-real.db"
if not os.path.exists(p):
    print("backtest-real.db does not exist yet — no real trades placed")
else:
    conn = sqlite3.connect(p)
    conn.row_factory = sqlite3.Row
    print("=== real trades ===")
    rows = conn.execute("SELECT * FROM trades ORDER BY id DESC LIMIT 10").fetchall()
    if not rows:
        print("no real trades yet")
    for r in rows:
        print(dict(r))
EOF
