import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    // Try cache first
    const { data } = await supabase
      .from("comments_cache")
      .select("comments, updated_at")
      .eq("id", 1)
      .single();

    if (data && data.comments) {
      return NextResponse.json(data.comments);
    }

    // Fallback: fetch from Polymarket
    const r = await fetch(
      `https://gamma-api.polymarket.com/comments?parent_entity_type=Series&parent_entity_id=10000&limit=30&order=createdAt&ascending=false`,
      { cache: "no-store", headers: { Accept: "application/json" } },
    );
    if (!r.ok) return NextResponse.json([], { status: 200 });
    return NextResponse.json(await r.json());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
