import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import path from "path";
import { query } from "@/lib/db";

const PYTHON = path.join(process.cwd(), "..", ".venv", "bin", "python3");
const CWD = path.join(process.cwd(), "..");

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { private_key, token_id, amount, price, size, side, order_type, funder } = body;

    if (!private_key || !token_id || !side) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Read cached API creds from user_config to skip slow derive step
    let apiCreds = "None";
    try {
      const { rows } = await query(
        "SELECT api_key, api_secret, api_passphrase FROM user_config WHERE id = 1"
      );
      if (rows.length > 0 && rows[0].api_key) {
        apiCreds = `{"api_key": "${rows[0].api_key}", "api_secret": "${rows[0].api_secret}", "api_passphrase": "${rows[0].api_passphrase}"}`;
      }
    } catch {}

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
      timeout: 15000,
      encoding: "utf-8",
      cwd: CWD,
    });

    const parsed = JSON.parse(result.trim());

    // On success, invalidate wallet cache so next poll fetches fresh data
    if (parsed.status === "ok" && funder) {
      try {
        await query(
          "UPDATE wallet_cache SET updated_at = 0 WHERE funder = $1",
          [funder]
        );
      } catch {}
    }

    return NextResponse.json(parsed);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
