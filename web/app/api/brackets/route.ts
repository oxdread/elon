import { NextResponse } from "next/server";
import { query } from "@/lib/db";

let bracketsCache: { data: unknown; ts: number } | null = null;

export async function GET() {
  // Cache for 3 seconds
  if (bracketsCache && Date.now() - bracketsCache.ts < 3000) {
    return NextResponse.json(bracketsCache.data);
  }
  try {
    const { rows: events } = await query(
      `SELECT * FROM events WHERE active = true ORDER BY slug`
    );

    const { rows: brackets } = await query(
      `SELECT b.*, e.slug AS event_slug, e.title AS event_title
       FROM brackets b
       JOIN events e ON b.event_id = e.id
       WHERE e.active = true
       ORDER BY b.lower_bound`
    );

    // Get latest prices from orderbook cache
    const { rows: obCache } = await query(
      `SELECT bracket_id, best_bid, best_ask, updated_at FROM orderbook_cache`
    );

    const priceMap: Record<string, { mid: number | null; bid: number | null; ask: number | null; ts: number }> = {};
    for (const ob of obCache) {
      const bid = ob.best_bid;
      const ask = ob.best_ask;
      const mid = (bid != null && ask != null) ? (bid + ask) / 2 : bid ?? ask ?? null;
      priceMap[ob.bracket_id] = { mid, bid, ask, ts: ob.updated_at };
    }

    // Fallback for brackets not in cache
    const uncached = brackets.filter((b: { id: string }) => !priceMap[b.id]).map((b: { id: string }) => b.id);
    if (uncached.length > 0) {
      const { rows: prices } = await query(`SELECT * FROM get_latest_prices()`);
      for (const p of prices) {
        if (!priceMap[p.bracket_id]) {
          priceMap[p.bracket_id] = { mid: p.mid, bid: p.bid, ask: p.ask, ts: p.ts };
        }
      }
    }

    const { rows: tweetCounts } = await query(
      `SELECT event_id, count FROM tweet_counts`
    );

    const tweetCountMap: Record<string, number> = {};
    for (const tc of tweetCounts) {
      tweetCountMap[tc.event_id] = tc.count;
    }

    // Dead brackets: upper_bound < tweet count => zero out prices
    const enrichedBrackets = brackets.map((b: Record<string, unknown>) => {
      const p = priceMap[b.id as string];
      const eventTweetCount = tweetCountMap[b.event_id as string] ?? 0;
      const isDead = (b.upper_bound as number) < eventTweetCount;
      return {
        ...b,
        mid: isDead ? 0 : (p?.mid ?? null),
        bid: isDead ? 0 : (p?.bid ?? null),
        ask: isDead ? 0 : (p?.ask ?? null),
        price_ts: p?.ts ?? null,
      };
    });

    const { rows: statusRows } = await query(
      `SELECT * FROM collector_status WHERE id = 1`
    );

    const result = {
      events,
      brackets: enrichedBrackets,
      tweet_counts: tweetCountMap,
      status: statusRows[0] ?? null,
    };
    bracketsCache = { data: result, ts: Date.now() };
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
