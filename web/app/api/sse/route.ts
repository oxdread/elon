import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  let lastTweetId: string | null = null;
  let lastSnapshotTs: number = 0;
  let closed = false;

  // Get initial state
  try {
    const { rows } = await query("SELECT id, ts FROM tweets ORDER BY ts DESC LIMIT 1");
    if (rows[0]) lastTweetId = rows[0].id;
    const { rows: snap } = await query("SELECT MAX(ts) as ts FROM price_snapshots");
    if (snap[0]?.ts) lastSnapshotTs = Number(snap[0].ts);
  } catch {}

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {}
      };

      // Send heartbeat + check for new data every 2 seconds
      const interval = setInterval(async () => {
        if (closed) { clearInterval(interval); return; }

        try {
          // Check for new tweets
          const { rows: tweets } = await query(
            "SELECT id, ts, text, author_id FROM tweets ORDER BY ts DESC LIMIT 1"
          );
          if (tweets[0] && tweets[0].id !== lastTweetId) {
            lastTweetId = tweets[0].id;
            send("tweet", tweets[0]);
          }

          // Check for new price data (bracket prices updated)
          const { rows: snap } = await query("SELECT MAX(ts) as ts FROM price_snapshots");
          const newTs = Number(snap[0]?.ts || 0);
          if (newTs > lastSnapshotTs) {
            lastSnapshotTs = newTs;
            send("price_update", { ts: newTs });
          }

          // Heartbeat
          send("heartbeat", { ts: Math.floor(Date.now() / 1000) });
        } catch {}
      }, 2000);

      // Cleanup on close
      const cleanup = () => {
        closed = true;
        clearInterval(interval);
      };

      // Auto-close after 5 minutes (client will reconnect)
      setTimeout(() => {
        cleanup();
        try { controller.close(); } catch {}
      }, 300000);
    },
    cancel() {
      closed = true;
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
