"""Polymarket User Channel WebSocket — real-time account updates.

On trade/order events: fetches full account state (positions, orders, balance),
saves to wallet_cache DB, and pushes account_update to browser via ws_relay.
Browser receives complete state — no polling needed.
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

import httpx
import websockets

WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/user"

_db_url: Optional[str] = None
_condition_ids: list[str] = []
_started = False
_http_client: Optional[httpx.Client] = None


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
        sock.settimeout(2)
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
        else:
            frame.append(0x80 | 127)
            frame.extend(length.to_bytes(8, "big"))
        frame.extend(mask_key)
        frame.extend(bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload)))
        sock.sendall(frame)
        sock.close()
    except Exception:
        pass


def _get_creds():
    """Read API creds + private key from user_config table."""
    if not _db_url:
        return None
    import psycopg2
    try:
        conn = psycopg2.connect(_db_url)
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute("SELECT funder, api_key, api_secret, api_passphrase, private_key FROM user_config WHERE id = 1")
        row = cur.fetchone()
        cur.close()
        conn.close()
        if row and row[1]:
            return {
                "funder": row[0], "api_key": row[1], "api_secret": row[2],
                "api_passphrase": row[3], "private_key": row[4],
            }
    except Exception as e:
        print(f"[user-ws] creds read error: {e}")
    return None


def _fetch_full_account(creds: dict) -> dict:
    """Fetch positions + orders + balance from Polymarket APIs."""
    global _http_client
    if not _http_client:
        _http_client = httpx.Client(timeout=10)

    funder = creds["funder"]
    result = {"positions": [], "open_orders": [], "balance": "0", "portfolio_value": 0}

    # Positions — public REST, no auth needed
    try:
        all_positions = []
        offset = 0
        while True:
            r = _http_client.get(
                "https://data-api.polymarket.com/positions",
                params={"user": funder, "sizeThreshold": "0", "limit": "200", "offset": str(offset)},
            )
            if r.status_code != 200:
                break
            batch = r.json()
            if not batch:
                break
            all_positions.extend(batch)
            if len(batch) < 200:
                break
            offset += 200
        filtered = [p for p in all_positions if float(p.get("size", 0)) > 0]
        # Strip to essential fields only (full data is 200KB+, stripped is ~5KB)
        result["positions"] = [
            {"asset": p.get("asset"), "size": p.get("size"), "curPrice": p.get("curPrice"),
             "currentValue": p.get("currentValue"), "cashPnl": p.get("cashPnl"),
             "percentPnl": p.get("percentPnl"), "outcome": p.get("outcome"),
             "title": p.get("title"), "conditionId": p.get("conditionId")}
            for p in filtered
        ]
        result["portfolio_value"] = sum(float(p.get("currentValue", 0)) for p in filtered)
    except Exception as e:
        print(f"[user-ws] positions fetch error: {e}")

    # Orders + Balance — need CLOB auth via Python
    if creds.get("private_key"):
        try:
            from collector.trading import _get_client, BalanceAllowanceParams, AssetType
            api_creds_dict = {
                "api_key": creds["api_key"],
                "api_secret": creds["api_secret"],
                "api_passphrase": creds["api_passphrase"],
            }
            client = _get_client(creds["private_key"], funder, api_creds_dict)

            # Balance
            try:
                params = BalanceAllowanceParams(asset_type=AssetType.COLLATERAL, signature_type=1)
                bal = client.get_balance_allowance(params)
                result["balance"] = bal.get("balance", "0")
            except Exception:
                pass

            # Open orders
            try:
                orders = client.get_open_orders()
                result["open_orders"] = orders if isinstance(orders, list) else []
            except Exception:
                pass

        except Exception as e:
            print(f"[user-ws] orders/balance fetch error: {e}")

    return result


def _save_and_push(creds: dict) -> None:
    """Fetch full account, save to DB, push to browser."""
    funder = creds.get("funder")
    if not funder or not _db_url:
        return

    account = _fetch_full_account(creds)

    # Save to wallet_cache
    import psycopg2
    try:
        conn = psycopg2.connect(_db_url)
        conn.autocommit = True
        cur = conn.cursor()
        now = int(time.time())
        cur.execute("""
            INSERT INTO wallet_cache (funder, balance, portfolio_value, positions, open_orders, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (funder) DO UPDATE SET
                balance = EXCLUDED.balance, portfolio_value = EXCLUDED.portfolio_value,
                positions = EXCLUDED.positions, open_orders = EXCLUDED.open_orders,
                updated_at = EXCLUDED.updated_at
        """, (funder, account["balance"], account["portfolio_value"],
              json.dumps(account["positions"]), json.dumps(account["open_orders"]), now))
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[user-ws] DB save error: {e}")

    # Push to browser
    _ws_push("account_update", account)
    print(f"[user-ws] pushed account_update: {len(account['positions'])} positions, {len(account['open_orders'])} orders, bal={account['balance'][:10]}...")


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

        # Push initial account state on connect
        await asyncio.get_event_loop().run_in_executor(None, lambda: _save_and_push(creds))

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
                    if status == "MATCHED":
                        # Log WS delay on latest trade_log entry
                        try:
                            import psycopg2 as _pg
                            _conn = _pg.connect(_db_url)
                            _conn.autocommit = True
                            _cur = _conn.cursor()
                            _cur.execute("UPDATE trade_log SET ms_ws_confirm = (extract(epoch from now()) * 1000 - ts * 1000)::int WHERE id = (SELECT max(id) FROM trade_log)")
                            _cur.close()
                            _conn.close()
                        except Exception:
                            pass
                        # Push trade details immediately — browser applies locally
                        _ws_push("trade_fill", {
                            "asset_id": data.get("asset_id"),
                            "side": data.get("side"),
                            "size": data.get("size"),
                            "price": data.get("price"),
                            "outcome": data.get("outcome"),
                        })
                    elif status == "CONFIRMED":
                        # Now Polymarket has updated — fetch real data
                        await asyncio.get_event_loop().run_in_executor(None, lambda: _save_and_push(creds))

                elif event_type == "order":
                    order_type = data.get("type", "")
                    print(f"[user-ws] order {order_type}: {data.get('side')} {data.get('size')} @ {data.get('price')}")
                    # Push order event to browser immediately
                    _ws_push("order_update", {
                        "type": order_type,
                        "asset_id": data.get("asset_id"),
                        "side": data.get("side"),
                        "size": data.get("size"),
                        "price": data.get("price"),
                        "order_id": data.get("id"),
                    })
                    # Fetch full account in background for real data
                    await asyncio.get_event_loop().run_in_executor(None, lambda: _save_and_push(creds))

        finally:
            ping_task.cancel()


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
