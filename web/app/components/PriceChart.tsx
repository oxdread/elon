"use client";

import { useEffect, useRef, useCallback } from "react";
import {
  createChart,
  ColorType,
  LineStyle,
  LineType,
  CrosshairMode,
  AreaSeries,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
} from "lightweight-charts";

type PricePoint = { ts: number; mid: number | null };

export default function PriceChart({
  data,
  bracketLabel,
  bid,
  ask,
  onPriceClick,
}: {
  data: PricePoint[];
  bracketLabel: string | null;
  bid: number | null;
  ask: number | null;
  onPriceClick?: (price: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const bidLineRef = useRef<ReturnType<ISeriesApi<SeriesType>["createPriceLine"]> | null>(null);
  const askLineRef = useRef<ReturnType<ISeriesApi<SeriesType>["createPriceLine"]> | null>(null);

  // Create chart
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#060606" },
        textColor: "#525252",
        fontSize: 11,
        fontFamily: "ui-monospace, SFMono-Regular, monospace",
      },
      grid: {
        vertLines: { color: "#0d0d0d" },
        horzLines: { color: "#0d0d0d" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#3b82f6", width: 1, labelBackgroundColor: "#1e3a5f" },
        horzLine: { color: "#3b82f6", width: 1, labelBackgroundColor: "#1e3a5f" },
      },
      rightPriceScale: {
        borderColor: "#131313",
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: "#131313",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
      },
      handleScale: { mouseWheel: true, pinch: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: "#3b82f6",
      topColor: "rgba(59, 130, 246, 0.20)",
      bottomColor: "rgba(59, 130, 246, 0.02)",
      lineWidth: 2,
      lineType: LineType.Curved,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 3,
      crosshairMarkerBorderColor: "#3b82f6",
      crosshairMarkerBackgroundColor: "#060606",
      priceFormat: {
        type: "custom",
        formatter: (price: number) => (price * 100).toFixed(1) + "¢",
      },
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // Click to set price
    if (onPriceClick) {
      chart.subscribeClick((param) => {
        if (param.point && seriesRef.current) {
          const price = series.coordinateToPrice(param.point.y);
          if (price !== null && price > 0 && price < 1) {
            onPriceClick(price as number);
          }
        }
      });
    }

    // Resize observer
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        chart.applyOptions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [onPriceClick]);

  // Update data — smooth by averaging nearby points
  useEffect(() => {
    if (!seriesRef.current) return;

    const raw = data.filter((p) => p.mid != null);
    if (raw.length === 0) return;

    // Moving average smoothing (window of 5 points)
    const smoothed: { time: import("lightweight-charts").UTCTimestamp; value: number }[] = [];
    const window = 5;
    for (let i = 0; i < raw.length; i++) {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - Math.floor(window / 2)); j <= Math.min(raw.length - 1, i + Math.floor(window / 2)); j++) {
        sum += raw[j].mid!;
        count++;
      }
      smoothed.push({
        time: raw[i].ts as unknown as import("lightweight-charts").UTCTimestamp,
        value: sum / count,
      });
    }

    seriesRef.current.setData(smoothed);
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  // Update bid/ask lines
  useEffect(() => {
    if (!seriesRef.current) return;

    // Remove old lines
    if (bidLineRef.current) {
      seriesRef.current.removePriceLine(bidLineRef.current);
      bidLineRef.current = null;
    }
    if (askLineRef.current) {
      seriesRef.current.removePriceLine(askLineRef.current);
      askLineRef.current = null;
    }

    if (bid != null) {
      bidLineRef.current = seriesRef.current.createPriceLine({
        price: bid,
        color: "#22c55e",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "Bid",
      });
    }

    if (ask != null) {
      askLineRef.current = seriesRef.current.createPriceLine({
        price: ask,
        color: "#ef4444",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "Ask",
      });
    }
  }, [bid, ask]);

  return (
    <div className="relative w-full h-full">
      {bracketLabel && (
        <div className="absolute top-2 left-2 z-10 text-[10px] text-neutral-500 bg-neutral-950/80 px-2 py-0.5 rounded">
          {bracketLabel} YES
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
