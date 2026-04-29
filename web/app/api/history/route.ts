import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 15000; // 15 seconds

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const bracketId = url.searchParams.get("bracket_id");
    const from = url.searchParams.get("from");

    if (!bracketId) {
      return NextResponse.json({ series: [] });
    }

    const cacheKey = `${bracketId}:${from || ""}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return NextResponse.json(cached.data);
    }

    // Aggregate to 1-hour candles: last mid per hour
    const params: unknown[] = [bracketId];
    let whereFrom = "";
    if (from) {
      params.push(parseInt(from));
      whereFrom = ` AND ps.ts >= $2`;
    }

    const { rows } = await query(
      `SELECT
         b.label,
         (ps.ts / 3600) * 3600 AS hour_ts,
         (array_agg(ps.mid ORDER BY ps.ts DESC))[1] AS mid
       FROM price_snapshots ps
       JOIN brackets b ON b.id = ps.bracket_id
       WHERE ps.bracket_id = $1${whereFrom} AND ps.mid IS NOT NULL
       GROUP BY b.label, hour_ts
       ORDER BY hour_ts ASC`,
      params
    );

    const label = rows.length > 0 ? (rows[0] as { label: string }).label : "";
    const points = (rows as { hour_ts: number; mid: number }[]).map((r) => ({
      ts: typeof r.hour_ts === "string" ? parseInt(r.hour_ts) : r.hour_ts,
      mid: typeof r.mid === "string" ? parseFloat(r.mid) : r.mid,
    }));

    const result = { series: [{ bracket: bracketId, label, points }] };
    cache.set(cacheKey, { data: result, ts: Date.now() });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
