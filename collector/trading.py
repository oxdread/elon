"""Polymarket CLOB v2 trading API — server-side order execution.

Uses py_clob_client_v2 with the user's private key to place/cancel orders.
The key is passed from the browser per-request (never stored server-side).
"""
from __future__ import annotations

import json
from typing import Optional

import httpx
from py_clob_client_v2 import ClobClient
from py_clob_client_v2.clob_types import (
    OrderArgs, OrderType, MarketOrderArgs,
    BalanceAllowanceParams, AssetType,
)

CLOB_HOST = "https://clob.polymarket.com"
CHAIN_ID = 137  # Polygon mainnet


def get_wallet_info(private_key: str) -> dict:
    """Derive wallet address + auto-detect funder from trade history."""
    try:
        from eth_account import Account
        acct = Account.from_key(private_key)
        signing_address = acct.address

        funder = None
        try:
            client = _get_client(private_key)
            trades = client.get_trades()
            if isinstance(trades, list) and trades:
                funder = trades[0].get("maker_address")
        except Exception:
            pass

        return {"address": signing_address, "funder": funder}
    except Exception as e:
        return {"error": str(e)}


def get_balance(private_key: str, funder: str = "") -> dict:
    """Get pUSD balance from CLOB v2 API."""
    try:
        client = _get_client(private_key, funder)
        params = BalanceAllowanceParams(
            asset_type=AssetType.COLLATERAL,
            signature_type=1,
        )
        bal = client.get_balance_allowance(params)
        return {"balance": bal.get("balance", "0")}
    except Exception as e:
        return {"error": str(e)}


def get_positions(funder: str) -> list:
    """Get positions from data-api using funder address. Filters dead ones."""
    try:
        all_positions = []
        offset = 0
        while True:
            r = httpx.get(
                "https://data-api.polymarket.com/positions",
                params={"user": funder, "sizeThreshold": "0", "limit": "200", "offset": str(offset)},
                timeout=15,
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
        return [p for p in all_positions if float(p.get("size", 0)) > 0]
    except Exception as e:
        return [{"error": str(e)}]


def get_open_orders(private_key: str) -> list:
    """Get open orders from CLOB v2 API."""
    try:
        client = _get_client(private_key)
        orders = client.get_open_orders()
        return orders if isinstance(orders, list) else []
    except Exception as e:
        return [{"error": str(e)}]


def get_trade_history(private_key: str) -> list:
    """Get trade history from CLOB v2 API."""
    try:
        client = _get_client(private_key)
        trades = client.get_trades()
        return trades if isinstance(trades, list) else []
    except Exception as e:
        return [{"error": str(e)}]


def get_full_account(private_key: str) -> dict:
    """Get everything: balance, funder, positions, orders."""
    try:
        from eth_account import Account
        acct = Account.from_key(private_key)
        signing_address = acct.address

        client = _get_client(private_key)

        # Auto-detect funder
        funder = None
        trades = client.get_trades()
        if isinstance(trades, list) and trades:
            funder = trades[0].get("maker_address")

        # Balance
        cash = "0"
        try:
            params = BalanceAllowanceParams(asset_type=AssetType.COLLATERAL, signature_type=1)
            bal = client.get_balance_allowance(params)
            cash = bal.get("balance", "0")
        except Exception:
            pass

        # Positions
        positions = []
        portfolio_value = 0.0
        if funder:
            positions = get_positions(funder)
            if isinstance(positions, list):
                for p in positions:
                    cv = p.get("currentValue", 0)
                    if cv:
                        portfolio_value += float(cv)

        # Open orders
        orders = []
        try:
            orders = client.get_open_orders()
            if not isinstance(orders, list):
                orders = []
        except Exception:
            pass

        return {
            "address": signing_address,
            "funder": funder,
            "cash": cash,
            "portfolio_value": round(portfolio_value, 2),
            "positions": positions if isinstance(positions, list) else [],
            "open_orders": orders,
            "trade_count": len(trades) if isinstance(trades, list) else 0,
        }
    except Exception as e:
        return {"error": str(e)}


def get_market_info(condition_id: str) -> dict:
    """Get market info including fees, tick size, min order size."""
    try:
        client = ClobClient(host=CLOB_HOST, chain_id=CHAIN_ID)
        info = client.get_clob_market_info(condition_id)
        return info if isinstance(info, dict) else {"data": info}
    except Exception as e:
        return {"error": str(e)}


def get_api_creds(private_key: str, funder: str = "") -> dict:
    """Derive API credentials (apiKey, secret, passphrase) for WS auth."""
    try:
        client = ClobClient(
            host=CLOB_HOST,
            chain_id=CHAIN_ID,
            key=private_key,
            funder=funder or None,
            signature_type=1,
        )
        creds = client.create_or_derive_api_key()
        return {
            "api_key": creds.api_key,
            "api_secret": creds.api_secret,
            "api_passphrase": creds.api_passphrase,
        }
    except Exception as e:
        return {"error": str(e)}


def _get_client(private_key: str, funder: str = "", api_creds: dict = None) -> ClobClient:
    """Create an authenticated ClobClient v2."""
    client = ClobClient(
        host=CLOB_HOST,
        chain_id=CHAIN_ID,
        key=private_key,
        funder=funder or None,
        signature_type=1,
    )
    if api_creds and api_creds.get("api_key"):
        from py_clob_client_v2.clob_types import ApiCreds
        client.set_api_creds(ApiCreds(
            api_key=api_creds["api_key"],
            api_secret=api_creds["api_secret"],
            api_passphrase=api_creds["api_passphrase"],
        ))
    else:
        creds = client.create_or_derive_api_key()
        client.set_api_creds(creds)
    return client


def place_market_order(private_key: str, token_id: str, amount: float, side: str, funder: str = "", api_creds: dict = None) -> dict:
    try:
        client = _get_client(private_key, funder, api_creds)
        order_args = MarketOrderArgs(token_id=token_id, amount=amount, side=side.upper())
        signed_order = client.create_market_order(order_args)
        resp = client.post_order(signed_order, OrderType.FAK)
        return {"status": "ok", "response": resp}
    except Exception as e:
        return {"error": str(e)}


def place_limit_order(private_key: str, token_id: str, price: float, size: float, side: str, funder: str = "", api_creds: dict = None) -> dict:
    try:
        client = _get_client(private_key, funder, api_creds)
        order_args = OrderArgs(token_id=token_id, price=price, size=size, side=side.upper())
        signed_order = client.create_order(order_args)
        resp = client.post_order(signed_order, OrderType.GTC)
        return {"status": "ok", "response": resp}
    except Exception as e:
        return {"error": str(e)}


def cancel_order(private_key: str, order_id: str, api_creds: dict = None) -> dict:
    try:
        client = _get_client(private_key, api_creds=api_creds)
        resp = client.cancel_order(order_id)
        return {"status": "ok", "response": resp}
    except Exception as e:
        return {"error": str(e)}


def cancel_all_orders(private_key: str) -> dict:
    try:
        client = _get_client(private_key)
        resp = client.cancel_all()
        return {"status": "ok", "response": resp}
    except Exception as e:
        return {"error": str(e)}
