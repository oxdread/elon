import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";

// In-memory cache to avoid re-fetching the same event data
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 60000; // 1 minute

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const eventId = url.searchParams.get("event_id");
    const bracketId = url.searchParams.get("bracket_id");

    const cacheKey = `${eventId || ""}:${bracketId || ""}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return NextResponse.json(cached.data);
    }

    type Row = { bracket_id: string; label: string; ts: number; mid: number | null; trigger: string };
    let rows: Row[] = [];

    if (eventId) {
      // Fetch all pages in parallel (estimate ~5 pages of 1000)
      const firstPage = await supabase.rpc("get_history_by_event", { p_event_id: eventId }).range(0, 999);
      if (firstPage.error) return NextResponse.json({ error: firstPage.error.message }, { status: 500 });
      rows.push(...(firstPage.data || []));

      if (firstPage.data && firstPage.data.length === 1000) {
        // Fetch remaining pages in parallel
        const pagePromises = [];
        for (let page = 1; page <= 10; page++) {
          pagePromises.push(
            supabase.rpc("get_history_by_event", { p_event_id: eventId })
              .range(page * 1000, (page + 1) * 1000 - 1)
          );
        }
        const results = await Promise.all(pagePromises);
        for (const r of results) {
          if (r.data && r.data.length > 0) rows.push(...r.data);
        }
      }
    } else if (bracketId) {
      let page = 0;
      while (true) {
        const { data } = await supabase
          .from("price_snapshots")
          .select("bracket_id, ts, mid, trigger, brackets!inner(label)")
          .eq("bracket_id", bracketId)
          .order("ts", { ascending: true })
          .range(page * 1000, (page + 1) * 1000 - 1);
        if (!data || data.length === 0) break;
        for (const r of data) {
          const b = r.brackets as unknown as { label: string } | { label: string }[] | undefined;
          rows.push({
            bracket_id: r.bracket_id,
            label: Array.isArray(b) ? b[0]?.label ?? "" : b?.label ?? "",
            ts: r.ts, mid: r.mid, trigger: r.trigger,
          });
        }
        if (data.length < 1000) break;
        page++;
        if (page > 10) break;
      }
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
