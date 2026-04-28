import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    // Try cache first
    const { rows } = await query(
      `SELECT comments, updated_at FROM comments_cache WHERE id = 1`
    );

    const data = rows[0];
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
