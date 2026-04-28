import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");

    const ET_OFFSET_HOURS = -4;
    const nowMs = Date.now();
    const nowEt = new Date(nowMs + ET_OFFSET_HOURS * 3600 * 1000);

    const fromDate = fromParam ? new Date(fromParam + "T00:00:00Z") : new Date(new Date(nowEt.getTime() - 6 * 86400 * 1000).toISOString().slice(0, 10) + "T00:00:00Z");
    const toDate = toParam ? new Date(toParam + "T00:00:00Z") : new Date(nowEt.toISOString().slice(0, 10) + "T00:00:00Z");

    const days: { dateStr: string; dayName: string; dayNum: number; startUtc: number; endUtc: number }[] = [];
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    const d = new Date(fromDate);
    while (d <= toDate) {
      const startUtc = Math.floor(d.getTime() / 1000) - ET_OFFSET_HOURS * 3600;
      const nextDay = new Date(d);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      const endUtc = Math.floor(nextDay.getTime() / 1000) - ET_OFFSET_HOURS * 3600;
      const realDate = new Date(startUtc * 1000);

      days.push({
        dateStr: `${realDate.getUTCMonth() + 1}/${realDate.getUTCDate()}`,
        dayName: dayNames[realDate.getUTCDay()],
        dayNum: realDate.getUTCDate(),
        startUtc,
        endUtc,
      });
      d.setUTCDate(d.getUTCDate() + 1);
    }

    const rangeStart = days.length > 0 ? days[0].startUtc : 0;
    const rangeEnd = days.length > 0 ? days[days.length - 1].endUtc : Math.floor(nowMs / 1000);

    const { data: tweets } = await supabase
      .from("tweets")
      .select("ts")
      .gte("ts", rangeStart)
      .lt("ts", rangeEnd)
      .order("ts");

    return NextResponse.json({
      days,
      tweets: (tweets || []).map((t: { ts: number }) => t.ts),
      et_offset_hours: ET_OFFSET_HOURS,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
