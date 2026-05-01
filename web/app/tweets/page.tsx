"use client";

import { useEffect, useState } from "react";
import { shortSlug, eventDurationDays } from "../components/EventTabs";
import TweetHeatmap from "../components/TweetHeatmap";

type Event = { id: string; slug: string; title: string; start_date: string; end_date: string };
type Tweet = { id: string; ts: number; text: string };

export default function TweetsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [tweetCounts, setTweetCounts] = useState<Record<string, number>>({});
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(0);
  const [trackedWallets, setTrackedWallets] = useState<string[]>([]);
  const [walletInput, setWalletInput] = useState("");

  useEffect(() => {
    setMounted(true);
    setNow(Math.floor(Date.now() / 1000));
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const tick = async () => {
      try {
        const r = await fetch("/api/brackets", { cache: "no-store" });
        const d = await r.json();
        if (!d.error) {
          setEvents(d.events ?? []);
          setTweetCounts(d.tweet_counts ?? {});
          if (!selectedEvent && d.events?.length) setSelectedEvent(d.events[0].id);
        }
      } catch {}
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [selectedEvent]);

  useEffect(() => {
    const tick = async () => {
      try {
        const r = await fetch("/api/tweets?limit=50", { cache: "no-store" });
        const d = await r.json();
        if (!d.error) setTweets(d.tweets ?? []);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  }, []);

  if (!mounted) return <div className="p-4 text-[#555555]">Loading...</div>;

  const selectedEv = events.find((e) => e.id === selectedEvent);
  const currentCount = selectedEvent ? (tweetCounts[selectedEvent] ?? 0) : 0;

  // Calculate stats
  let daysElapsed = 0;
  if (selectedEv?.start_date) {
    daysElapsed = Math.max(1, (now - Math.floor(new Date(selectedEv.start_date).getTime() / 1000)) / 86400);
  }
  const dailyAvg = daysElapsed > 0 ? (currentCount / daysElapsed).toFixed(1) : "0";
  const hourlyAvg = daysElapsed > 0 ? (currentCount / (daysElapsed * 24)).toFixed(1) : "0";

  let timerStr = "";
  if (selectedEv?.end_date) {
    const remaining = Math.floor(new Date(selectedEv.end_date).getTime() / 1000) - now;
    if (remaining <= 0) timerStr = "ENDED";
    else {
      const d = Math.floor(remaining / 86400), h = Math.floor((remaining % 86400) / 3600), m = Math.floor((remaining % 3600) / 60);
      timerStr = (d > 0 ? `${d}d ` : "") + `${h}h ${m}m`;
    }
  }

  // Heatmap date range — last 7 days
  const toDate = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);

  return (
    <div className="flex flex-col h-full bg-[#060606]">
      {/* Event selector — compact */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[#1a1a1a] shrink-0 overflow-x-auto">
        {events.map((ev) => (
          <button key={ev.id} onClick={() => setSelectedEvent(ev.id)}
            className={`px-3 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors ${
              selectedEvent === ev.id ? "bg-[#1a1a1a] text-[#e5e5e5]" : "text-[#555555] hover:text-[#808080]"
            }`}>
            {shortSlug(ev.slug)} ({eventDurationDays(ev) >= 5 ? "7d" : "2d"})
          </button>
        ))}
      </div>

      {/* Main content */}
      <div className="flex-1 flex min-h-0 gap-2 p-2">
        {/* Left: Stats + Heatmap (40%) */}
        <div className="w-[40%] flex flex-col gap-2 shrink-0">
          {/* Stats cards */}
          <div className="grid grid-cols-2 gap-1.5">
            <StatCard label="Tweets" value={String(currentCount)} color="text-[#3b82f6]" />
            <StatCard label="Daily Avg" value={dailyAvg} color="text-[#0ecb81]" />
            <StatCard label="Per Hour" value={hourlyAvg} color="text-[#fbbf24]" />
            <StatCard label="Ends" value={timerStr || "—"} color={timerStr === "ENDED" ? "text-[#f6465d]" : "text-[#808080]"} />
          </div>

          {/* Active bracket */}
          {selectedEv && (
            <div className="bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] px-3 py-2">
              <div className="text-[10px] text-[#555555] mb-0.5">Event</div>
              <div className="text-xs font-bold text-[#e5e5e5]">{shortSlug(selectedEv.slug)}</div>
            </div>
          )}

          {/* Heatmap — compact */}
          <div className="flex-1 bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] p-2 overflow-auto min-h-0">
            <div className="text-[10px] text-[#555555] uppercase tracking-wider mb-1.5">Tweets Per Hour (ET)</div>
            <TweetHeatmap heatmapFrom={fromDate} heatmapTo={toDate} />
          </div>
        </div>

        {/* Right: Post History + Top Traders (60%) */}
        <div className="flex-1 flex flex-col gap-2 min-w-0">
          {/* Post History */}
          <div className="flex-1 bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] overflow-hidden flex flex-col min-h-0">
            <div className="px-3 py-1.5 border-b border-[#1a1a1a] shrink-0">
              <span className="text-[10px] text-[#555555] uppercase tracking-wider">Post History</span>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5">
              {tweets.length === 0 ? (
                <div className="p-3 text-[#555555] text-xs">No tweets yet</div>
              ) : (
                <div className="flex flex-col gap-1">
                  {tweets.map((t) => {
                    const age = now - t.ts;
                    const ageStr = age < 60 ? `${age}s` : age < 3600 ? `${Math.floor(age / 60)}m` : age < 86400 ? `${Math.floor(age / 3600)}h` : `${Math.floor(age / 86400)}d`;
                    return (
                      <div key={t.id} className="flex gap-2 px-2.5 py-2 rounded-lg bg-[#111111] border border-[#1a1a1a]/50 hover:bg-[#141414] transition-colors">
                        <div className="w-7 h-7 rounded-full bg-[#1a1a1a] shrink-0 overflow-hidden">
                          <img src="/elon.jpg" alt="" className="w-full h-full object-cover" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-[11px] font-bold text-[#e5e5e5]">Elon Musk</span>
                            <span className="text-[10px] text-[#555555] ml-auto">{ageStr} ago</span>
                          </div>
                          <p className="text-[11px] text-[#b0b0b0] leading-relaxed break-words">{t.text}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Top Traders — shell */}
          <div className="h-48 bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] overflow-hidden flex flex-col shrink-0">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1a1a1a] shrink-0">
              <span className="text-[10px] text-[#555555] uppercase tracking-wider">Top Traders</span>
            </div>
            <div className="px-3 py-2 border-b border-[#1a1a1a]/40 shrink-0">
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={walletInput}
                  onChange={(e) => setWalletInput(e.target.value)}
                  placeholder="0x... wallet address"
                  className="flex-1 bg-[#0a0a0a] border border-[#1a1a1a]/50 rounded-md px-2 py-1 text-[11px] text-[#e5e5e5] focus:outline-none focus:border-[#3b82f6]/50"
                />
                <button onClick={() => {
                  if (walletInput.trim() && !trackedWallets.includes(walletInput.trim())) {
                    setTrackedWallets((prev) => [...prev, walletInput.trim()]);
                    setWalletInput("");
                  }
                }}
                  className="px-2.5 py-1 rounded-md text-[10px] font-medium bg-[#3b82f6] text-white hover:bg-blue-500 transition-colors">
                  Track
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {trackedWallets.length === 0 ? (
                <div className="p-3 text-[#555555] text-xs text-center">Add wallet addresses to track their trades</div>
              ) : (
                <div className="p-1.5 flex flex-col gap-1">
                  {trackedWallets.map((w, i) => (
                    <div key={i} className="flex items-center px-2.5 py-1.5 rounded-md bg-[#111111] border border-[#1a1a1a]/50 text-[11px]">
                      <span className="text-[#3b82f6] font-mono">{w.slice(0, 6)}...{w.slice(-4)}</span>
                      <span className="text-[#555555] ml-auto">No trades yet</span>
                      <button onClick={() => setTrackedWallets((prev) => prev.filter((_, j) => j !== i))}
                        className="text-[#f6465d] ml-2 text-[9px] hover:text-red-400">x</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] px-3 py-2">
      <div className="text-[9px] text-[#555555] uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
