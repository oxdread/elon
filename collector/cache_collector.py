"""Pre-fetch shared market data and cache in Postgres.

Runs alongside the main fetcher. Collects:
- Comments (latest 100) — every 60s

Orderbooks and trades are now handled by clob_feed.py via WebSocket.
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
        args=(conn_url,),
        name="cache-collector",
        daemon=True,
    )
    t.start()


def _get_conn(conn_url: str):
    conn = psycopg2.connect(conn_url)
    conn.autocommit = True
    return conn


def _cache_loop(conn_url: str) -> None:
    """Main cache loop — comments every 60s."""
    client = httpx.Client(timeout=10)
    conn = _get_conn(conn_url)

    while True:
        try:
            _update_comments(conn, client)
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

        time.sleep(60)


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
