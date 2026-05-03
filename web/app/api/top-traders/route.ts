import { NextResponse } from "next/server";
import { query } from "@/lib/db";

let cache: { data: unknown; ts: number } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.ts < 5000) {
    return NextResponse.json(cache.data);
  }
  try {
    const { rows } = await query(
      `SELECT t.wallet_name, t.wallet_address, t.side, t.size, t.price, t.outcome, t.market, t.timestamp,
              w.profile_image
       FROM top_trader_trades t
       LEFT JOIN tracked_wallets w ON w.address = t.wallet_address
       ORDER BY t.timestamp DESC
       LIMIT 30`
    );
    // Add local image path
    const data = rows.map((r: any) => ({
      ...r,
      avatar: r.profile_image ? `/api/trader-image?addr=${r.wallet_address}` : null,
    }));
    cache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
