"use client";

import { useEffect, useState } from "react";

type HeatmapDay = { dateStr: string; dayName: string; dayNum: number; startUtc: number; endUtc: number };

export default function TweetHeatmap({ heatmapFrom, heatmapTo, compact }: { heatmapFrom: string; heatmapTo: string; compact?: boolean }) {
  const [data, setData] = useState<{ days: HeatmapDay[]; tweets: number[]; et_offset_hours: number } | null>(null);

  useEffect(() => {
    if (!heatmapFrom || !heatmapTo) return;
    const fetchHeatmap = async () => {
      try {
        const r = await fetch(`/api/tweet-heatmap?from=${heatmapFrom}&to=${heatmapTo}`, { cache: "no-store" });
        const d = await r.json();
        if (!d.error) setData({ days: d.days || [], tweets: (d.tweets || []).map(Number).filter((n: number) => !isNaN(n)), et_offset_hours: d.et_offset_hours || 0 });
      } catch {}
    };
    fetchHeatmap();
    const id = setInterval(fetchHeatmap, 30000);
    return () => clearInterval(id);
  }, [heatmapFrom, heatmapTo]);

  if (!data) return <p className="text-neutral-500 text-xs py-4 text-center">Loading heatmap...</p>;

  const { days, tweets, et_offset_hours } = data;
  const grid: number[][] = Array.from({ length: 24 }, () => Array(days.length).fill(0));
  const dayTotals: number[] = Array(days.length).fill(0);

  for (const ts of tweets) {
    if (typeof ts !== "number" || isNaN(ts)) continue;
    const etDate = new Date((ts + et_offset_hours * 3600) * 1000);
    const hour = etDate.getUTCHours();
    if (hour < 0 || hour > 23) continue;
    const dayIdx = days.findIndex((day) => ts >= day.startUtc && ts < day.endUtc);
    if (dayIdx >= 0) { grid[hour][dayIdx]++; dayTotals[dayIdx]++; }
  }

  const nowUtc = Math.floor(Date.now() / 1000);
  const nowEtDate = new Date((nowUtc + et_offset_hours * 3600) * 1000);
  const nowHour = nowEtDate.getUTCHours();
  const nowDayIdx = days.findIndex((day) => nowUtc >= day.startUtc && nowUtc < day.endUtc);

  const cellBg = (val: number, dayIdx: number, hour: number): string => {
    const isCurrentDay = dayIdx === nowDayIdx;
    const isFutureDay = dayIdx > nowDayIdx || nowDayIdx === -1;
    const isFutureHour = isCurrentDay && hour > nowHour;
    if (isFutureDay || isFutureHour) return "bg-neutral-800/20";
    if (val === 0) return "bg-blue-950/40";
    if (val >= 10) return "bg-blue-300/70";
    if (val >= 5) return "bg-blue-400/60";
    if (val >= 3) return "bg-blue-500/50";
    if (val >= 1) return "bg-blue-600/40";
    return "bg-blue-950/40";
  };

  const trends = dayTotals.map((total, i) => {
    if (i === 0 || dayTotals[i - 1] === 0) return "flat";
    return total < dayTotals[i - 1] ? "down" : total > dayTotals[i - 1] ? "up" : "flat";
  });

  const cellSize = compact ? "1px" : "2px";
  const fontSize = compact ? "10px" : "11px";
  const cellPad = compact ? "1px 0" : "3px 0";

  return (
    <div className="h-full overflow-hidden flex flex-col">
      <table className={`w-full h-full tabular-nums border-separate`} style={{ borderSpacing: cellSize, fontSize }}>
        <thead>
          <tr>
            <th className="w-12"></th>
            {days.map((day, i) => (
              <th key={i} className="text-center pb-1">
                <div className={`font-bold ${i === nowDayIdx ? "text-amber-400" : "text-neutral-300"}`}>{day.dayName}</div>
                <div className={`${i === nowDayIdx ? "text-amber-400/70" : "text-neutral-500"}`}>{day.dayNum}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, hour) => (
            <tr key={hour}>
              <td className="text-right pr-2 text-neutral-500 font-medium">{String(hour).padStart(2, "0")}:00</td>
              {row.map((val, dayIdx) => (
                <td key={dayIdx}
                  className={`text-center ${cellBg(val, dayIdx, hour)} ${hour === nowHour && dayIdx === nowDayIdx ? "ring-1 ring-amber-500" : ""}`}
                  style={{ padding: cellPad }}>
                  <span className={val > 0 ? "text-white font-bold" : "text-neutral-500"}>{val}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="text-right pr-2 text-neutral-300 font-bold pt-2">Total</td>
            {dayTotals.map((total, i) => (
              <td key={i} className="text-center pt-2"><span className="text-emerald-400 font-bold text-xs">{total}</span></td>
            ))}
          </tr>
          <tr>
            <td className="text-right pr-2 text-neutral-500 font-medium">Trend</td>
            {trends.map((trend, i) => (
              <td key={i} className="text-center">
                <span className={trend === "down" ? "text-rose-400" : trend === "up" ? "text-emerald-400" : "text-neutral-600"}>
                  {trend === "down" ? "↓" : trend === "up" ? "↑" : "—"}
                </span>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
