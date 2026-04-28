import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import path from "path";

const PYTHON = path.join(process.cwd(), "..", ".venv", "bin", "python3");
const CWD = path.join(process.cwd(), "..");

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { private_key, action } = body;
    if (!private_key) return NextResponse.json({ error: "No key" }, { status: 400 });

    // Escape key for shell safety
    const safeKey = private_key.replace(/[^a-fA-F0-9x]/g, "");

    let pyCode = "";

    if (action === "info") {
      pyCode = `
import json, sys
sys.path.insert(0, "${CWD}")
from collector.trading import get_wallet_info
print(json.dumps(get_wallet_info("${safeKey}")))
`;
    } else if (action === "balance") {
      const funder = (body.funder || "").replace(/[^a-fA-F0-9x]/g, "");
      pyCode = `
import json, sys
sys.path.insert(0, "${CWD}")
from collector.trading import get_balance
print(json.dumps(get_balance("${safeKey}", "${funder}")))
`;
    } else if (action === "full") {
      pyCode = `
import json, sys
sys.path.insert(0, "${CWD}")
from collector.trading import get_full_account
print(json.dumps(get_full_account("${safeKey}")))
`;
    } else if (action === "positions") {
      const funder = (body.funder || "").replace(/[^a-fA-F0-9x]/g, "");
      if (!funder) return NextResponse.json({ error: "No funder address" }, { status: 400 });
      pyCode = `
import json, sys
sys.path.insert(0, "${CWD}")
from collector.trading import get_positions
print(json.dumps(get_positions("${funder}")))
`;
    } else if (action === "orders") {
      pyCode = `
import json, sys
sys.path.insert(0, "${CWD}")
from collector.trading import get_open_orders
print(json.dumps(get_open_orders("${safeKey}")))
`;
    } else if (action === "trades") {
      pyCode = `
import json, sys
sys.path.insert(0, "${CWD}")
from collector.trading import get_trade_history
print(json.dumps(get_trade_history("${safeKey}")))
`;
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const result = execSync(`${PYTHON} -c '${pyCode.replace(/'/g, "'\\''")}'`, {
      timeout: 30000, encoding: "utf-8", cwd: CWD,
    });

    return NextResponse.json(JSON.parse(result.trim()));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
