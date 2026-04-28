import { NextResponse } from "next/server";
import { supabase } from "@/lib/db";

let bracketsCache: { data: unknown; ts: number } | null = null;

export async function GET() {
  // Cache for 3 seconds
  if (bracketsCache && Date.now() - bracketsCache.ts < 3000) {
    return NextResponse.json(bracketsCache.data);
  }
  try {
    const { data: events } = await supabase
      .from("events")
      .select("*")
      .eq("active", true)
      .order("slug");

    const { data: brackets } = await supabase
      .from("brackets")
      .select("*, events!inner(slug, title, active)")
      .eq("events.active", true)
      .order("lower_bound");

    // Get latest prices from orderbook cache (fast) or price snapshots (fallback)
    let priceMap: Record<string, { mid: number | null; bid: number | null; ask: number | null; ts: number }> = {};

    const { data: obCache } = await supabase.from("orderbook_cache").select("bracket_id, best_bid, best_ask, updated_at");
    if (obCache) {
      for (const ob of obCache) {
        const bid = ob.best_bid;
        const ask = ob.best_ask;
        const mid = (bid != null && ask != null) ? (bid + ask) / 2 : bid ?? ask ?? null;
        priceMap[ob.bracket_id] = { mid, bid, ask, ts: ob.updated_at };
      }
    }

    // Fallback for brackets not in cache
    const uncached = (brackets || []).filter((b: { id: string }) => !priceMap[b.id]).map((b: { id: string }) => b.id);
    if (uncached.length > 0) {
      const { data: prices } = await supabase.rpc("get_latest_prices", {});
      if (prices) {
        for (const p of prices) {
          if (!priceMap[p.bracket_id]) {
            priceMap[p.bracket_id] = { mid: p.mid, bid: p.bid, ask: p.ask, ts: p.ts };
          }
        }
      }
    }

    const enrichedBrackets = (brackets || []).map((b: Record<string, unknown>) => {
      const p = priceMap[b.id as string];
      const ev = b.events as { slug: string; title: string } | undefined;
      return {
        ...b,
        event_slug: ev?.slug,
        event_title: ev?.title,
        mid: p?.mid ?? null,
        bid: p?.bid ?? null,
        ask: p?.ask ?? null,
        price_ts: p?.ts ?? null,
        events: undefined,
      };
    });

    const { data: tweetCounts } = await supabase
      .from("tweet_counts")
      .select("event_id, count");

    const tweetCountMap: Record<string, number> = {};
    for (const tc of tweetCounts || []) {
      tweetCountMap[tc.event_id] = tc.count;
    }

    const { data: status } = await supabase
      .from("collector_status")
      .select("*")
      .eq("id", 1)
      .single();

    const result = {
      events: events || [],
      brackets: enrichedBrackets,
      tweet_counts: tweetCountMap,
      status: status ?? null,
    };
    bracketsCache = { data: result, ts: Date.now() };
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
