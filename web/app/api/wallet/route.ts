import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import path from "path";
import { query } from "@/lib/db";

const PYTHON = path.join(process.cwd(), "..", ".venv", "bin", "python3");
const CWD = path.join(process.cwd(), "..");
const CACHE_TTL = 10; // seconds

function runPython(pyCode: string): string {
  return execSync(`${PYTHON} -c '${pyCode.replace(/'/g, "'\\''")}'`, {
    timeout: 30000, encoding: "utf-8", cwd: CWD,
  }).trim();
}

async function getCachedWallet(funder: string): Promise<{ balance: string; portfolio_value: number; positions: unknown[]; open_orders: unknown[]; updated_at: number } | null> {
  try {
    const { rows } = await query(
      "SELECT balance, portfolio_value, positions, open_orders, updated_at FROM wallet_cache WHERE funder = $1",
      [funder]
    );
    if (rows.length === 0) return null;
    return rows[0] as { balance: string; portfolio_value: number; positions: unknown[]; open_orders: unknown[]; updated_at: number };
  } catch {
    return null;
  }
}

async function upsertWalletCache(funder: string, data: { balance?: string; portfolio_value?: number; positions?: unknown[]; open_orders?: unknown[] }) {
  const now = Math.floor(Date.now() / 1000);
  try {
    await query(
      `INSERT INTO wallet_cache (funder, balance, portfolio_value, positions, open_orders, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (funder) DO UPDATE SET
         balance = COALESCE($2, wallet_cache.balance),
         portfolio_value = COALESCE($3, wallet_cache.portfolio_value),
         positions = COALESCE($4, wallet_cache.positions),
         open_orders = COALESCE($5, wallet_cache.open_orders),
         updated_at = $6`,
      [
        funder,
        data.balance ?? "0",
        data.portfolio_value ?? 0,
        JSON.stringify(data.positions ?? []),
        JSON.stringify(data.open_orders ?? []),
        now,
      ]
    );
  } catch {}
}

function isFresh(updatedAt: number): boolean {
  return Math.floor(Date.now() / 1000) - updatedAt < CACHE_TTL;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { private_key, action } = body;
    if (!private_key) return NextResponse.json({ error: "No key" }, { status: 400 });

    const safeKey = private_key.replace(/[^a-fA-F0-9x]/g, "");
    const funder = (body.funder || "").replace(/[^a-fA-F0-9x]/g, "");
    const force = !!body.force;

    // --- Cached actions ---

    if (action === "positions") {
      if (!funder) return NextResponse.json({ error: "No funder address" }, { status: 400 });
      const cached = !force ? await getCachedWallet(funder) : null;
      if (cached && isFresh(cached.updated_at)) {
        return NextResponse.json(cached.positions);
      }
      // Fetch fresh
      const pyCode = `
import json, sys
sys.path.insert(0, "${CWD}")
from collector.trading import get_positions
print(json.dumps(get_positions("${funder}")))
`;
      const result = JSON.parse(runPython(pyCode));
      // Compute portfolio value
      let pv = 0;
      if (Array.isArray(result)) {
        for (const p of result) pv += parseFloat(p.currentValue || 0);
      }
      await upsertWalletCache(funder, { positions: result, portfolio_value: pv });
      return NextResponse.json(result);
    }

    if (action === "balance") {
      const cached = (!force && funder) ? await getCachedWallet(funder) : null;
      if (cached && isFresh(cached.updated_at)) {
        return NextResponse.json({ balance: cached.balance });
      }
      const pyCode = `
import json, sys
sys.path.insert(0, "${CWD}")
from collector.trading import get_balance
print(json.dumps(get_balance("${safeKey}", "${funder}")))
`;
      const result = JSON.parse(runPython(pyCode));
      if (funder && result.balance) {
        await upsertWalletCache(funder, { balance: result.balance });
      }
      return NextResponse.json(result);
    }

    if (action === "orders") {
      const cached = (!force && funder) ? await getCachedWallet(funder) : null;
      if (cached && isFresh(cached.updated_at)) {
        return NextResponse.json(cached.open_orders);
      }
      const pyCode = `
import json, sys
sys.path.insert(0, "${CWD}")
from collector.trading import get_open_orders
print(json.dumps(get_open_orders("${safeKey}")))
`;
      const result = JSON.parse(runPython(pyCode));
      if (funder) {
        await upsertWalletCache(funder, { open_orders: result });
      }
      return NextResponse.json(result);
    }

    if (action === "full") {
      const cached = (!force && funder) ? await getCachedWallet(funder) : null;
      if (cached && isFresh(cached.updated_at)) {
        return NextResponse.json({
          cash: cached.balance,
          portfolio_value: cached.portfolio_value,
          positions: cached.positions,
          open_orders: cached.open_orders,
        });
      }
      const pyCode = `
import json, sys
sys.path.insert(0, "${CWD}")
from collector.trading import get_full_account
print(json.dumps(get_full_account("${safeKey}")))
`;
      const result = JSON.parse(runPython(pyCode));
      if (result.funder || funder) {
        await upsertWalletCache(result.funder || funder, {
          balance: result.cash,
          portfolio_value: result.portfolio_value,
          positions: result.positions,
          open_orders: result.open_orders,
        });
      }
      return NextResponse.json(result);
    }

    // --- Non-cached actions (info, trades, trade execution) ---

    if (action === "info") {
      // Get wallet info + derive API creds and save to user_config for WS auth
      const infoPyCode = `
import json, sys
sys.path.insert(0, "${CWD}")
from collector.trading import get_wallet_info, get_api_creds
info = get_wallet_info("${safeKey}")
creds = get_api_creds("${safeKey}", "${funder}")
print(json.dumps({**info, "creds": creds}))
`;
      const result = JSON.parse(runPython(infoPyCode));
      // Save API creds to user_config for collector's user WS channel
      if (result.creds && !result.creds.error) {
        try {
          await query(
            `INSERT INTO user_config (id, funder, private_key, api_key, api_secret, api_passphrase, updated_at)
             VALUES (1, $1, $2, $3, $4, $5, $6)
             ON CONFLICT (id) DO UPDATE SET
               funder = $1, private_key = $2, api_key = $3, api_secret = $4, api_passphrase = $5, updated_at = $6`,
            [result.funder || funder, safeKey, result.creds.api_key, result.creds.api_secret, result.creds.api_passphrase, Math.floor(Date.now() / 1000)]
          );
        } catch {}
      }
      const { creds: _, ...info } = result;
      return NextResponse.json(info);
    } else if (action === "trades") {
      const tradesPyCode = `
import json, sys
sys.path.insert(0, "${CWD}")
from collector.trading import get_trade_history
print(json.dumps(get_trade_history("${safeKey}")))
`;
      return NextResponse.json(JSON.parse(runPython(tradesPyCode)));
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
