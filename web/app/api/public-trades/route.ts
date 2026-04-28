import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const conditionId = url.searchParams.get("condition_id");
    if (!conditionId) {
      return NextResponse.json({ error: "condition_id required" }, { status: 400 });
    }

    // Try cache first
    const { data } = await supabase
      .from("public_trades_cache")
      .select("trades, updated_at")
      .eq("bracket_id", conditionId)
      .single();

    if (data && data.trades) {
      return NextResponse.json(data.trades);
    }

    // Fallback: fetch from Polymarket
    const r = await fetch(
      `https://data-api.polymarket.com/trades?market=${conditionId}&limit=30`,
      { cache: "no-store", headers: { "User-Agent": "Mozilla/5.0" } },
    );
    if (!r.ok) return NextResponse.json([], { status: 200 });
    return NextResponse.json(await r.json());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
