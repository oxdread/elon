import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const json = url.searchParams.get("json");

  try {
    const { rows } = await query(
      `SELECT * FROM trade_log ORDER BY id DESC LIMIT 50`
    );

    if (json === "1") {
      return NextResponse.json(rows);
    }

    const html = `<!DOCTYPE html>
<html><head><title>Trade Log</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #060606; color: #e5e5e5; font-family: ui-monospace, monospace; padding: 20px; }
  h1 { font-size: 16px; color: #808080; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; padding: 8px 10px; color: #555; border-bottom: 1px solid #1a1a1a; font-weight: normal; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; }
  td { padding: 6px 10px; border-bottom: 1px solid #111; }
  tr:hover { background: #0d0d0d; }
  .ok { color: #0ecb81; }
  .error, .crash { color: #f6465d; }
  .buy { color: #0ecb81; font-weight: bold; }
  .sell { color: #f6465d; font-weight: bold; }
  .ms { color: #808080; }
  .ms-slow { color: #fbbf24; font-weight: bold; }
  .ms-bad { color: #f6465d; font-weight: bold; }
  .token { color: #555; font-size: 10px; }
  .time { color: #808080; font-size: 11px; }
  .err-msg { color: #f6465d; font-size: 10px; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar { height: 4px; border-radius: 2px; display: inline-block; vertical-align: middle; }
  .bar-creds { background: #3b82f6; }
  .bar-python { background: #fbbf24; }
  .bar-cache { background: #0ecb81; }
  .bar-network { background: #f472b6; }
  .legend { display: flex; gap: 16px; margin-bottom: 12px; font-size: 11px; color: #808080; }
  .legend span { display: flex; align-items: center; gap: 4px; }
  .legend .dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
</style></head><body>
<h1>Trade Log (last 50)</h1>
<div class="legend">
  <span><span class="dot" style="background:#f472b6"></span> Network (client→server)</span>
  <span><span class="dot" style="background:#3b82f6"></span> DB creds</span>
  <span><span class="dot" style="background:#fbbf24"></span> Python/order</span>
  <span><span class="dot" style="background:#0ecb81"></span> Cache invalidate</span>
</div>
<table>
<tr>
  <th>Time</th>
  <th>Side</th>
  <th>Type</th>
  <th>Price</th>
  <th>Size</th>
  <th>Status</th>
  <th>Total</th>
  <th>Breakdown</th>
  <th>Error</th>
</tr>
${rows.map((r: any) => {
  const date = r.ts ? new Date(r.ts * 1000) : null;
  const timeStr = date ? date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "—";
  const totalMs = r.ms_total || 0;
  const totalClass = totalMs > 10000 ? "ms-bad" : totalMs > 3000 ? "ms-slow" : "ms";
  const maxBar = Math.max(totalMs, 1);
  const credW = Math.max(1, Math.round((r.ms_creds_read || 0) / maxBar * 200));
  const pyW = Math.max(1, Math.round((r.ms_python_start || 0) / maxBar * 200));
  const cacheW = Math.max(1, Math.round((r.ms_cache_invalidate || 0) / maxBar * 200));
  const netW = Math.max(1, Math.round((r.ms_client_to_server || 0) / maxBar * 200));
  return `<tr>
    <td class="time">${timeStr}</td>
    <td class="${(r.side || "").toLowerCase()}">${r.side || "—"}</td>
    <td>${r.order_type || "—"}</td>
    <td>${r.price ? parseFloat(r.price).toFixed(2) : "—"}</td>
    <td>${r.size ? parseFloat(r.size).toFixed(1) : "—"}</td>
    <td class="${r.status || ""}">${r.status || "—"}</td>
    <td class="${totalClass}">${(totalMs / 1000).toFixed(1)}s</td>
    <td>
      <span class="bar bar-network" style="width:${netW}px" title="network: ${r.ms_client_to_server || 0}ms"></span>
      <span class="bar bar-creds" style="width:${credW}px" title="creds: ${r.ms_creds_read}ms"></span>
      <span class="bar bar-python" style="width:${pyW}px" title="python: ${r.ms_python_start}ms"></span>
      <span class="bar bar-cache" style="width:${cacheW}px" title="cache: ${r.ms_cache_invalidate}ms"></span>
      <span class="ms" style="font-size:10px; margin-left:4px">net:${r.ms_client_to_server || 0} cred:${r.ms_creds_read} py:${r.ms_python_start} cache:${r.ms_cache_invalidate}ms</span>
    </td>
    <td class="err-msg" title="${(r.error || "").replace(/"/g, '&quot;')}">${r.error || ""}</td>
  </tr>`;
}).join("\n")}
</table>
<script>setTimeout(() => location.reload(), 10000);</script>
</body></html>`;

    return new NextResponse(html, { headers: { "Content-Type": "text/html" } });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
