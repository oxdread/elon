"""Elon Tweet Tracker — main collector process.

Two concurrent activities:
1. Main loop (every 60s): snapshot all bracket prices across all events
2. Twitter stream (callback): on each Elon tweet, immediately snapshot prices + record tweet

Tweet counts are per-event, seeded from Polymarket's tweetCount field on discovery,
then incremented via X API filtered stream (only main posts, quotes, retweets — no replies).
"""
from __future__ import annotations

import signal
import time
import threading

import httpx
from dotenv import load_dotenv

from collector import clob_feed, twitter_stream
from collector.cache_collector import start_cache_collector
from collector.db import (
    connect, init_db, upsert_event, upsert_bracket, get_brackets,
    insert_price_snapshots, insert_tweet, increment_tweet_counts,
    upsert_tweet_count, get_tweet_counts,
    upsert_status, deactivate_missing_events, get_active_events,
)
from collector.polymarket import discover_all

load_dotenv()

POLL_INTERVAL = 60.0
DISCOVERY_INTERVAL = 300.0

_running = True
_db_lock = threading.Lock()


def _ws_push(event_type: str, data: dict) -> None:
    """Push event to the WS relay server (fire and forget)."""
    import json
    import socket

    try:
        # Simple raw WebSocket handshake + send (no asyncio needed)
        import hashlib, base64, os as _os
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        sock.connect(("127.0.0.1", 3002))

        # WebSocket handshake
        key = base64.b64encode(_os.urandom(16)).decode()
        handshake = (
            "GET / HTTP/1.1\r\n"
            "Host: 127.0.0.1:3002\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "\r\n"
        )
        sock.sendall(handshake.encode())
        resp = sock.recv(1024)
        if b"101" not in resp:
            sock.close()
            return

        # Send WebSocket frame
        payload = json.dumps({"type": event_type, "data": data}).encode()
        frame = bytearray()
        frame.append(0x81)  # text frame, fin
        mask_key = _os.urandom(4)
        length = len(payload)
        if length < 126:
            frame.append(0x80 | length)  # masked
        elif length < 65536:
            frame.append(0x80 | 126)
            frame.extend(length.to_bytes(2, "big"))
        frame.extend(mask_key)
        frame.extend(bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload)))
        sock.sendall(frame)
        sock.close()
        print(f"[ws] pushed {event_type}")
    except Exception as e:
        pass  # WS relay might not be running


def _snapshot_prices(conn, brackets, trigger: str = "poll", tweet_id: str = None) -> int:
    ws_prices = clob_feed.latest_prices()
    now = int(time.time())
    snapshots = []
    for b in brackets:
        tid = b["yes_token_id"]
        if not tid:
            continue
        p = ws_prices.get(tid, {})
        snapshots.append({
            "bracket_id": b["id"],
            "ts": now,
            "mid": p.get("mid"),
            "bid": p.get("bid"),
            "ask": p.get("ask"),
            "trigger": trigger,
            "tweet_id": tweet_id,
        })

    if snapshots:
        with _db_lock:
            insert_price_snapshots(conn, snapshots)
            conn.commit()

    return len(snapshots)


def _handle_tweet(tweet: dict, conn) -> None:
    with _db_lock:
        insert_tweet(conn, tweet)
        counts = increment_tweet_counts(conn)
        conn.commit()

    brackets = _get_all_brackets(conn)
    n = _snapshot_prices(conn, brackets, trigger="tweet", tweet_id=tweet["id"])
    count_str = ", ".join(f"{eid[-4:]}={c}" for eid, c in counts.items())
    print(f"[tweet] recorded ({tweet.get('tweet_type', '?')}), {n} snapshots | counts: {count_str}")

    # Push to WS relay instantly
    _ws_push("tweet", {"id": tweet["id"], "ts": tweet["ts"], "text": tweet["text"]})


def _get_all_brackets(conn) -> list[dict]:
    with _db_lock:
        rows = get_brackets(conn)
    return [dict(r) for r in rows]


def _do_discovery(client, conn) -> tuple[list[dict], list[str]]:
    """Discover events + brackets, seed tweet counts, save to DB."""
    events, all_brackets = discover_all(client)

    with _db_lock:
        for ev in events:
            upsert_event(conn, ev)
            # Seed tweet count from Polymarket if available
            pm_count = ev.get("tweet_count")
            if pm_count is not None:
                upsert_tweet_count(conn, ev["id"], pm_count, source="polymarket")
        active_ids = [ev["id"] for ev in events]
        deactivate_missing_events(conn, active_ids)
        for b in all_brackets:
            upsert_bracket(conn, b)
        conn.commit()

    token_ids = [b["yes_token_id"] for b in all_brackets if b.get("yes_token_id")]

    print(f"[discovery] {len(events)} events, {len(all_brackets)} brackets, {len(token_ids)} tokens")
    for ev in events:
        tc = ev.get("tweet_count")
        print(f"  - {ev['slug']} (tweets: {tc if tc is not None else '?'})")

    return all_brackets, token_ids


def main():
    global _running

    signal.signal(signal.SIGTERM, lambda *_: _set_stop())
    signal.signal(signal.SIGINT, lambda *_: _set_stop())

    conn = connect()
    init_db(conn)
    client = httpx.Client()

    # --- Discover all events + brackets ---
    print("[main] discovering events...")
    all_brackets, token_ids = _do_discovery(client, conn)

    # --- Start CLOB WebSocket ---
    if token_ids:
        clob_feed.set_tokens(token_ids)
        clob_feed.start()
        print(f"[main] CLOB WS started with {len(token_ids)} tokens")
    else:
        print("[main] WARNING: no token IDs found, WS not started")

    # --- Configure clob_feed for DB orderbook flushing ---
    import os
    db_url = os.environ.get("DATABASE_URL", "")
    all_bracket_dicts = [dict(r) for r in get_brackets(conn)]
    clob_feed.set_db_url(db_url)
    clob_feed.set_bracket_mapping(all_bracket_dicts)

    # --- Start Twitter stream ---
    twitter_stream.start(on_tweet=lambda t: _handle_tweet(t, conn))

    # --- Start cache collector (trades, comments) ---
    start_cache_collector(db_url, all_bracket_dicts)
    print(f"[main] cache collector started for {len(all_bracket_dicts)} brackets")

    # --- Main polling loop ---
    last_discovery = time.time()
    print(f"[main] polling loop started — snapshot every {POLL_INTERVAL:.0f}s")

    while _running:
        try:
            now = time.time()

            # Re-discover events periodically (also refreshes tweet counts from Polymarket)
            if now - last_discovery >= DISCOVERY_INTERVAL:
                try:
                    new_brackets, new_tokens = _do_discovery(client, conn)
                    if new_tokens:
                        clob_feed.set_tokens(new_tokens)
                        clob_feed.set_bracket_mapping([dict(r) for r in get_brackets(conn)])
                    all_brackets = new_brackets
                    token_ids = new_tokens
                except Exception as e:
                    print(f"[main] discovery error: {e}")
                last_discovery = now

            # Snapshot prices
            brackets = _get_all_brackets(conn)
            n = _snapshot_prices(conn, brackets)

            # Update status
            with _db_lock:
                active_events = get_active_events(conn)
                upsert_status(conn, {
                    "ts": int(now),
                    "ws_connected": 1 if any(clob_feed.is_fresh(tid) for tid in token_ids) else 0,
                    "twitter_connected": 1 if twitter_stream.is_connected() else 0,
                    "brackets_count": len(brackets),
                    "events_count": len(active_events),
                    "last_poll_ts": int(now),
                    "last_tweet_ts": None,
                    "error": None,
                })
                conn.commit()

            # Log summary
            ws_prices = clob_feed.latest_prices()
            has_data = sum(1 for tid in token_ids if ws_prices.get(tid, {}).get("mid") is not None)
            print(f"[poll] {n} snapshots | {has_data}/{len(token_ids)} tokens with data")

        except Exception as e:
            print(f"[poll] error: {e}")

        sleep_until = time.time() + POLL_INTERVAL
        while _running and time.time() < sleep_until:
            time.sleep(0.5)

    print("[main] stopped")
    conn.close()
    client.close()


def _set_stop():
    global _running
    _running = False


if __name__ == "__main__":
    main()
