import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

let cache: { data: unknown; ts: number } | null = null;

export async function GET(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "1";
  // Cache for 1 second unless force
  if (!force && cache && Date.now() - cache.ts < 1000) {
    return NextResponse.json(cache.data);
  }
  try {
    const { rows } = await query(
      `SELECT bracket_id, token_id, bids, asks, best_bid, best_ask, spread, updated_at FROM orderbook_cache`
    );
    const result: Record<string, unknown> = {};
    for (const r of rows) {
      result[r.bracket_id] = {
        bids: r.bids,
        asks: r.asks,
        best_bid: r.best_bid,
        best_ask: r.best_ask,
        spread: r.spread,
      };
    }
    cache = { data: result, ts: Date.now() };
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
