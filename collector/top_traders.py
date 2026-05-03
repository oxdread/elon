"""Poll top trader wallets for recent trades every 10 seconds.

Reads tracked wallets from DB (tracked_wallets table).
Saves trades to top_trader_trades table. Runs as daemon thread.
"""
from __future__ import annotations

import json
import re
import time
import threading
from typing import Optional

import httpx
import psycopg2

# Fallback hardcoded wallets (used if DB table is empty)
DEFAULT_TRADERS = [
    {"name": "gustav4", "address": "0x471abf0558dcd381dcea2fdf54390760c9a30328"},
    {"name": "prexpect", "address": "0xa59c570a9eca148da55f6e1f47a538c0c600bb62"},
]

POLL_INTERVAL = 30
_db_url: Optional[str] = None
_started = False


def set_db_url(url: str) -> None:
    global _db_url
    _db_url = url


def start() -> None:
    global _started
    if _started:
        return
    _started = True
    t = threading.Thread(target=_loop, name="top-traders", daemon=True)
    t.start()


def _get_conn():
    conn = psycopg2.connect(_db_url)
    conn.autocommit = True
    return conn


def _get_wallets(conn) -> list[dict]:
    """Read tracked wallets from DB."""
    try:
        cur = conn.cursor()
        cur.execute("SELECT address, name FROM tracked_wallets ORDER BY added_at")
        rows = cur.fetchall()
        cur.close()
        if rows:
            return [{"address": r[0], "name": r[1] or r[0][:8]} for r in rows]
    except Exception:
        pass
    return []


def _loop() -> None:
    client = httpx.Client(timeout=10, headers={"User-Agent": "Mozilla/5.0"})
    conn = _get_conn()
    last_ts: dict[str, int] = {}

    while True:
        try:
            wallets = _get_wallets(conn)

            for trader in wallets:
                try:
                    r = client.get(
                        "https://data-api.polymarket.com/activity",
                        params={"user": trader["address"], "limit": "50"},
                    )
                    if r.status_code != 200:
                        continue

                    trades = r.json()
                    if not isinstance(trades, list):
                        continue

                    new_count = 0
                    cur = conn.cursor()

                    for t in trades:
                        # Filter: only Elon tweet trades
                        title = t.get("title", "")
                        if "elon" not in title.lower() or "tweet" not in title.lower():
                            continue

                        trade_id = t.get("transactionHash") or t.get("id") or f"{trader['address']}-{t.get('timestamp', 0)}-{t.get('price', 0)}"
                        ts = int(t.get("timestamp") or 0)

                        # Extract bracket label from title (e.g. "Will Elon Musk post 120-139 tweets..." → "120-139")
                        bracket_match = re.search(r'post\s+([<>]?\d[\d\-]*)\s+tweet', title)
                        bracket_label = bracket_match.group(1) if bracket_match else ""
                        event_slug = t.get("eventSlug", "")

                        try:
                            cur.execute("""
                                INSERT INTO top_trader_trades (wallet_address, wallet_name, trade_id, side, size, price, outcome, market, timestamp, raw)
                                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                                ON CONFLICT (trade_id) DO NOTHING
                            """, (
                                trader["address"],
                                trader["name"],
                                str(trade_id),
                                t.get("side", ""),
                                float(t.get("size", 0)),
                                float(t.get("price", 0)),
                                t.get("outcome", ""),
                                bracket_label + "|" + event_slug,
                                ts,
                                json.dumps(t),
                            ))
                            if cur.rowcount > 0:
                                new_count += 1
                        except Exception:
                            pass

                    cur.close()

                    if trades:
                        max_ts = max(int(t.get("timestamp") or t.get("matchTime") or 0) for t in trades)
                        if max_ts > last_ts.get(trader["address"], 0):
                            last_ts[trader["address"]] = max_ts

                    if new_count > 0:
                        print(f"[top-traders] {new_count} new trades for {trader['name']}")

                except Exception as e:
                    print(f"[top-traders] error fetching {trader['name']}: {e}")

        except psycopg2.OperationalError:
            try:
                conn.close()
            except Exception:
                pass
            try:
                conn = _get_conn()
                print("[top-traders] reconnected to DB")
            except Exception as e:
                print(f"[top-traders] DB reconnect failed: {e}")

        except Exception as e:
            print(f"[top-traders] error: {e}")

        time.sleep(POLL_INTERVAL)
