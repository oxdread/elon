"""Pre-fetch shared market data and cache in Postgres.

Runs alongside the main fetcher. Collects:
- Public trades (per bracket, latest 30) — every 15s
- Comments (latest 100) — every 60s

Orderbooks are now handled by clob_feed.py via WebSocket.
"""
from __future__ import annotations

import json
import time
import threading

import httpx
import psycopg2
import psycopg2.extras


def start_cache_collector(conn_url: str, brackets: list[dict]) -> None:
    """Start the cache collector in a daemon thread."""
    t = threading.Thread(
        target=_cache_loop,
        args=(conn_url, brackets),
        name="cache-collector",
        daemon=True,
    )
    t.start()


def _get_conn(conn_url: str):
    conn = psycopg2.connect(conn_url)
    conn.autocommit = True
    return conn


def _cache_loop(conn_url: str, brackets: list[dict]) -> None:
    """Main cache loop — trades every 15s, comments every 60s."""
    client = httpx.Client(timeout=10)
    conn = _get_conn(conn_url)

    cycle = 0
    while True:
        try:
            # Every cycle (~15s): update public trades
            _update_public_trades(conn, client, brackets)

            # Every 4th cycle (~60s): update comments
            if cycle % 4 == 0:
                _update_comments(conn, client)

            cycle += 1

        except psycopg2.OperationalError:
            try:
                conn.close()
            except Exception:
                pass
            try:
                conn = _get_conn(conn_url)
                print("[cache] reconnected to DB")
            except Exception as e:
                print(f"[cache] DB reconnect failed: {e}")

        except Exception as e:
            print(f"[cache] error: {e}")

        time.sleep(15)


def _update_public_trades(conn, client: httpx.Client, brackets: list[dict]) -> None:
    """Fetch and cache public trades for all brackets."""
    now = int(time.time())
    cur = conn.cursor()
    count = 0

    for b in brackets:
        cid = b.get("id")
        if not cid:
            continue

        try:
            r = client.get("https://data-api.polymarket.com/trades",
                           params={"market": cid, "limit": "30"})
            if r.status_code != 200:
                continue

            trades = r.json()
            if not isinstance(trades, list):
                continue

            cur.execute("""
                INSERT INTO public_trades_cache (bracket_id, condition_id, trades, updated_at)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (bracket_id) DO UPDATE SET
                    trades = EXCLUDED.trades, updated_at = EXCLUDED.updated_at
            """, (cid, cid, json.dumps(trades), now))
            count += 1

        except Exception:
            continue

    if count > 0:
        print(f"[cache] trades: {count} brackets updated")


def _update_comments(conn, client: httpx.Client) -> None:
    """Fetch and cache latest comments."""
    now = int(time.time())
    cur = conn.cursor()

    try:
        r = client.get("https://gamma-api.polymarket.com/comments", params={
            "parent_entity_type": "Series",
            "parent_entity_id": "10000",
            "limit": "100",
            "order": "createdAt",
            "ascending": "false",
        })
        if r.status_code == 200:
            comments = r.json()
            if isinstance(comments, list):
                cur.execute("""
                    UPDATE comments_cache SET comments = %s, updated_at = %s WHERE id = 1
                """, (json.dumps(comments), now))
                print(f"[cache] comments: {len(comments)} cached")

    except Exception as e:
        print(f"[cache] comments error: {e}")
