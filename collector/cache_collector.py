"""Pre-fetch shared market data and cache in Supabase.

Runs alongside the main fetcher. Collects:
- Order books (per bracket, overwrite every 15s)
- Public trades (per bracket, latest 50)
- Comments (latest 100)
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
    """Main cache loop — cycles through all data types."""
    client = httpx.Client(timeout=10)
    conn = _get_conn(conn_url)

    cycle = 0
    while True:
        try:
            # Every cycle (~15s): update orderbooks for active brackets
            _update_orderbooks(conn, client, brackets)

            # Every 2nd cycle (~30s): update public trades
            if cycle % 2 == 0:
                _update_public_trades(conn, client, brackets)

            # Every 4th cycle (~60s): update comments
            if cycle % 4 == 0:
                _update_comments(conn, client)

            cycle += 1

        except psycopg2.OperationalError:
            # Reconnect on connection drop
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


def _update_orderbooks(conn, client: httpx.Client, brackets: list[dict]) -> None:
    """Fetch and cache order books for all brackets with token IDs."""
    now = int(time.time())
    cur = conn.cursor()
    count = 0

    for b in brackets:
        tid = b.get("yes_token_id")
        if not tid:
            continue

        try:
            r = client.get(f"https://clob.polymarket.com/book", params={"token_id": tid})
            if r.status_code != 200:
                continue

            book = r.json()
            bids = book.get("bids") or []
            asks = book.get("asks") or []

            # Sort and limit to top 30 levels
            bids_sorted = sorted(bids, key=lambda x: -float(x["price"]))[:30]
            asks_sorted = sorted(asks, key=lambda x: float(x["price"]))[:30]

            best_bid = float(bids_sorted[0]["price"]) if bids_sorted else None
            best_ask = float(asks_sorted[0]["price"]) if asks_sorted else None
            spread = (best_ask - best_bid) if (best_bid is not None and best_ask is not None) else None

            cur.execute("""
                INSERT INTO orderbook_cache (bracket_id, token_id, bids, asks, best_bid, best_ask, spread, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (bracket_id) DO UPDATE SET
                    bids = EXCLUDED.bids, asks = EXCLUDED.asks,
                    best_bid = EXCLUDED.best_bid, best_ask = EXCLUDED.best_ask,
                    spread = EXCLUDED.spread, updated_at = EXCLUDED.updated_at
            """, (b["id"], tid, json.dumps(bids_sorted), json.dumps(asks_sorted),
                  best_bid, best_ask, spread, now))
            count += 1

        except Exception:
            continue

    if count > 0:
        print(f"[cache] orderbooks: {count} updated")


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
