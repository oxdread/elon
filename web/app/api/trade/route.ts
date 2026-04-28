import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import path from "path";

const PYTHON = path.join(process.cwd(), "..", ".venv", "bin", "python3");

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { private_key, token_id, amount, price, size, side, order_type, funder } = body;

    if (!private_key || !token_id || !side) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    let pyCode: string;
    if (order_type === "limit" && price && size) {
      pyCode = `
import json, sys
sys.path.insert(0, "${path.join(process.cwd(), "..")}")
from collector.trading import place_limit_order
r = place_limit_order(
    private_key="${private_key}",
    token_id="${token_id}",
    price=${price},
    size=${size},
    side="${side}",
    funder="${funder || ""}",
)
print(json.dumps(r))
`;
    } else {
      pyCode = `
import json, sys
sys.path.insert(0, "${path.join(process.cwd(), "..")}")
from collector.trading import place_market_order
r = place_market_order(
    private_key="${private_key}",
    token_id="${token_id}",
    amount=${amount || size || 1},
    side="${side}",
    funder="${funder || ""}",
)
print(json.dumps(r))
`;
    }

    const result = execSync(`${PYTHON} -c '${pyCode.replace(/'/g, "'\\''")}'`, {
      timeout: 15000,
      encoding: "utf-8",
      cwd: path.join(process.cwd(), ".."),
    });

    return NextResponse.json(JSON.parse(result.trim()));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
