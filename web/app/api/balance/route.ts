import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import path from "path";

const PYTHON = path.join(process.cwd(), "..", ".venv", "bin", "python3");

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { private_key } = body;
    if (!private_key) return NextResponse.json({ error: "No key" }, { status: 400 });

    const pyCode = `
import json, sys
sys.path.insert(0, "${path.join(process.cwd(), "..")}")
from collector.trading import get_balance
r = get_balance("${private_key}")
print(json.dumps(r))
`;

    const result = execSync(`${PYTHON} -c '${pyCode.replace(/'/g, "'\\''")}'`, {
      timeout: 15000, encoding: "utf-8", cwd: path.join(process.cwd(), ".."),
    });

    return NextResponse.json(JSON.parse(result.trim()));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
