"""Multi-token CLOB WebSocket — subscribes to all bracket YES tokens at once.

Maintains a dict of {token_id: {mid, bid, ask, updated_at}} shared state.
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
        # Init price entries for new tokens
        for tid in token_ids:
            if tid not in _prices:
                _prices[tid] = {"mid": None, "bid": None, "ask": None, "updated_at": 0.0}
    if _loop is not None and _tokens_changed_event is not None:
        _loop.call_soon_threadsafe(_tokens_changed_event.set)


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


async def _run_once(token_ids: list[str], changed_event: asyncio.Event) -> None:
    sub = {"assets_ids": token_ids, "type": "market"}
    # Per-token local books
    books: dict[str, dict] = {tid: {"bids": {}, "asks": {}} for tid in token_ids}

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
                        if tid not in books:
                            continue
                        books[tid]["bids"] = {b["price"]: float(b["size"]) for b in (entry.get("bids") or [])}
                        books[tid]["asks"] = {a["price"]: float(a["size"]) for a in (entry.get("asks") or [])}
                        mid, bb, ba = _compute_mid(books[tid]["bids"], books[tid]["asks"])
                        with _lock:
                            _prices[tid] = {"mid": mid, "bid": bb, "ask": ba, "updated_at": time.time()}

                elif isinstance(data, dict) and "price_changes" in data:
                    for change in (data.get("price_changes") or []):
                        tid = change.get("asset_id")
                        if tid not in books:
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
                            if side == "BUY":
                                if size == 0:
                                    books[tid]["bids"].pop(price, None)
                                else:
                                    books[tid]["bids"][price] = size
                            elif side == "SELL":
                                if size == 0:
                                    books[tid]["asks"].pop(price, None)
                                else:
                                    books[tid]["asks"][price] = size
        finally:
            ping_task.cancel()


async def _run_forever() -> None:
    global _tokens_changed_event
    _tokens_changed_event = asyncio.Event()

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
