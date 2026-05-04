import os
import time
from contextlib import contextmanager

import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:vgXLSOsUNmvA1O7Z@db.smatbeowzfqsvxdkynjw.supabase.co:5432/postgres",
)


def connect():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    return conn


def init_db(conn) -> None:
    """Create tables that may not exist yet."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS wallet_cache (
                funder TEXT PRIMARY KEY,
                balance TEXT DEFAULT '0',
                portfolio_value NUMERIC DEFAULT 0,
                positions JSONB DEFAULT '[]',
                open_orders JSONB DEFAULT '[]',
                updated_at INT DEFAULT 0
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_config (
                id INT PRIMARY KEY DEFAULT 1,
                funder TEXT,
                private_key TEXT,
                api_key TEXT,
                api_secret TEXT,
                api_passphrase TEXT,
                updated_at INT DEFAULT 0
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS trade_log (
                id SERIAL PRIMARY KEY,
                ts INT,
                side TEXT,
                order_type TEXT,
                token_id TEXT,
                price NUMERIC,
                size NUMERIC,
                status TEXT,
                error TEXT,
                ms_total INT,
                ms_creds_read INT,
                ms_python_start INT,
                ms_order_post INT,
                ms_cache_invalidate INT,
                ms_client_to_server INT,
                ms_ws_confirm INT
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS top_trader_trades (
                id SERIAL PRIMARY KEY,
                wallet_address TEXT,
                wallet_name TEXT,
                trade_id TEXT UNIQUE,
                side TEXT,
                size NUMERIC,
                price NUMERIC,
                outcome TEXT,
                market TEXT,
                timestamp INT,
                raw JSONB
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS tracked_wallets (
                id SERIAL PRIMARY KEY,
                address TEXT UNIQUE,
                name TEXT,
                profile_image TEXT,
                added_at INT DEFAULT 0
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS elon_flights (
                id SERIAL PRIMARY KEY,
                icao24 TEXT,
                callsign TEXT,
                on_ground BOOLEAN,
                latitude NUMERIC,
                longitude NUMERIC,
                altitude NUMERIC,
                velocity NUMERIC,
                heading NUMERIC,
                origin TEXT,
                ts INT,
                raw JSONB
            )
        """)
    conn.commit()


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

def upsert_event(conn, ev: dict) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO events (id, slug, title, start_date, end_date, active, discovered_at)
            VALUES (%(id)s, %(slug)s, %(title)s, %(start_date)s, %(end_date)s, %(active)s, %(discovered_at)s)
            ON CONFLICT (id) DO UPDATE SET
                title = COALESCE(EXCLUDED.title, events.title),
                start_date = COALESCE(EXCLUDED.start_date, events.start_date),
                end_date = COALESCE(EXCLUDED.end_date, events.end_date),
                active = EXCLUDED.active
            """,
            {**ev, "active": bool(ev.get("active", True)), "discovered_at": ev.get("discovered_at", int(time.time()))},
        )


def get_active_events(conn) -> list:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT * FROM events WHERE active = TRUE ORDER BY slug")
        return cur.fetchall()


def deactivate_missing_events(conn, active_ids: list[str]) -> None:
    with conn.cursor() as cur:
        if not active_ids:
            cur.execute("UPDATE events SET active = FALSE")
            return
        cur.execute(
            "UPDATE events SET active = FALSE WHERE id != ALL(%s)",
            (active_ids,),
        )


# ---------------------------------------------------------------------------
# Brackets
# ---------------------------------------------------------------------------

def upsert_bracket(conn, b: dict) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO brackets (id, event_id, label, lower_bound, upper_bound,
                                  yes_token_id, no_token_id, question, discovered_at)
            VALUES (%(id)s, %(event_id)s, %(label)s, %(lower_bound)s, %(upper_bound)s,
                    %(yes_token_id)s, %(no_token_id)s, %(question)s, %(discovered_at)s)
            ON CONFLICT (id) DO UPDATE SET
                yes_token_id = COALESCE(EXCLUDED.yes_token_id, brackets.yes_token_id),
                no_token_id  = COALESCE(EXCLUDED.no_token_id,  brackets.no_token_id),
                question     = COALESCE(EXCLUDED.question,     brackets.question)
            """,
            {**b, "discovered_at": b.get("discovered_at", int(time.time()))},
        )


def get_brackets(conn, event_id: str = None) -> list:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        if event_id:
            cur.execute("SELECT * FROM brackets WHERE event_id = %s ORDER BY lower_bound", (event_id,))
        else:
            cur.execute("SELECT * FROM brackets ORDER BY event_id, lower_bound")
        return cur.fetchall()


# ---------------------------------------------------------------------------
# Price snapshots
# ---------------------------------------------------------------------------

def insert_price_snapshots(conn, snapshots: list[dict]) -> None:
    if not snapshots:
        return
    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(
            cur,
            """
            INSERT INTO price_snapshots (bracket_id, ts, mid, bid, ask, trigger, tweet_id)
            VALUES (%(bracket_id)s, %(ts)s, %(mid)s, %(bid)s, %(ask)s, %(trigger)s, %(tweet_id)s)
            """,
            snapshots,
        )


# ---------------------------------------------------------------------------
# Tweets
# ---------------------------------------------------------------------------

def insert_tweet(conn, tweet: dict) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO tweets (id, ts, text, author_id, raw_json, created_at)
            VALUES (%(id)s, %(ts)s, %(text)s, %(author_id)s, %(raw_json)s, %(created_at)s)
            ON CONFLICT (id) DO NOTHING
            """,
            {**tweet, "created_at": tweet.get("created_at", int(time.time()))},
        )


def upsert_tweet_count(conn, event_id: str, count: int, source: str = "polymarket") -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO tweet_counts (event_id, count, source, last_updated)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (event_id) DO UPDATE SET
                count = EXCLUDED.count,
                source = EXCLUDED.source,
                last_updated = EXCLUDED.last_updated
            """,
            (event_id, count, source, int(time.time())),
        )


def increment_tweet_counts(conn) -> dict[str, int]:
    now = int(time.time())
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            UPDATE tweet_counts SET count = count + 1, source = 'stream', last_updated = %s
            WHERE event_id IN (SELECT id FROM events WHERE active = TRUE)
            """,
            (now,),
        )
        cur.execute(
            "SELECT event_id, count FROM tweet_counts WHERE event_id IN (SELECT id FROM events WHERE active = TRUE)"
        )
        return {r["event_id"]: r["count"] for r in cur.fetchall()}


def get_tweet_counts(conn) -> dict[str, int]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT event_id, count FROM tweet_counts")
        return {r["event_id"]: r["count"] for r in cur.fetchall()}


# ---------------------------------------------------------------------------
# Collector status
# ---------------------------------------------------------------------------

def upsert_status(conn, s: dict) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO collector_status (id, ts, ws_connected, twitter_connected,
                                          brackets_count, events_count, last_poll_ts, last_tweet_ts, error)
            VALUES (1, %(ts)s, %(ws_connected)s, %(twitter_connected)s,
                    %(brackets_count)s, %(events_count)s, %(last_poll_ts)s, %(last_tweet_ts)s, %(error)s)
            ON CONFLICT (id) DO UPDATE SET
                ts = EXCLUDED.ts,
                ws_connected = EXCLUDED.ws_connected,
                twitter_connected = EXCLUDED.twitter_connected,
                brackets_count = EXCLUDED.brackets_count,
                events_count = EXCLUDED.events_count,
                last_poll_ts = EXCLUDED.last_poll_ts,
                last_tweet_ts = EXCLUDED.last_tweet_ts,
                error = EXCLUDED.error
            """,
            {**s, "ws_connected": bool(s.get("ws_connected")), "twitter_connected": bool(s.get("twitter_connected"))},
        )
