import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

let allCache: { data: unknown; ts: number; eventId: string } | null = null;
const CACHE_TTL = 60000; // 60 seconds

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const eventId = url.searchParams.get("event_id");
    const bracketId = url.searchParams.get("bracket_id");
    const from = url.searchParams.get("from");

    // Single bracket query (for time range buttons)
    if (bracketId && !eventId) {
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
      return NextResponse.json({ series: [{ bracket: bracketId, label, points }] });
    }

    // All brackets for event — loaded once on page open, cached
    if (eventId) {
      if (allCache && allCache.eventId === eventId && Date.now() - allCache.ts < CACHE_TTL) {
        return NextResponse.json(allCache.data);
      }

      const { rows } = await query(
        `SELECT
           b.id AS bracket_id,
           b.label,
           (ps.ts / 3600) * 3600 AS hour_ts,
           (array_agg(ps.mid ORDER BY ps.ts DESC))[1] AS mid
         FROM price_snapshots ps
         JOIN brackets b ON b.id = ps.bracket_id
         WHERE b.event_id = $1 AND ps.mid IS NOT NULL
         GROUP BY b.id, b.label, hour_ts
         ORDER BY b.id, hour_ts ASC`,
        [eventId]
      );

      const seriesMap = new Map<string, { bracket: string; label: string; points: { ts: number; mid: number }[] }>();
      for (const r of rows as { bracket_id: string; label: string; hour_ts: number; mid: number }[]) {
        if (!seriesMap.has(r.bracket_id)) {
          seriesMap.set(r.bracket_id, { bracket: r.bracket_id, label: r.label, points: [] });
        }
        seriesMap.get(r.bracket_id)!.points.push({
          ts: typeof r.hour_ts === "string" ? parseInt(r.hour_ts) : r.hour_ts,
          mid: typeof r.mid === "string" ? parseFloat(r.mid) : r.mid,
        });
      }

      const result = { series: Array.from(seriesMap.values()) };
      allCache = { data: result, ts: Date.now(), eventId };
      return NextResponse.json(result);
    }

    return NextResponse.json({ series: [] });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
