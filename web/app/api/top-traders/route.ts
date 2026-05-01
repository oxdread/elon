import { NextResponse } from "next/server";
import { query } from "@/lib/db";

let cache: { data: unknown; ts: number } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.ts < 5000) {
    return NextResponse.json(cache.data);
  }
  try {
    const { rows } = await query(
      `SELECT wallet_name, wallet_address, side, size, price, outcome, market, timestamp
       FROM top_trader_trades
       ORDER BY timestamp DESC
       LIMIT 30`
    );
    cache = { data: rows, ts: Date.now() };
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
