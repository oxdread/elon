import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const tokenId = url.searchParams.get("token_id");
    const bracketId = url.searchParams.get("bracket_id");
    if (!tokenId && !bracketId) {
      return NextResponse.json({ error: "token_id or bracket_id required" }, { status: 400 });
    }

    // Try cache first
    const { rows } = bracketId
      ? await query(`SELECT * FROM orderbook_cache WHERE bracket_id = $1 LIMIT 1`, [bracketId])
      : await query(`SELECT * FROM orderbook_cache WHERE token_id = $1 LIMIT 1`, [tokenId]);

    const data = rows[0];

    if (data) {
      return NextResponse.json({
        bids: data.bids || [],
        asks: data.asks || [],
        best_bid: data.best_bid,
        best_ask: data.best_ask,
        spread: data.spread,
        cached: true,
        age: Math.floor(Date.now() / 1000) - data.updated_at,
      });
    }

    // Fallback: fetch from Polymarket directly
    if (tokenId) {
      const r = await fetch(`https://clob.polymarket.com/book?token_id=${tokenId}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!r.ok) {
        if (r.status === 404) return NextResponse.json({ bids: [], asks: [] });
        return NextResponse.json({ error: `CLOB API ${r.status}` }, { status: 502 });
      }
      return NextResponse.json(await r.json());
    }

    return NextResponse.json({ bids: [], asks: [] });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
