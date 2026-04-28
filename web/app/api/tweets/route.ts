import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
    const offset = parseInt(url.searchParams.get("offset") || "0");

    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS total FROM tweets`
    );
    const total = countRows[0]?.total ?? 0;

    const { rows: tweets } = await query(
      `SELECT * FROM tweets ORDER BY ts DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    // For each tweet, get price snapshots with bracket label
    const tweetIds = tweets.map((t: { id: string }) => t.id);
    let pricesByTweet: Record<string, { label: string; mid: number | null; bid: number | null; ask: number | null }[]> = {};

    if (tweetIds.length > 0) {
      const { rows: prices } = await query(
        `SELECT ps.tweet_id, ps.mid, ps.bid, ps.ask, b.label, b.lower_bound
         FROM price_snapshots ps
         JOIN brackets b ON b.id = ps.bracket_id
         WHERE ps.tweet_id = ANY($1)
         ORDER BY b.lower_bound`,
        [tweetIds]
      );

      for (const p of prices) {
        if (!pricesByTweet[p.tweet_id]) pricesByTweet[p.tweet_id] = [];
        pricesByTweet[p.tweet_id].push({
          label: p.label,
          mid: p.mid,
          bid: p.bid,
          ask: p.ask,
        });
      }
    }

    const result = tweets.map((t: { id: string }) => ({
      ...t,
      prices: pricesByTweet[t.id] || [],
    }));

    return NextResponse.json({ tweets: result, total });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
