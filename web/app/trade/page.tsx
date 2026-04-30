"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import toast, { Toaster } from "react-hot-toast";
import {
  createChart, ColorType, LineType, AreaSeries, LineSeries,
  type IChartApi, type ISeriesApi, type SeriesType,
} from "lightweight-charts";
import { shortSlug, eventDurationDays } from "../components/EventTabs";
import OrderBook from "../components/OrderBook";
import TradeHistory from "../components/TradeHistory";
import TradingPanel from "../components/TradingPanel";
import { ChartShimmer, OrderbookShimmer, PanelShimmer } from "../components/Shimmer";
import Comments from "../components/Comments";

type Event = { id: string; slug: string; title: string; start_date: string; end_date: string };
type Bracket = {
  id: string; event_id: string; label: string; lower_bound: number; upper_bound: number;
  yes_token_id: string | null; no_token_id: string | null;
  mid: number | null; bid: number | null; ask: number | null;
};
type HistorySeries = { bracket: string; label: string; points: { ts: number; mid: number | null; trigger: string }[] };

const COLORS = [
  "#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa",
  "#fb923c", "#22d3ee", "#e879f9", "#4ade80", "#f87171",
  "#818cf8", "#facc15", "#2dd4bf", "#f97316", "#c084fc", "#38bdf8",
];

export default function TradePage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [allBrackets, setAllBrackets] = useState<Bracket[]>([]);
  const [tweetCounts, setTweetCounts] = useState<Record<string, number>>({});
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [selectedBracket, setSelectedBracket] = useState<string | null>(null);
  const [bottomTab, setBottomTab] = useState<"book" | "trades" | "comments">("book");
  const [history, setHistory] = useState<HistorySeries[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(0);
  const [limitPrice, setLimitPrice] = useState<number | null>(null);
  const [tradeOutcome, setTradeOutcome] = useState<"yes" | "no">("yes");
  const [tradeAction, setTradeAction] = useState<"buy" | "sell">("buy");
  const [tradeAmount, setTradeAmount] = useState<string>("");

  // Pre-fetch all bottom panel data so switching tabs is instant
  const [allOrderbooks, setAllOrderbooks] = useState<Record<string, { bids: unknown[]; asks: unknown[]; best_bid: number; best_ask: number }>>({});
  const [tradesData, setTradesData] = useState<unknown[] | null>(null);
  const [commentsData, setCommentsData] = useState<unknown[] | null>(null);
  const [tweetLog, setTweetLog] = useState<{ id: string; ts: number; text: string }[]>([]);
  const [leftTab, setLeftTab] = useState<"tweets" | "comments">("tweets");
  const [positionsData, setPositionsData] = useState<any[]>([]);
  const [openOrders, setOpenOrders] = useState<any[]>([]);
  const [posTab, setPosTab] = useState<"positions" | "orders" | "history">("positions");
  const prevTweetIdRef = useRef<string | null>(null);
  const wsConnectedRef = useRef(false);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<Map<string, ISeriesApi<SeriesType>>>(new Map());
  const prevSelectedRef = useRef<string | null>(null);
  const prevEventRef = useRef<string | null>(null);
  const isUserScaled = useRef(false);

  // Pre-load notification sound
  const notifyAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setMounted(true);
    setNow(Math.floor(Date.now() / 1000));
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  // WebSocket: instant tweet notifications
  useEffect(() => {
    if (!mounted) return;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      const wsUrl = typeof window !== "undefined"
        ? `ws://${window.location.hostname}:3001`
        : "ws://localhost:3001";
      ws = new WebSocket(wsUrl);

      ws.onopen = () => { wsConnectedRef.current = true; };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "tweet") {
            const tweet = { ...msg.data, ts: Math.floor(Date.now() / 1000) }; // Use local time for display
            setTweetLog((prev) => {
              if (prev.some((t) => t.id === tweet.id)) return prev;
              return [tweet, ...prev].slice(0, 50);
            });
            // Toast popup
            toast(
              (t) => (
                <div
                  className={`${t.visible ? "" : "opacity-0"} flex items-start gap-3`}
                  style={{ transition: "opacity 0.3s" }}
                >
                  <div className="w-8 h-8 rounded-full overflow-hidden shrink-0">
                    <img src="/elon.jpg" alt="" className="w-full h-full object-cover" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-[#3b82f6] mb-1">New Tweet from @elonmusk</div>
                    <p className="text-sm text-[#e5e5e5] leading-relaxed">{tweet.text?.slice(0, 200)}</p>
                    <div className="text-[10px] text-[#555555] mt-1">just now</div>
                  </div>
                </div>
              ),
              {
                duration: 6000,
                position: "bottom-right",
                style: {
                  background: "#141414",
                  border: "1px solid #252525",
                  borderRadius: "12px",
                  padding: "16px",
                  maxWidth: "380px",
                  boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
                },
              },
            );
            // Play sound
            try {
              if (notifyAudioRef.current) {
                notifyAudioRef.current.currentTime = 0;
                notifyAudioRef.current.play().catch(() => {});
              }
            } catch {}
          }
          // User channel: trade filled — apply instantly to positions
          if (msg.type === "trade_fill" && msg.data) {
            const { asset_id, side, size, price } = msg.data;
            if (asset_id && side && size) {
              const sz = parseFloat(size);
              const pr = parseFloat(price || 0);
              // Find bracket info for this token
              const bracket = allBrackets.find((b) => b.yes_token_id === asset_id || b.no_token_id === asset_id);
              setPositionsData((prev: any[]) => {
                const existing = prev.find((p) => p.asset === asset_id);
                if (side === "BUY") {
                  if (existing) {
                    const newSize = parseFloat(existing.size || 0) + sz;
                    return prev.map((p) => p.asset === asset_id
                      ? { ...p, size: String(newSize), currentValue: String(newSize * pr) }
                      : p
                    );
                  }
                  return [...prev, {
                    asset: asset_id, size: String(sz), curPrice: String(pr),
                    currentValue: String(sz * pr),
                    title: bracket?.label || "—",
                    conditionId: bracket?.id,
                    outcome: bracket?.yes_token_id === asset_id ? "Yes" : "No",
                  }];
                } else {
                  if (existing) {
                    const newSize = Math.max(0, parseFloat(existing.size || 0) - sz);
                    if (newSize <= 0) return prev.filter((p) => p.asset !== asset_id);
                    return prev.map((p) => p.asset === asset_id
                      ? { ...p, size: String(newSize), currentValue: String(newSize * pr) }
                      : p
                    );
                  }
                  return prev;
                }
              });
              // Notify TradingPanel toast
              window.dispatchEvent(new Event("ws-trade-fill"));
            }
          }
          // User channel: order placement/cancellation
          if (msg.type === "order_update" && msg.data) {
            window.dispatchEvent(new CustomEvent("ws-order-event", { detail: msg.data }));
          }
          // User channel: full account update from WS (on CONFIRMED — real data)
          if (msg.type === "account_update" && msg.data) {
            if (Array.isArray(msg.data.positions)) setPositionsData(msg.data.positions);
            if (Array.isArray(msg.data.open_orders)) setOpenOrders(msg.data.open_orders);
          }
        } catch {}
      };

      ws.onclose = () => {
        wsConnectedRef.current = false;
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [mounted]);

  useEffect(() => {
    const tick = async () => {
      try {
        const r = await fetch("/api/brackets", { cache: "no-store" });
        const d = await r.json();
        if (!d.error) {
          setEvents(d.events ?? []);
          setAllBrackets(d.brackets ?? []);
          setTweetCounts(d.tweet_counts ?? {});
          if (!selectedEvent && d.events?.length) setSelectedEvent(d.events[0].id);
        }
      } catch {}
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [selectedEvent]);

  // Load ALL bracket history once when event changes
  const fetchAllHistory = useCallback(async () => {
    if (!selectedEvent) return;
    setHistoryLoading(true);
    try {
      const r = await fetch(`/api/history?event_id=${selectedEvent}`, { cache: "no-store" });
      const d = await r.json();
      if (!d.error) setHistory(d.series ?? []);
    } catch {}
    setHistoryLoading(false);
  }, [selectedEvent]);

  useEffect(() => {
    fetchAllHistory();
    const id = setInterval(fetchAllHistory, 300000); // refresh every 5 min
    return () => clearInterval(id);
  }, [fetchAllHistory]);

  // Pre-fetch bottom panel data for all tabs in background
  const activeBracketForPanel = selectedBracket
    ? allBrackets.find((b) => b.id === selectedBracket)
    : (selectedEvent ? allBrackets.find((b) => b.event_id === selectedEvent) : null);

  // Wallet: initial load + fallback poll only when WS is disconnected
  useEffect(() => {
    const key = typeof window !== "undefined" ? localStorage.getItem("poly_private_key") : null;
    const funder = typeof window !== "undefined" ? localStorage.getItem("poly_funder") : null;
    if (!key || !funder) return;
    const fetchWallet = async () => {
      if (wsConnectedRef.current) return; // WS handles updates, skip poll
      try {
        const [posRes, ordRes] = await Promise.allSettled([
          fetch("/api/wallet", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ private_key: key, action: "positions", funder }) }).then(r => r.json()),
          fetch("/api/wallet", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ private_key: key, action: "orders", funder }) }).then(r => r.json()),
        ]);
        if (posRes.status === "fulfilled" && Array.isArray(posRes.value)) setPositionsData(posRes.value);
        if (ordRes.status === "fulfilled" && Array.isArray(ordRes.value)) setOpenOrders(ordRes.value);
      } catch {}
    };
    fetchWallet(); // initial load always runs
    const id = setInterval(fetchWallet, 10000);
    return () => clearInterval(id);
  }, [mounted]);

  useEffect(() => {
    if (!activeBracketForPanel) return;
    const tokenId = activeBracketForPanel.yes_token_id;
    const conditionId = activeBracketForPanel.id;

    const fetchOrderbooks = async () => {
      try {
        const res = await fetch("/api/orderbooks-all", { cache: "no-store" }).then((r) => r.json());
        if (res && !res.error) setAllOrderbooks(res);
      } catch {}
    };

    const fetchRest = async () => {
      // Fetch trades, comments, tweets in parallel
      const [tradesRes, commentsRes, tweetsRes] = await Promise.allSettled([
        fetch(`/api/public-trades?condition_id=${conditionId}&limit=30`, { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch("/api/comments?limit=30", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch("/api/tweets?limit=30", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      ]);

      if (tradesRes.status === "fulfilled" && Array.isArray(tradesRes.value)) setTradesData(tradesRes.value);
      if (commentsRes.status === "fulfilled" && Array.isArray(commentsRes.value)) setCommentsData(commentsRes.value);
      if (tweetsRes.status === "fulfilled" && tweetsRes.value?.tweets) {
        setTweetLog((prev) => {
          const dbTweets = tweetsRes.value.tweets;
          const dbIds = new Set(dbTweets.map((t: { id: string }) => t.id));
          const wsOnly = prev.filter((t) => !dbIds.has(t.id));
          return [...wsOnly, ...dbTweets].sort((a, b) => b.ts - a.ts).slice(0, 50);
        });
      }
    };

    fetchOrderbooks();
    fetchRest();
    const obId = setInterval(fetchOrderbooks, 1000);
    const restId = setInterval(fetchRest, 2000);
    return () => { clearInterval(obId); clearInterval(restId); };
  }, [activeBracketForPanel?.id, activeBracketForPanel?.yes_token_id]);

  // Create chart
  useEffect(() => {
    if (!mounted || !chartContainerRef.current || chartRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#0d0d0d" },
        textColor: "#555555",
        fontSize: 11,
        fontFamily: "ui-monospace, monospace",
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "#ffffff12", style: 3 },
      },
      crosshair: {
        vertLine: { color: "#ffffff20", width: 1, style: 0, labelBackgroundColor: "#1c1c1c" },
        horzLine: { color: "#ffffff20", width: 1, style: 2, labelBackgroundColor: "#3b82f6" },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.1, bottom: 0.05 },
      },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 5 },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: true } },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
    });
    chartRef.current = chart;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) chart.applyOptions({ width: e.contentRect.width, height: e.contentRect.height });
    });
    ro.observe(chartContainerRef.current);
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; seriesRefs.current.clear(); };
  }, [mounted]);

  // Update series
  const brackets = selectedEvent ? allBrackets.filter((b) => b.event_id === selectedEvent) : allBrackets;
  const eventBracketIds = new Set(brackets.map((b) => b.id));
  const allHistory = history.filter((s) => eventBracketIds.has(s.bracket));

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const bracketOrEventChanged = prevSelectedRef.current !== selectedBracket || prevEventRef.current !== selectedEvent;

    // Only rebuild series if bracket selection or event changed
    if (bracketOrEventChanged) {
      for (const [, s] of seriesRefs.current) {
        try { chart.removeSeries(s); } catch {}
      }
      seriesRefs.current.clear();
      isUserScaled.current = false;
    }

    const noSelection = !selectedBracket;

    // Always show only the selected bracket
    let seriesToRender = noSelection ? [] : allHistory.filter((h) => h.bracket === selectedBracket);

    for (const h of seriesToRender) {
      const idx = brackets.findIndex((b) => b.id === h.bracket);
      const label = brackets[idx]?.label ?? h.label;
      const rawPoints = h.points.filter((p) => p.mid != null)
        .map((p) => ({ time: p.ts, value: p.mid as number }));

      // Append live mid price as current hour point
      const liveBracket = brackets[idx];
      if (liveBracket?.mid != null) {
        const nowHour = Math.floor(Date.now() / 1000 / 3600) * 3600;
        const lastPoint = rawPoints[rawPoints.length - 1];
        if (lastPoint && lastPoint.time === nowHour) {
          lastPoint.value = liveBracket.mid; // update current hour
        } else {
          rawPoints.push({ time: nowHour, value: liveBracket.mid });
        }
      }

      if (rawPoints.length === 0) continue;

      // Monotone cubic interpolation (Fritsch-Carlson) — smooth without overshoot
      const interpolated: { time: number; value: number }[] = [];
      const n = rawPoints.length;
      if (n < 2) {
        interpolated.push(...rawPoints);
      } else {
        const dx: number[] = [], dy: number[] = [], m: number[] = [];
        for (let i = 0; i < n - 1; i++) {
          dx.push(rawPoints[i + 1].time - rawPoints[i].time);
          dy.push(rawPoints[i + 1].value - rawPoints[i].value);
          m.push(dy[i] / dx[i]);
        }
        const tg: number[] = [m[0]];
        for (let i = 1; i < n - 1; i++) {
          tg.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
        }
        tg.push(m[n - 2]);
        for (let i = 0; i < n - 1; i++) {
          if (Math.abs(m[i]) < 1e-10) { tg[i] = 0; tg[i + 1] = 0; }
          else {
            const a = tg[i] / m[i], b = tg[i + 1] / m[i];
            if (a * a + b * b > 9) { const s = 3 / Math.sqrt(a * a + b * b); tg[i] = s * a * m[i]; tg[i + 1] = s * b * m[i]; }
          }
        }
        for (let i = 0; i < n - 1; i++) {
          interpolated.push(rawPoints[i]);
          const h = dx[i];
          for (let s = 1; s <= 4; s++) {
            const t = s / 5, t2 = t * t, t3 = t2 * t;
            const v = (2*t3-3*t2+1)*rawPoints[i].value + (t3-2*t2+t)*h*tg[i] + (-2*t3+3*t2)*rawPoints[i+1].value + (t3-t2)*h*tg[i+1];
            interpolated.push({ time: Math.round(rawPoints[i].time + h * t), value: v });
          }
        }
        interpolated.push(rawPoints[n - 1]);
      }

      const points = interpolated.map((p) => ({
        time: p.time as unknown as import("lightweight-charts").UTCTimestamp,
        value: p.value,
      }));

      // If series exists, just update data
      const existing = seriesRefs.current.get(h.bracket);
      if (existing) {
        existing.setData(points);
        continue;
      }

      // Create new series
      const createSeries = (opts: Parameters<typeof chart.addSeries>[1], type: "area" | "line") => {
        const series = type === "area"
          ? chart.addSeries(AreaSeries, opts as Parameters<typeof chart.addSeries<"Area">>[1])
          : chart.addSeries(LineSeries, opts as Parameters<typeof chart.addSeries<"Line">>[1]);
        seriesRefs.current.set(h.bracket, series);
        series.setData(points);
      };

      // Always render as area (single bracket view)
      createSeries({
        lineColor: "#3b82f6",
        topColor: "rgba(59, 130, 246, 0.08)",
        bottomColor: "rgba(59, 130, 246, 0.0)",
        lineWidth: 2,
        lineType: LineType.Simple,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 5,
        crosshairMarkerBorderColor: "#3b82f6",
        crosshairMarkerBorderWidth: 2,
        crosshairMarkerBackgroundColor: "#0d0d0d",
        priceFormat: { type: "custom", formatter: (p: number) => (p * 100).toFixed(1) + "%" },
        lastValueVisible: true,
        priceLineVisible: false,
        title: label,
      }, "area");
    }

    if (bracketOrEventChanged) {
      try {
        const nowTs = Math.floor(Date.now() / 1000);
        chart.timeScale().setVisibleRange({
          from: (nowTs - 86400) as unknown as import("lightweight-charts").UTCTimestamp,
          to: nowTs as unknown as import("lightweight-charts").UTCTimestamp,
        });
      } catch {
        chart.timeScale().fitContent();
      }
      prevSelectedRef.current = selectedBracket;
      prevEventRef.current = selectedEvent;
    }
  }, [allHistory, selectedBracket, brackets, selectedEvent]);

  // Auto-select default bracket: nearest bracket with shares, or active bracket
  useEffect(() => {
    if (selectedBracket || !selectedEvent) return;
    const eventBrackets = allBrackets.filter((b) => b.event_id === selectedEvent);
    if (eventBrackets.length === 0) return;
    const currentCount = tweetCounts[selectedEvent] ?? 0;

    // 1. Find nearest bracket where user has shares
    if (positionsData.length > 0) {
      const tokenIds = new Set(positionsData.map((p) => p.asset));
      const withShares = eventBrackets.filter((b) => tokenIds.has(b.yes_token_id) || tokenIds.has(b.no_token_id));
      if (withShares.length > 0) {
        withShares.sort((a, b) => Math.abs(a.lower_bound - currentCount) - Math.abs(b.lower_bound - currentCount));
        setSelectedBracket(withShares[0].id);
        return;
      }
    }

    // 2. Fall back to active bracket
    const active = eventBrackets.find((b) => currentCount >= b.lower_bound && currentCount <= b.upper_bound);
    if (active) {
      setSelectedBracket(active.id);
      return;
    }

    // 3. Fall back to first bracket
    setSelectedBracket(eventBrackets[0].id);
  }, [selectedEvent, allBrackets, positionsData, tweetCounts, selectedBracket]);

  if (!mounted) return <div className="p-4 text-[#808080]">Loading...</div>;

  const currentTweetCount = selectedEvent ? (tweetCounts[selectedEvent] ?? 0) : 0;
  const activeBracket = brackets.find((b) => currentTweetCount >= b.lower_bound && currentTweetCount <= b.upper_bound);
  const selectedBracketData = brackets.find((b) => b.id === selectedBracket);
  const selectedEv = events.find((e) => e.id === selectedEvent);

  let timerStr = "";
  if (selectedEv?.end_date) {
    const remaining = Math.floor(new Date(selectedEv.end_date).getTime() / 1000) - now;
    if (remaining <= 0) timerStr = "ENDED";
    else {
      const d = Math.floor(remaining / 86400), h = Math.floor((remaining % 86400) / 3600), m = Math.floor((remaining % 3600) / 60);
      timerStr = (d > 0 ? `${d}d ` : "") + `${h}h ${m}m`;
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#060606] p-1 gap-1 relative">
      <audio ref={notifyAudioRef} src="/notify.wav" preload="auto" />
      <Toaster position="bottom-right" toastOptions={{ style: { background: "#141414", color: "#e5e5e5" } }} />
      {/* Main grid — no top bar */}
      <div className="flex-1 flex min-h-0 gap-2">

        {/* Left column: Market Stat + Bracket (stacked) */}
        <div className="w-60 flex flex-col shrink-0 gap-2">
          {/* Market Stat with event chooser */}
          <div className="bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] p-3 shrink-0">
            <select value={selectedEvent || ""} onChange={(e) => { setSelectedEvent(e.target.value); prevSelectedRef.current = "__reset__"; }}
              className="bg-transparent text-xs font-bold text-[#e5e5e5] appearance-none w-full cursor-pointer focus:outline-none mb-2 border-b border-[#1a1a1a] pb-2">
              {events.map((ev) => (
                <option key={ev.id} value={ev.id} className="bg-[#0d0d0d]">
                  {shortSlug(ev.slug)} ({eventDurationDays(ev) >= 5 ? "7d" : "2d"})
                </option>
              ))}
            </select>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <div className="text-[9px] text-[#555555]">Tweets</div>
                <div className="text-base font-bold text-[#3b82f6] tabular-nums">{currentTweetCount}</div>
              </div>
              <div>
                <div className="text-[9px] text-[#555555]">Active</div>
                <div className="text-[11px] font-bold text-[#e5e5e5]">{activeBracket?.label ?? "—"}</div>
              </div>
              <div>
                <div className="text-[9px] text-[#555555]">Ends</div>
                <div className={`text-[11px] font-bold tabular-nums ${timerStr === "ENDED" ? "text-rose-400" : "text-[#808080]"}`}>{timerStr || "—"}</div>
              </div>
            </div>
          </div>
          {/* Bracket list */}
          <div className="flex-1 bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] overflow-hidden flex flex-col min-h-0">
            <div className="flex items-center px-3 py-1.5 border-b border-[#1a1a1a] shrink-0">
              <span className="text-[10px] text-[#808080] uppercase tracking-wider flex-1">Brackets</span>
              <span className="text-[10px] text-[#555555] w-10 text-right">Mid</span>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-1">
              {brackets.map((b) => {
                const isActive = activeBracket?.id === b.id;
                const isSelected = selectedBracket === b.id;
                const isPast = b.upper_bound < currentTweetCount;
                const midPct = b.mid != null ? b.mid * 100 : 0;
                // Match positions to this bracket by token ID
                const yesPos = positionsData.find((p) => p.asset === b.yes_token_id);
                const noPos = positionsData.find((p) => p.asset === b.no_token_id);
                const yesShares = yesPos ? parseFloat(yesPos.size || 0) : 0;
                const noShares = noPos ? parseFloat(noPos.size || 0) : 0;
                const yesPrice = yesPos ? parseFloat(yesPos.curPrice || 0) : 0;
                const noPrice = noPos ? parseFloat(noPos.curPrice || 0) : 0;
                return (
                  <div key={b.id}
                    className={`rounded-lg px-3 py-2 cursor-pointer transition-colors
                      ${isSelected ? "bg-[#1a1a1a] border border-[#3b82f6]/30" : "bg-[#111111] border border-[#1a1a1a]/50 hover:bg-[#151515]"}`}
                    onClick={() => {
                      if (!isSelected) setSelectedBracket(b.id);
                    }}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[13px] font-bold ${isSelected ? "text-[#3b82f6]" : isActive ? "text-[#3b82f6]" : isPast ? "text-[#333333]" : "text-[#e5e5e5]"}`}>
                          {b.label}
                        </span>
                        {isActive && <span className="text-[7px] px-1 py-0.5 rounded-full bg-blue-500/15 text-blue-500/80">ACT</span>}
                      </div>
                      <span className={`text-[12px] tabular-nums font-semibold ${
                        b.mid == null ? "text-[#333333]" : midPct >= 20 ? "text-[#e5e5e5]" : "text-[#808080]"
                      }`}>
                        {b.mid != null ? midPct.toFixed(1) + "¢" : "—"}
                      </span>
                    </div>
                    {(yesShares > 0 || noShares > 0) && (
                      <div className="flex gap-1.5 mt-1.5">
                        {yesShares > 0 && (
                          <span className="text-[10px] font-medium text-[#0ecb81] bg-[#0ecb81]/10 border border-[#0ecb81]/20 rounded-full px-2 py-0.5 tabular-nums">
                            Yes {yesShares >= 1000 ? (yesShares / 1000).toFixed(1) + "k" : Math.round(yesShares).toLocaleString()} · {(yesPrice * 100).toFixed(1)}¢
                          </span>
                        )}
                        {noShares > 0 && (
                          <span className="text-[10px] font-medium text-[#f6465d] bg-[#f6465d]/10 border border-[#f6465d]/20 rounded-full px-2 py-0.5 tabular-nums">
                            No {noShares >= 1000 ? (noShares / 1000).toFixed(1) + "k" : Math.round(noShares).toLocaleString()} · {(noPrice * 100).toFixed(1)}¢
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Center area: Graph (top) + Elon Tweet & Comments/Trades (bottom) */}
        <div className="flex-1 flex flex-col min-w-0 gap-2">
          {/* Top row: Graph + Orderbook + Buy/Sell */}
          <div className="flex-1 flex min-h-0 gap-2">
            {/* Graph */}
            <div className="flex-1 min-w-0 bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] overflow-hidden relative">
              {historyLoading && history.length === 0 && <ChartShimmer />}
              <div ref={chartContainerRef} className="w-full h-full" />
              <div className="absolute top-2 right-2 z-10 flex gap-1">
                {[
                  { label: "1D", seconds: 86400 },
                  { label: "3D", seconds: 86400 * 3 },
                  { label: "1W", seconds: 86400 * 7 },
                  { label: "All", seconds: 0 },
                ].map((tf) => (
                  <button key={tf.label} onClick={() => {
                    const chart = chartRef.current;
                    if (!chart) return;
                    if (tf.seconds === 0) {
                      chart.timeScale().fitContent();
                    } else {
                      const n = Math.floor(Date.now() / 1000);
                      try { chart.timeScale().setVisibleRange({
                        from: (n - tf.seconds) as unknown as import("lightweight-charts").UTCTimestamp,
                        to: n as unknown as import("lightweight-charts").UTCTimestamp,
                      }); } catch {}
                    }
                  }}
                    className="px-2 py-0.5 rounded text-[9px] font-bold bg-[#131313] text-[#808080] hover:text-[#e5e5e5] hover:bg-[#222] transition-colors"
                  >{tf.label}</button>
                ))}
              </div>
            </div>

            {/* Orderbook — tall */}
            <div className="w-44 shrink-0 bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] overflow-hidden">
              {(() => {
                const bracket = selectedBracketData ?? brackets[0];
                if (!bracket) return <OrderbookShimmer />;
                const tokenId = tradeOutcome === "yes" ? bracket.yes_token_id : bracket.no_token_id;
                if (!tokenId) return <OrderbookShimmer />;
                const cachedBook = allOrderbooks[bracket.id];
                if (!cachedBook && Object.keys(allOrderbooks).length === 0) return <OrderbookShimmer />;
                return <OrderBook
                  tokenId={tokenId}
                  label={`${bracket.label} ${tradeOutcome.toUpperCase()}`}
                  initialData={cachedBook ? { bids: cachedBook.bids as any, asks: cachedBook.asks as any } : undefined}
                  outcome={tradeOutcome}
                  openOrders={openOrders}
                  onClickOrder={(side, price, size) => {
                    setTradeAction(side);
                    setLimitPrice(price);
                    setTradeAmount(String(Math.round(size)));
                  }}
                />;
              })()}
            </div>

            {/* Buy/Sell */}
            <div className="w-64 shrink-0 bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] overflow-hidden">
              <TradingPanel
                bracket={selectedBracketData ?? null}
                limitPrice={limitPrice}
                initialAction={tradeAction}
                initialAmount={tradeAmount}
                onOutcomeChange={setTradeOutcome}
              />
            </div>
          </div>

          {/* Bottom row: Elon Tweet | Comments/Trades | Position/Orders */}
          <div className="h-52 flex gap-2 shrink-0">
            {/* Elon Tweet */}
            <div className="flex-1 bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] overflow-hidden flex flex-col">
              <div className="px-3 py-1.5 border-b border-[#1a1a1a] shrink-0 flex items-center gap-2">
                <span className="text-[10px] text-[#808080] uppercase tracking-wider">Elon Tweets</span>
                <span className="text-[10px] text-[#3b82f6] font-bold ml-auto">{tweetLog.length}</span>
              </div>
              <div className="flex-1 overflow-y-auto">
                {tweetLog.length === 0 ? (
                  <PanelShimmer rows={4} />
                ) : (
                  tweetLog.map((t, i) => {
                    const age = Math.floor(Date.now() / 1000) - t.ts;
                    const ageStr = age < 60 ? `${age}s ago` : age < 3600 ? `${Math.floor(age / 60)}m ago` : age < 86400 ? `${Math.floor(age / 3600)}h ago` : `${Math.floor(age / 86400)}d ago`;
                    return (
                      <div key={t.id} className="px-3 py-2 border-b border-[#1a1a1a]/40 hover:bg-[#131313] transition-colors">
                        <div className="flex gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-[#1a1a1a] shrink-0 overflow-hidden">
                            <img src="/elon.jpg" alt="Elon" className="w-full h-full object-cover" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-xs font-bold text-[#e5e5e5]">Elon Musk</span>
                              <span className="text-[10px] text-[#555555]">@elonmusk</span>
                              <span className="text-[10px] text-[#555555] ml-auto">{ageStr}</span>
                            </div>
                            <p className="text-xs text-[#b0b0b0] leading-relaxed break-words">{t.text}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Poly Comments or Trades */}
            <div className="flex-1 bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] overflow-hidden flex flex-col">
              <div className="flex border-b border-[#1a1a1a] shrink-0">
                <button onClick={() => setBottomTab("comments")}
                  className={`flex-1 py-1.5 text-[10px] font-bold uppercase ${bottomTab === "comments" ? "text-[#3b82f6] border-b-2 border-[#3b82f6]" : "text-[#555555]"}`}>Comments</button>
                <button onClick={() => setBottomTab("trades")}
                  className={`flex-1 py-1.5 text-[10px] font-bold uppercase ${bottomTab === "trades" ? "text-[#3b82f6] border-b-2 border-[#3b82f6]" : "text-[#555555]"}`}>Trades</button>
              </div>
              <div className="flex-1 min-h-0">
                {bottomTab === "comments"
                  ? <Comments initialData={commentsData as any} />
                  : (() => {
                      const bracket = selectedBracketData ?? brackets[0];
                      if (!bracket) return <div className="p-3 text-[#555555] text-xs">—</div>;
                      return <TradeHistory conditionId={bracket.id} label={bracket.label} initialData={tradesData as any} />;
                    })()
                }
              </div>
            </div>

            {/* Position / Order History / Open Orders */}
            <div className="flex-1 bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] overflow-hidden flex flex-col">
              <div className="flex border-b border-[#1a1a1a] shrink-0">
                {(["positions", "orders", "history"] as const).map((t) => (
                  <button key={t} onClick={() => setPosTab(t)}
                    className={`flex-1 py-1.5 text-[10px] font-bold uppercase ${
                      posTab === t ? "text-[#3b82f6] border-b-2 border-[#3b82f6]" : "text-[#555555]"
                    }`}>{t === "positions" ? "Positions" : t === "orders" ? "Open Orders" : "History"}</button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto">
                {posTab === "positions" ? (
                  (() => {
                    const active = positionsData.filter((p) => {
                      const cv = parseFloat(p.currentValue || 0);
                      return cv > 0;
                    });
                    return active.length === 0 ? (
                      <div className="p-3 text-[#555555] text-xs">No active positions</div>
                    ) : (
                      active.map((p, i) => (
                      <div key={i} className="flex items-center px-3 py-1.5 border-b border-[#1a1a1a]/40 text-[11px]">
                        <div className="flex-1 min-w-0">
                          <span className="text-[#e5e5e5] font-medium">{p.title?.slice(0, 30) || p.conditionId?.slice(0, 10) || "—"}</span>
                          <span className="ml-1 text-[#555555]">{p.outcome || ""}</span>
                        </div>
                        <div className="text-right shrink-0 w-16">
                          <div className="text-[#e5e5e5] tabular-nums">{parseFloat(p.size || 0).toFixed(1)}</div>
                          <div className="text-[9px] text-[#555555]">shares</div>
                        </div>
                        <div className="text-right shrink-0 w-16">
                          <div className={`tabular-nums font-medium ${(p.cashPnl || 0) >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
                            ${parseFloat(p.cashPnl || 0).toFixed(2)}
                          </div>
                          <div className={`text-[9px] tabular-nums ${(p.percentPnl || 0) >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
                            {parseFloat(p.percentPnl || 0).toFixed(1)}%
                          </div>
                        </div>
                      </div>
                    ))
                    );
                  })()
                ) : posTab === "orders" ? (
                  openOrders.length === 0 ? (
                    <div className="p-3 text-[#555555] text-xs">No open orders</div>
                  ) : (
                    openOrders.map((o, i) => {
                      const bracket = allBrackets.find((b) => b.yes_token_id === o.asset_id || b.no_token_id === o.asset_id);
                      const priceCents = parseFloat(o.price || 0) * 100;
                      const origSize = parseFloat(o.original_size || o.size || 0);
                      const filledSize = origSize - parseFloat(o.size_matched || 0);
                      const ts = parseInt(o.timestamp || "0");
                      const age = ts ? Math.floor(Date.now() / 1000) - Math.floor(ts / 1000) : 0;
                      const ageStr = age < 60 ? `${age}s` : age < 3600 ? `${Math.floor(age / 60)}m` : `${Math.floor(age / 3600)}h`;
                      return (
                        <div key={o.id || i} className="flex items-center px-3 py-2 border-b border-[#1a1a1a]/40 text-[11px] gap-2">
                          <span className={`font-bold w-8 ${o.side === "BUY" ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>{o.side}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-[#e5e5e5] font-medium truncate">{bracket?.label || "—"}</div>
                            <div className="text-[#555555] text-[10px]">
                              {origSize.toFixed(1)} shares @ {priceCents.toFixed(1)}¢
                            </div>
                          </div>
                          <span className="text-[#555555] text-[10px] shrink-0">{ageStr}</span>
                          <button
                            className="text-[#f6465d] hover:text-red-400 text-[10px] font-bold px-1.5 py-0.5 rounded hover:bg-[#f6465d]/10 transition-colors shrink-0"
                            onClick={async (e) => {
                              e.stopPropagation();
                              const key = localStorage.getItem("poly_private_key");
                              if (!key || !o.id) return;
                              const btn = e.currentTarget;
                              btn.textContent = "...";
                              try {
                                const r = await fetch("/api/trade", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ private_key: key, action: "cancel", order_id: o.id }),
                                });
                                const d = await r.json();
                                if (d.status === "ok") {
                                  setOpenOrders((prev) => prev.filter((x) => x.id !== o.id));
                                }
                              } catch {}
                              btn.textContent = "Cancel";
                            }}
                          >Cancel</button>
                        </div>
                      );
                    })
                  )
                ) : (
                  (() => {
                    // Fetch trade history from pre-fetched wallet data
                    const key = typeof window !== "undefined" ? localStorage.getItem("poly_private_key") : null;
                    if (!key) return <div className="p-3 text-[#555555] text-xs">Import key to view history</div>;
                    return <TradeHistoryPanel privateKey={key} />;
                  })()
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col leading-none">
      <span className="text-[9px] text-[#555555] uppercase">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${color}`}>{value}</span>
    </div>
  );
}

function TradeHistoryPanel({ privateKey }: { privateKey: string }) {
  const [trades, setTrades] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTrades = async () => {
      try {
        const r = await fetch("/api/wallet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ private_key: privateKey, action: "trades" }),
        });
        const d = await r.json();
        if (Array.isArray(d)) setTrades(d);
      } catch {}
      setLoading(false);
    };
    fetchTrades();
  }, [privateKey]);

  if (loading) return <div className="p-3 text-[#555555] text-xs">Loading...</div>;
  if (trades.length === 0) return <div className="p-3 text-[#555555] text-xs">No trades</div>;

  return (
    <>
      {trades.slice(0, 20).map((t, i) => {
        const ts = parseInt(t.match_time || "0");
        const date = ts ? new Date(ts * 1000).toLocaleDateString([], { month: "short", day: "numeric" }) : "—";
        return (
          <div key={i} className="flex items-center px-3 py-1.5 border-b border-[#1a1a1a]/40 text-[11px]">
            <span className={`font-bold w-8 ${t.side === "BUY" ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>{t.side}</span>
            <span className="text-[#e5e5e5] tabular-nums w-12">{parseFloat(t.size || 0).toFixed(1)}</span>
            <span className="text-[#555555] mx-1">@</span>
            <span className="text-[#e5e5e5] tabular-nums w-10">{parseFloat(t.price || 0).toFixed(2)}</span>
            <span className="text-[#808080] ml-2 flex-1 truncate">{t.outcome || ""}</span>
            <span className="text-[#555555] text-[10px]">{date}</span>
          </div>
        );
      })}
    </>
  );
}
