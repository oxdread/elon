"""Multi-token CLOB WebSocket — subscribes to all bracket YES tokens at once.

Maintains a dict of {token_id: {mid, bid, ask, updated_at}} shared state.
Also flushes full orderbook data to orderbook_cache DB every ~500ms.
Call set_tokens() when brackets are discovered/updated to trigger reconnect.
"""
from __future__ import annotations

import asyncio
import json
import threading
import time
from typing import Optional

import websockets

WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market"

# {token_id: {"mid": float|None, "bid": float|None, "ask": float|None, "updated_at": float}}
_prices: dict[str, dict] = {}
_tokens: list[str] = []
_lock = threading.Lock()
_started = False
_loop: Optional[asyncio.AbstractEventLoop] = None
_tokens_changed_event: Optional[asyncio.Event] = None

# Orderbook state — shared so the DB flusher can read it
_books: dict[str, dict] = {}  # {token_id: {"bids": {price: size}, "asks": {price: size}}}
_books_lock = threading.Lock()

# Bracket mapping and DB config
_token_to_bracket: dict[str, str] = {}  # {token_id: bracket_id}
_db_url: Optional[str] = None


def latest_prices() -> dict[str, dict]:
    """Return a copy of all token prices."""
    with _lock:
        return {k: dict(v) for k, v in _prices.items()}


def is_fresh(token_id: str, max_age_sec: float = 120.0) -> bool:
    with _lock:
        p = _prices.get(token_id)
        return p is not None and p["mid"] is not None and (time.time() - p["updated_at"]) < max_age_sec


def set_tokens(token_ids: list[str]) -> None:
    """Called when brackets are discovered. Triggers WS reconnect with new tokens."""
    with _lock:
        if set(token_ids) == set(_tokens):
            return
        _tokens.clear()
        _tokens.extend(token_ids)
        for tid in token_ids:
            if tid not in _prices:
                _prices[tid] = {"mid": None, "bid": None, "ask": None, "updated_at": 0.0}
    if _loop is not None and _tokens_changed_event is not None:
        _loop.call_soon_threadsafe(_tokens_changed_event.set)


def set_bracket_mapping(brackets: list[dict]) -> None:
    """Set token_id → bracket_id mapping for DB writes."""
    global _token_to_bracket
    mapping = {}
    for b in brackets:
        tid = b.get("yes_token_id")
        if tid:
            mapping[tid] = b["id"]
    _token_to_bracket = mapping


def set_db_url(url: str) -> None:
    """Set the database URL for orderbook cache writes."""
    global _db_url
    _db_url = url


def _compute_mid(bids: dict, asks: dict) -> tuple[Optional[float], Optional[float], Optional[float]]:
    """Returns (mid, best_bid, best_ask)."""
    bid_prices = [float(p) for p, s in bids.items() if float(s) > 0]
    ask_prices = [float(p) for p, s in asks.items() if float(s) > 0]
    best_bid = max(bid_prices) if bid_prices else None
    best_ask = min(ask_prices) if ask_prices else None
    mid = None
    if best_bid is not None and best_ask is not None:
        mid = round((best_bid + best_ask) / 2, 4)
    return mid, best_bid, best_ask


def _flush_orderbooks_to_db() -> None:
    """Flush in-memory orderbooks to orderbook_cache table."""
    if not _db_url or not _token_to_bracket:
        return

    import psycopg2

    try:
        conn = psycopg2.connect(_db_url)
        conn.autocommit = True
        cur = conn.cursor()
        now = int(time.time())
        count = 0

        with _books_lock:
            snapshot = {tid: {"bids": dict(b["bids"]), "asks": dict(b["asks"])} for tid, b in _books.items()}

        for tid, book in snapshot.items():
            bracket_id = _token_to_bracket.get(tid)
            if not bracket_id:
                continue

            bids = book["bids"]
            asks = book["asks"]

            # Sort and limit to top 30 levels
            bids_sorted = sorted(
                [{"price": p, "size": str(s)} for p, s in bids.items() if s > 0],
                key=lambda x: -float(x["price"])
            )[:30]
            asks_sorted = sorted(
                [{"price": p, "size": str(s)} for p, s in asks.items() if s > 0],
                key=lambda x: float(x["price"])
            )[:30]

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
            """, (bracket_id, tid, json.dumps(bids_sorted), json.dumps(asks_sorted),
                  best_bid, best_ask, spread, now))
            count += 1

        cur.close()
        conn.close()

        if count > 0:
            print(f"[clob-ws] flushed {count} orderbooks to DB")

    except Exception as e:
        print(f"[clob-ws] DB flush error: {e}")


async def _db_flusher():
    """Periodically flush orderbooks to DB every 500ms."""
    while True:
        await asyncio.sleep(0.5)
        try:
            await asyncio.get_event_loop().run_in_executor(None, _flush_orderbooks_to_db)
        except Exception:
            pass


async def _run_once(token_ids: list[str], changed_event: asyncio.Event) -> None:
    sub = {"assets_ids": token_ids, "type": "market"}
    # Init local books
    with _books_lock:
        for tid in token_ids:
            if tid not in _books:
                _books[tid] = {"bids": {}, "asks": {}}

    async with websockets.connect(WS_URL, open_timeout=10) as ws:
        await ws.send(json.dumps(sub))

        async def pinger():
            while True:
                await asyncio.sleep(10)
                try:
                    await ws.send("PING")
                except Exception:
                    return

        ping_task = asyncio.create_task(pinger())
        try:
            while True:
                if changed_event.is_set():
                    return  # reconnect with new tokens

                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue

                if not isinstance(raw, str) or raw in ("PONG", ""):
                    continue
                try:
                    data = json.loads(raw)
                except Exception:
                    continue

                if isinstance(data, list):
                    # Full book snapshot
                    for entry in data:
                        tid = entry.get("asset_id")
                        if tid not in _books:
                            continue
                        new_bids = {b["price"]: float(b["size"]) for b in (entry.get("bids") or [])}
                        new_asks = {a["price"]: float(a["size"]) for a in (entry.get("asks") or [])}
                        with _books_lock:
                            _books[tid]["bids"] = new_bids
                            _books[tid]["asks"] = new_asks
                        mid, bb, ba = _compute_mid(new_bids, new_asks)
                        with _lock:
                            _prices[tid] = {"mid": mid, "bid": bb, "ask": ba, "updated_at": time.time()}

                elif isinstance(data, dict) and "price_changes" in data:
                    for change in (data.get("price_changes") or []):
                        tid = change.get("asset_id")
                        if tid not in _books:
                            continue
                        # Update best bid/ask from change
                        best_bid = change.get("best_bid")
                        best_ask = change.get("best_ask")
                        if best_bid is not None and best_ask is not None:
                            try:
                                bb = float(best_bid)
                                ba = float(best_ask)
                                mid = round((bb + ba) / 2, 4)
                                with _lock:
                                    _prices[tid] = {"mid": mid, "bid": bb, "ask": ba, "updated_at": time.time()}
                            except (TypeError, ValueError):
                                pass
                        # Update local book
                        price = change.get("price")
                        size = float(change.get("size", 0))
                        side = change.get("side", "")
                        if price:
                            with _books_lock:
                                if side == "BUY":
                                    if size == 0:
                                        _books[tid]["bids"].pop(price, None)
                                    else:
                                        _books[tid]["bids"][price] = size
                                elif side == "SELL":
                                    if size == 0:
                                        _books[tid]["asks"].pop(price, None)
                                    else:
                                        _books[tid]["asks"][price] = size
        finally:
            ping_task.cancel()


async def _run_forever() -> None:
    global _tokens_changed_event
    _tokens_changed_event = asyncio.Event()

    # Start DB flusher task
    asyncio.create_task(_db_flusher())

    while True:
        with _lock:
            token_ids = list(_tokens)

        if not token_ids:
            await asyncio.sleep(1.0)
            continue

        _tokens_changed_event.clear()
        backoff = 1.0
        try:
            await _run_once(token_ids, _tokens_changed_event)
            backoff = 1.0
        except Exception as e:
            print(f"[clob-ws] error: {type(e).__name__}: {e}; retry in {backoff:.0f}s")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30.0)


def start() -> None:
    global _started, _loop
    if _started:
        return
    _started = True

    def _thread():
        global _loop
        loop = asyncio.new_event_loop()
        _loop = loop
        loop.run_until_complete(_run_forever())

    t = threading.Thread(target=_thread, name="clob-ws", daemon=True)
    t.start()
