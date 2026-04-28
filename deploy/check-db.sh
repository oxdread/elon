#!/usr/bin/env bash
# Run as ubuntu on VPS: sudo bash /home/backtest/app/deploy/check-db.sh
sudo -u backtest /home/backtest/app/.venv/bin/python3 - <<'EOF'
import sqlite3
conn = sqlite3.connect("/home/backtest/app/data/backtest.db")
conn.row_factory = sqlite3.Row

print("=== settings ===")
for r in conn.execute("SELECT * FROM settings").fetchall():
    print(dict(r))

print("=== trade count ===")
r = conn.execute("SELECT COUNT(*) as n FROM trades WHERE is_live=1").fetchone()
print(f"live trades: {r['n']}")

print("=== last 3 trades ===")
for r in conn.execute("SELECT id, side, entry_price, exit_ts, pnl FROM trades WHERE is_live=1 ORDER BY id DESC LIMIT 3").fetchall():
    print(dict(r))
EOF
