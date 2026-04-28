import { NextResponse } from "next/server";
import { supabase } from "@/lib/db";

export async function GET() {
  try {
    const { data: status } = await supabase
      .from("collector_status")
      .select("*")
      .eq("id", 1)
      .single();

    const { data: tweetCounts } = await supabase
      .from("tweet_counts")
      .select("count");

    const totalTweets = (tweetCounts || []).reduce((a: number, b: { count: number }) => a + b.count, 0);

    const { count: snapshotCount } = await supabase
      .from("price_snapshots")
      .select("*", { count: "exact", head: true });

    return NextResponse.json({
      collector: status ?? null,
      tweet_count: totalTweets,
      snapshot_count: snapshotCount ?? 0,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
