import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
    const offset = parseInt(url.searchParams.get("offset") || "0");

    const { data: tweets, count } = await supabase
      .from("tweets")
      .select("*", { count: "exact" })
      .order("ts", { ascending: false })
      .range(offset, offset + limit - 1);

    // For each tweet, get price snapshots
    const result = [];
    for (const t of tweets || []) {
      const { data: prices } = await supabase
        .from("price_snapshots")
        .select("bracket_id, mid, bid, ask, brackets!inner(label, lower_bound)")
        .eq("tweet_id", t.id)
        .order("brackets(lower_bound)");

      result.push({
        ...t,
        prices: (prices || []).map((p: Record<string, unknown>) => {
          const b = p.brackets as unknown as { label: string } | { label: string }[] | undefined;
          const label = Array.isArray(b) ? b[0]?.label ?? "" : b?.label ?? "";
          return { label, mid: p.mid, bid: p.bid, ask: p.ask };
        }),
      });
    }

    return NextResponse.json({ tweets: result, total: count ?? 0 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
