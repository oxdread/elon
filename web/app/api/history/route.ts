import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

// In-memory cache to avoid re-fetching the same event data
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 30000; // 30 seconds

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const eventId = url.searchParams.get("event_id");
    const bracketId = url.searchParams.get("bracket_id");
    const from = url.searchParams.get("from");
    const top = url.searchParams.get("top"); // only return top N brackets by price

    const cacheKey = `${eventId || ""}:${bracketId || ""}:${from || ""}:${top || ""}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return NextResponse.json(cached.data);
    }

    type Row = { bracket_id: string; label: string; ts: number; mid: number | null; trigger: string };
    let rows: Row[] = [];

    if (eventId) {
      // If top=N, first find which brackets to include
      let bracketFilter = "";
      const params: unknown[] = [eventId];

      if (top) {
        const { rows: topBrackets } = await query(
          `SELECT bracket_id FROM orderbook_cache ob
           JOIN brackets b ON b.id = ob.bracket_id
           WHERE b.event_id = $1 AND ob.best_ask IS NOT NULL
           ORDER BY (COALESCE(ob.best_bid,0) + COALESCE(ob.best_ask,0))/2 DESC
           LIMIT $2`,
          [eventId, parseInt(top)]
        );
        if (topBrackets.length > 0) {
          const ids = topBrackets.map((r: { bracket_id: string }) => r.bracket_id);
          bracketFilter = ` AND ps.bracket_id = ANY($${params.length + 1})`;
          params.push(ids);
        }
      }

      if (from) {
        params.push(parseInt(from));
        const { rows: data } = await query(
          `SELECT ps.bracket_id, b.label, ps.ts, ps.mid, ps.trigger
           FROM price_snapshots ps
           JOIN brackets b ON b.id = ps.bracket_id
           WHERE b.event_id = $1${bracketFilter} AND ps.ts >= $${params.length}
           ORDER BY ps.ts ASC`,
          params
        );
        rows = data as Row[];
      } else {
        if (bracketFilter) {
          const { rows: data } = await query(
            `SELECT ps.bracket_id, b.label, ps.ts, ps.mid, ps.trigger
             FROM price_snapshots ps
             JOIN brackets b ON b.id = ps.bracket_id
             WHERE b.event_id = $1${bracketFilter}
             ORDER BY ps.ts ASC`,
            params
          );
          rows = data as Row[];
        } else {
          const { rows: data } = await query(
            `SELECT * FROM get_history_by_event($1)`,
            [eventId]
          );
          rows = data as Row[];
        }
      }
    } else if (bracketId) {
      const params: unknown[] = [bracketId];
      let whereFrom = "";
      if (from) {
        params.push(parseInt(from));
        whereFrom = ` AND ps.ts >= $2`;
      }
      const { rows: data } = await query(
        `SELECT ps.bracket_id, b.label, ps.ts, ps.mid, ps.trigger
         FROM price_snapshots ps
         JOIN brackets b ON b.id = ps.bracket_id
         WHERE ps.bracket_id = $1${whereFrom}
         ORDER BY ps.ts ASC`,
        params
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
