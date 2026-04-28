import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

// In-memory cache to avoid re-fetching the same event data
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 120000; // 2 minutes (longer cache for faster loads)

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const eventId = url.searchParams.get("event_id");
    const bracketId = url.searchParams.get("bracket_id");
    const from = url.searchParams.get("from");

    const cacheKey = `${eventId || ""}:${bracketId || ""}:${from || ""}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return NextResponse.json(cached.data);
    }

    type Row = { bracket_id: string; label: string; ts: number; mid: number | null; trigger: string };
    let rows: Row[] = [];

    if (eventId) {
      if (from) {
        // Fast path: filtered by time
        const { rows: data } = await query(
          `SELECT ps.bracket_id, b.label, ps.ts, ps.mid, ps.trigger
           FROM price_snapshots ps
           JOIN brackets b ON b.id = ps.bracket_id
           WHERE b.event_id = $1 AND ps.ts >= $2
           ORDER BY ps.ts ASC`,
          [eventId, parseInt(from)]
        );
        rows = data as Row[];
      } else {
        const { rows: data } = await query(
          `SELECT * FROM get_history_by_event($1)`,
          [eventId]
        );
        rows = data as Row[];
      }
    } else if (bracketId) {
      const { rows: data } = await query(
        `SELECT ps.bracket_id, b.label, ps.ts, ps.mid, ps.trigger
         FROM price_snapshots ps
         JOIN brackets b ON b.id = ps.bracket_id
         WHERE ps.bracket_id = $1
         ORDER BY ps.ts ASC`,
        [bracketId]
      );
      rows = data as Row[];
    } else {
      return NextResponse.json({ series: [] });
    }

    // Group by bracket
    const seriesMap = new Map<string, { bracket: string; label: string; points: { ts: number; mid: number | null; trigger: string }[] }>();
    for (const r of rows) {
      if (!seriesMap.has(r.bracket_id)) {
        seriesMap.set(r.bracket_id, { bracket: r.bracket_id, label: r.label, points: [] });
      }
      seriesMap.get(r.bracket_id)!.points.push({ ts: r.ts, mid: r.mid, trigger: r.trigger });
    }

    const result = { series: Array.from(seriesMap.values()) };
    cache.set(cacheKey, { data: result, ts: Date.now() });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
