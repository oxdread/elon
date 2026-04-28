"""Polymarket User Channel WebSocket — instant trade + order confirmations.

Connects to the user WS channel with API creds from user_config table.
On trade CONFIRMED → updates wallet_cache positions.
On order events → updates wallet_cache open_orders.
Pushes events to browser via ws_relay (port 3001).
"""
from __future__ import annotations

import asyncio
import json
import socket
import threading
import time
import os
import base64
from typing import Optional

import websockets

WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/user"

_db_url: Optional[str] = None
_condition_ids: list[str] = []
_started = False


def set_db_url(url: str) -> None:
    global _db_url
    _db_url = url


def set_condition_ids(ids: list[str]) -> None:
    global _condition_ids
    _condition_ids = ids


def _ws_push(event_type: str, data: dict) -> None:
    """Push event to the WS relay server (fire and forget)."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        sock.connect(("127.0.0.1", 3002))

        key = base64.b64encode(os.urandom(16)).decode()
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

        payload = json.dumps({"type": event_type, "data": data}).encode()
        frame = bytearray()
        frame.append(0x81)
        mask_key = os.urandom(4)
        length = len(payload)
        if length < 126:
            frame.append(0x80 | length)
        elif length < 65536:
            frame.append(0x80 | 126)
            frame.extend(length.to_bytes(2, "big"))
        frame.extend(mask_key)
        frame.extend(bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload)))
        sock.sendall(frame)
        sock.close()
    except Exception:
        pass


def _get_creds():
    """Read API creds from user_config table."""
    if not _db_url:
        return None
    import psycopg2
    try:
        conn = psycopg2.connect(_db_url)
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute("SELECT funder, api_key, api_secret, api_passphrase FROM user_config WHERE id = 1")
        row = cur.fetchone()
        cur.close()
        conn.close()
        if row and row[1]:
            return {"funder": row[0], "api_key": row[1], "api_secret": row[2], "api_passphrase": row[3]}
    except Exception as e:
        print(f"[user-ws] creds read error: {e}")
    return None


def _update_wallet_cache(funder: str, positions: list = None, open_orders: list = None) -> None:
    """Update wallet_cache in DB."""
    if not _db_url or not funder:
        return
    import psycopg2
    try:
        conn = psycopg2.connect(_db_url)
        conn.autocommit = True
        cur = conn.cursor()
        now = int(time.time())
        if positions is not None:
            cur.execute(
                "UPDATE wallet_cache SET positions = %s, updated_at = %s WHERE funder = %s",
                (json.dumps(positions), now, funder)
            )
        if open_orders is not None:
            cur.execute(
                "UPDATE wallet_cache SET open_orders = %s, updated_at = %s WHERE funder = %s",
                (json.dumps(open_orders), now, funder)
            )
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[user-ws] DB update error: {e}")


async def _run_once(creds: dict, condition_ids: list[str]) -> None:
    sub = {
        "auth": {
            "apiKey": creds["api_key"],
            "secret": creds["api_secret"],
            "passphrase": creds["api_passphrase"],
        },
        "markets": condition_ids,
        "type": "user",
    }

    async with websockets.connect(WS_URL, open_timeout=10) as ws:
        await ws.send(json.dumps(sub))
        print(f"[user-ws] connected, watching {len(condition_ids)} markets")

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

                if not isinstance(data, dict):
                    continue

                event_type = data.get("event_type")

                if event_type == "trade":
                    status = data.get("status", "")
                    print(f"[user-ws] trade {status}: {data.get('side')} {data.get('size')} @ {data.get('price')}")
                    # Push to browser immediately
                    _ws_push("trade_update", {
                        "asset_id": data.get("asset_id"),
                        "side": data.get("side"),
                        "size": data.get("size"),
                        "price": data.get("price"),
                        "status": status,
                        "outcome": data.get("outcome"),
                    })
                    # On CONFIRMED, invalidate wallet cache so next poll fetches fresh
                    if status == "CONFIRMED":
                        if creds.get("funder"):
                            _invalidate_wallet_cache(creds["funder"])

                elif event_type == "order":
                    order_type = data.get("type", "")
                    print(f"[user-ws] order {order_type}: {data.get('side')} {data.get('size')} @ {data.get('price')}")
                    _ws_push("order_update", {
                        "type": order_type,
                        "asset_id": data.get("asset_id"),
                        "side": data.get("side"),
                        "size": data.get("size"),
                        "price": data.get("price"),
                        "order_id": data.get("id"),
                    })
                    # Invalidate wallet cache on any order change
                    if creds.get("funder"):
                        _invalidate_wallet_cache(creds["funder"])

        finally:
            ping_task.cancel()


def _invalidate_wallet_cache(funder: str) -> None:
    """Set updated_at to 0 so next poll fetches fresh data."""
    if not _db_url:
        return
    import psycopg2
    try:
        conn = psycopg2.connect(_db_url)
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute("UPDATE wallet_cache SET updated_at = 0 WHERE funder = %s", (funder,))
        cur.close()
        conn.close()
    except Exception:
        pass


async def _run_forever() -> None:
    while True:
        creds = await asyncio.get_event_loop().run_in_executor(None, _get_creds)
        if not creds:
            await asyncio.sleep(10)
            continue

        condition_ids = _condition_ids if _condition_ids else []
        if not condition_ids:
            await asyncio.sleep(5)
            continue

        backoff = 1.0
        try:
            await _run_once(creds, condition_ids)
            backoff = 1.0
        except Exception as e:
            print(f"[user-ws] error: {type(e).__name__}: {e}; retry in {backoff:.0f}s")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30.0)


def start() -> None:
    global _started
    if _started:
        return
    _started = True

    def _thread():
        loop = asyncio.new_event_loop()
        loop.run_until_complete(_run_forever())

    t = threading.Thread(target=_thread, name="user-ws", daemon=True)
    t.start()
