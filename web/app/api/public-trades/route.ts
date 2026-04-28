import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const conditionId = url.searchParams.get("condition_id");
    if (!conditionId) {
      return NextResponse.json({ error: "condition_id required" }, { status: 400 });
    }

    // Try cache first
    const { rows } = await query(
      `SELECT trades, updated_at FROM public_trades_cache WHERE bracket_id = $1 LIMIT 1`,
      [conditionId]
    );

    const data = rows[0];
    if (data && data.trades) {
      return NextResponse.json(data.trades);
    }

    // Fallback: fetch from Polymarket
    const r = await fetch(
      `https://data-api.polymarket.com/trades?market=${conditionId}&limit=30`,
      { cache: "no-store", headers: { "User-Agent": "Mozilla/5.0" } },
    );
    if (!r.ok) return NextResponse.json([], { status: 200 });
    return NextResponse.json(await r.json());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
