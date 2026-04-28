"use client";

import { useRef, useEffect, useState, useCallback } from "react";

type Point = { ts: number; mid: number | null };
type Series = { id: string; label: string; color: string; points: Point[]; selected: boolean };

export default function Chart({
  series,
  selectedId,
}: {
  series: Series[];
  selectedId: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 400 });
  const [hover, setHover] = useState<{ x: number; ts: number; prices: { label: string; price: number; color: string }[] } | null>(null);

  // Pan/zoom state
  const [viewRange, setViewRange] = useState<{ start: number; end: number } | null>(null);
  const dragRef = useRef<{ startX: number; startRange: { start: number; end: number } } | null>(null);

  // Compute global time range
  const allPoints = series.flatMap((s) => s.points.filter((p) => p.mid != null));
  const globalStart = allPoints.length > 0 ? Math.min(...allPoints.map((p) => p.ts)) : 0;
  const globalEnd = allPoints.length > 0 ? Math.max(...allPoints.map((p) => p.ts)) : 1;

  const range = viewRange ?? { start: globalStart, end: globalEnd };

  // Resize
  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.floor(e.contentRect.width);
        const h = Math.floor(e.contentRect.height);
        if (w > 0 && h > 0) setSize({ w, h });
      }
    });
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Reset view when data changes significantly
  useEffect(() => {
    setViewRange(null);
  }, [series.length, selectedId]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    ctx.scale(dpr, dpr);

    const pad = { top: 20, right: 60, bottom: 30, left: 10 };
    const cw = size.w - pad.left - pad.right;
    const ch = size.h - pad.top - pad.bottom;

    // Clear
    ctx.fillStyle = "#111113";
    ctx.fillRect(0, 0, size.w, size.h);

    if (allPoints.length === 0) {
      ctx.fillStyle = "#444";
      ctx.font = "12px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("Waiting for data...", size.w / 2, size.h / 2);
      return;
    }

    const { start, end } = range;
    const tRange = end - start || 1;

    // Compute price range from visible data
    const visibleSeries = selectedId ? series.filter((s) => s.id === selectedId) : series;
    let minP = Infinity, maxP = -Infinity;
    for (const s of visibleSeries) {
      for (const p of s.points) {
        if (p.mid == null) continue;
        if (p.ts >= start && p.ts <= end) {
          if (p.mid < minP) minP = p.mid;
          if (p.mid > maxP) maxP = p.mid;
        }
      }
    }
    if (!isFinite(minP)) { minP = 0; maxP = 1; }
    const pPad = (maxP - minP) * 0.1 || 0.01;
    minP -= pPad;
    maxP += pPad;
    if (minP < 0) minP = 0;
    const pRange = maxP - minP || 1;

    const toX = (ts: number) => pad.left + ((ts - start) / tRange) * cw;
    const toY = (p: number) => pad.top + (1 - (p - minP) / pRange) * ch;

    // Grid — horizontal dotted lines
    ctx.strokeStyle = "#ffffff0d";
    ctx.setLineDash([2, 4]);
    ctx.lineWidth = 1;
    const gridSteps = 6;
    for (let i = 0; i <= gridSteps; i++) {
      const p = minP + (pRange * i) / gridSteps;
      const y = toY(p);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(size.w - pad.right, y);
      ctx.stroke();

      // Price labels
      ctx.fillStyle = "#444";
      ctx.font = "10px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText((p * 100).toFixed(0) + "%", size.w - pad.right + 6, y + 3);
    }
    ctx.setLineDash([]);

    // Time labels
    ctx.fillStyle = "#444";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "center";
    const timeSteps = Math.max(3, Math.floor(cw / 100));
    for (let i = 0; i <= timeSteps; i++) {
      const ts = start + (tRange * i) / timeSteps;
      const x = toX(ts);
      const d = new Date(ts * 1000);
      const label = d.toLocaleDateString([], { month: "short", day: "numeric" });
      ctx.fillText(label, x, size.h - 8);
    }

    // Draw lines
    const drawSeries = selectedId ? series : series;
    for (const s of drawSeries) {
      const pts = s.points.filter((p) => p.mid != null && p.ts >= start - tRange * 0.1 && p.ts <= end + tRange * 0.1);
      if (pts.length < 2) continue;

      const isSelected = s.id === selectedId;
      const noSelection = !selectedId;

      if (!noSelection && !isSelected) continue; // Hide unselected when one is selected

      ctx.strokeStyle = isSelected ? "#3b82f6" : s.color;
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      let started = false;
      for (const p of pts) {
        const x = toX(p.ts);
        const y = toY(p.mid!);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Area fill for selected
      if (isSelected && pts.length > 0) {
        const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
        gradient.addColorStop(0, "rgba(59, 130, 246, 0.10)");
        gradient.addColorStop(1, "rgba(59, 130, 246, 0.0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(toX(pts[0].ts), toY(pts[0].mid!));
        for (const p of pts) ctx.lineTo(toX(p.ts), toY(p.mid!));
        ctx.lineTo(toX(pts[pts.length - 1].ts), pad.top + ch);
        ctx.lineTo(toX(pts[0].ts), pad.top + ch);
        ctx.closePath();
        ctx.fill();
      }

      // Label at the end of the line
      if (pts.length > 0 && (noSelection || isSelected)) {
        const lastPt = pts[pts.length - 1];
        const lx = toX(lastPt.ts);
        const ly = toY(lastPt.mid!);
        ctx.fillStyle = isSelected ? "#3b82f6" : s.color;
        ctx.beginPath();
        ctx.arc(lx, ly, 3, 0, Math.PI * 2);
        ctx.fill();

        // Label background
        const text = `${s.label} ${(lastPt.mid! * 100).toFixed(0)}%`;
        ctx.font = "bold 9px ui-monospace, monospace";
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = isSelected ? "#3b82f6" : s.color;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(lx + 6, ly - 7, tw + 8, 14);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#fff";
        ctx.textAlign = "left";
        ctx.fillText(text, lx + 10, ly + 3);
      }
    }

    // Hover crosshair
    if (hover) {
      ctx.strokeStyle = "#ffffff20";
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(hover.x, pad.top);
      ctx.lineTo(hover.x, pad.top + ch);
      ctx.stroke();

      // Time label at bottom
      const d = new Date(hover.ts * 1000);
      const timeLabel = d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      ctx.font = "10px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "#1c1c1c";
      const tlw = ctx.measureText(timeLabel).width;
      ctx.fillRect(hover.x - tlw / 2 - 4, size.h - pad.bottom + 2, tlw + 8, 16);
      ctx.fillStyle = "#aaa";
      ctx.fillText(timeLabel, hover.x, size.h - pad.bottom + 13);

      // Price dots on lines
      for (const p of hover.prices) {
        const y = toY(p.price);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(hover.x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#111113";
        ctx.beginPath();
        ctx.arc(hover.x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [size, series, selectedId, range, hover, allPoints.length]);

  // Mouse handlers
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const pad = { left: 10, right: 60, top: 20, bottom: 30 };
    const cw = size.w - pad.left - pad.right;
    const { start, end } = range;
    const tRange = end - start || 1;
    const ts = start + ((x - pad.left) / cw) * tRange;

    // Dragging for pan
    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.startX;
      const tShift = -(dx / cw) * tRange;
      setViewRange({
        start: dragRef.current.startRange.start + tShift,
        end: dragRef.current.startRange.end + tShift,
      });
      return;
    }

    // Find prices at this time
    const visibleSeries = selectedId ? series.filter((s) => s.id === selectedId) : series;
    const prices: { label: string; price: number; color: string }[] = [];
    for (const s of visibleSeries) {
      // Find closest point
      let closest: Point | null = null;
      let closestDist = Infinity;
      for (const p of s.points) {
        if (p.mid == null) continue;
        const d = Math.abs(p.ts - ts);
        if (d < closestDist) { closestDist = d; closest = p; }
      }
      if (closest && closest.mid != null) {
        prices.push({ label: s.label, price: closest.mid, color: s.selected ? "#3b82f6" : s.color });
      }
    }

    setHover({ x, ts, prices });
  }, [size, range, series, selectedId]);

  const handleMouseLeave = useCallback(() => {
    setHover(null);
    dragRef.current = null;
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startRange: { ...range } };
  }, [range]);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const pad = { left: 10, right: 60 };
    const cw = size.w - pad.left - pad.right;
    const ratio = (x - pad.left) / cw;

    const { start, end } = range;
    const tRange = end - start;
    const zoom = e.deltaY > 0 ? 1.15 : 0.87; // zoom out / in
    const newRange = tRange * zoom;
    const newStart = start + (tRange - newRange) * ratio;
    setViewRange({ start: newStart, end: newStart + newRange });
  }, [range, size]);

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <canvas
        ref={canvasRef}
        width={size.w}
        height={size.h}
        style={{ width: "100%", height: "100%" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        className="cursor-crosshair"
      />
    </div>
  );
}
