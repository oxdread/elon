import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import path from "path";
import { query } from "@/lib/db";

const PYTHON = path.join(process.cwd(), "..", ".venv", "bin", "python3");
const CWD = path.join(process.cwd(), "..");

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  let msCreds = 0, msPython = 0, msCache = 0;

  try {
    const body = await req.json();
    const { private_key, token_id, amount, price, size, side, order_type, funder } = body;

    if (!private_key || !token_id || !side) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Step 1: Read cached API creds
    const t1 = Date.now();
    let apiCreds = "None";
    try {
      const { rows } = await query(
        "SELECT api_key, api_secret, api_passphrase FROM user_config WHERE id = 1"
      );
      if (rows.length > 0 && rows[0].api_key) {
        apiCreds = `{"api_key": "${rows[0].api_key}", "api_secret": "${rows[0].api_secret}", "api_passphrase": "${rows[0].api_passphrase}"}`;
      }
    } catch {}
    msCreds = Date.now() - t1;

    // Step 2: Run Python to place order
    const t2 = Date.now();
    let pyCode: string;
    if (order_type === "limit" && price && size) {
      pyCode = `
import json, sys
sys.path.insert(0, "${CWD}")
from collector.trading import place_limit_order
r = place_limit_order(
    private_key="${private_key}",
    token_id="${token_id}",
    price=${price},
    size=${size},
    side="${side}",
    funder="${funder || ""}",
    api_creds=${apiCreds},
)
print(json.dumps(r))
`;
    } else {
      pyCode = `
import json, sys
sys.path.insert(0, "${CWD}")
from collector.trading import place_market_order
r = place_market_order(
    private_key="${private_key}",
    token_id="${token_id}",
    amount=${amount || size || 1},
    side="${side}",
    funder="${funder || ""}",
    api_creds=${apiCreds},
)
print(json.dumps(r))
`;
    }

    const result = execSync(`${PYTHON} -c '${pyCode.replace(/'/g, "'\\''")}'`, {
      timeout: 30000,
      encoding: "utf-8",
      cwd: CWD,
    });
    msPython = Date.now() - t2;

    const parsed = JSON.parse(result.trim());

    // Step 3: Invalidate wallet cache
    const t3 = Date.now();
    if (parsed.status === "ok" && funder) {
      try {
        await query(
          "UPDATE wallet_cache SET updated_at = 0 WHERE funder = $1",
          [funder]
        );
      } catch {}
    }
    msCache = Date.now() - t3;

    const msTotal = Date.now() - t0;

    // Log to trade_log
    try {
      await query(
        `INSERT INTO trade_log (ts, side, order_type, token_id, price, size, status, error, ms_total, ms_creds_read, ms_python_start, ms_order_post, ms_cache_invalidate)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          Math.floor(Date.now() / 1000),
          side, order_type || "market",
          token_id?.slice(0, 20) || "",
          price || 0, size || amount || 0,
          parsed.status || "error",
          parsed.error || null,
          msTotal, msCreds, msPython, msPython, msCache,
        ]
      );
    } catch {}

    return NextResponse.json(parsed);
  } catch (e) {
    const msTotal = Date.now() - t0;
    // Log error too
    try {
      await query(
        `INSERT INTO trade_log (ts, side, order_type, status, error, ms_total, ms_creds_read, ms_python_start, ms_order_post, ms_cache_invalidate)
         VALUES ($1, '', '', 'crash', $2, $3, $4, $5, $5, $6)`,
        [Math.floor(Date.now() / 1000), String(e).slice(0, 500), msTotal, msCreds, msPython, msCache]
      );
    } catch {}
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
