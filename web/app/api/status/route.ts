import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
  try {
    const { rows: statusRows } = await query(
      `SELECT * FROM collector_status WHERE id = 1`
    );

    const { rows: tweetCounts } = await query(
      `SELECT count FROM tweet_counts`
    );

    const totalTweets = tweetCounts.reduce((a: number, b: { count: number }) => a + b.count, 0);

    const { rows: snapshotRows } = await query(
      `SELECT COUNT(*)::int AS cnt FROM price_snapshots`
    );

    return NextResponse.json({
      collector: statusRows[0] ?? null,
      tweet_count: totalTweets,
      snapshot_count: snapshotRows[0]?.cnt ?? 0,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
