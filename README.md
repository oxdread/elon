# Polymarket BTC 5m Backtest & Journal

Backtestingg + journaling stack for Polymarket's 5-minute BTC up/down markets.

## Structure
```
collector/   Python — polls Polymarket every 5s, writes snapshots to SQLite
backtest/    Python — replays snapshots through strategies
web/         Next.js — journal UI (reads SQLite directly via better-sqlite3)
data/        SQLite db lives here
```

## Setup
```bash
# Python side
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m collector.init_db
python -m collector.fetcher    # starts 5s polling loop

# Web side
cd web && npm install && npm run dev
```

## Identifying the current 5m market
The collector hits Polymarket's Gamma API (`https://gamma-api.polymarket.com/events`)
filtering by the `btc-updown-5m` series and `closed=false`, picks the event whose
`endDate` is nearest in the future. Slug pattern: `btc-updown-5m-<unix-ts>`.
