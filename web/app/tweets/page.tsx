"use client";

import { useEffect, useState } from "react";
import { shortSlug, eventDurationDays } from "../components/EventTabs";
import TweetHeatmap from "../components/TweetHeatmap";
import Comments from "../components/Comments";

type Event = { id: string; slug: string; title: string; start_date: string; end_date: string };
type Tweet = { id: string; ts: number; text: string };

export default function TweetsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [tweetCounts, setTweetCounts] = useState<Record<string, number>>({});
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [commentsData, setCommentsData] = useState<unknown[] | null>(null);
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
        const [tRes, cRes] = await Promise.allSettled([
          fetch("/api/tweets?limit=50", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/comments?limit=30", { cache: "no-store" }).then((r) => r.json()),
        ]);
        if (tRes.status === "fulfilled" && !tRes.value.error) setTweets(tRes.value.tweets ?? []);
        if (cRes.status === "fulfilled" && Array.isArray(cRes.value)) setCommentsData(cRes.value);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  }, []);

  if (!mounted) return <div className="p-4 text-[#555555]">Loading...</div>;

  const selectedEv = events.find((e) => e.id === selectedEvent);
  const currentCount = selectedEvent ? (tweetCounts[selectedEvent] ?? 0) : 0;

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

  const toDate = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);

  return (
    <div className="h-full bg-[#060606] flex flex-col p-2 gap-2 overflow-hidden">

        {/* Top bar */}
        <div className="flex gap-2 shrink-0">
          {/* Analytics — matches left(38%) + middle(40%) */}
          <div style={{ width: "calc(78% + 4px)" }} className="shrink-0 bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] px-4 py-3">
            <div className="flex items-center gap-3">
              <select value={selectedEvent || ""} onChange={(e) => setSelectedEvent(e.target.value)}
                className="bg-[#111] border border-[#1a1a1a]/50 rounded-lg px-3 py-2 text-sm font-bold text-[#e5e5e5] cursor-pointer shrink-0">
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id} className="bg-[#0d0d0d]">
                    {shortSlug(ev.slug)} ({eventDurationDays(ev) >= 5 ? "7d" : "2d"})
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-2 flex-1">
                <StatCard label="Total Tweets" value={String(currentCount)} color="text-[#3b82f6]" />
                <StatCard label="Daily Avg" value={dailyAvg} color="text-[#0ecb81]" />
                <StatCard label="Per Hour" value={hourlyAvg} color="text-[#fbbf24]" />
                <StatCard label="Ends In" value={timerStr || "—"} color={timerStr === "ENDED" ? "text-[#f6465d]" : "text-[#808080]"} />
              </div>
            </div>
          </div>
          {/* Donation — matches right(22%) */}
          <div className="flex-1 bg-gradient-to-r from-[#0d0d0d] to-[#3b82f6]/5 rounded-lg border border-[#1a1a1a] px-3 py-2.5 flex flex-col justify-center">
            <div className="text-[11px] font-bold text-[#e5e5e5] mb-1.5">Support This Project</div>
            <div className="flex items-center gap-1.5">
              <div className="flex-1 bg-[#0a0a0a] rounded-md px-2 py-1 text-[9px] text-[#555555] font-mono truncate border border-[#1a1a1a]/50">0x...donate</div>
              <button className="px-2 py-1 rounded-md text-[9px] font-bold bg-[#3b82f6] text-white hover:bg-blue-500 transition-colors shrink-0">Copy</button>
            </div>
          </div>
        </div>

        {/* Main 3-column layout */}
        <div className="flex-1 flex gap-2 min-h-0">

          {/* Left: Tweets Activity */}
          <div className="w-[38%] shrink-0 bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] flex flex-col overflow-hidden">
            <div className="px-3 py-2 border-b border-[#1a1a1a] shrink-0 flex items-center justify-between">
              <span className="text-xs font-bold text-[#e5e5e5]">Tweets Activity</span>
              <span className="text-[10px] text-[#555555]">Last 7 days (ET)</span>
            </div>
            <div className="flex-1 p-1 overflow-hidden flex flex-col">
              <TweetHeatmap heatmapFrom={fromDate} heatmapTo={toDate} compact />
            </div>
          </div>

          {/* Middle: Post History + Wallet */}
          <div className="w-[40%] shrink-0 flex flex-col gap-2 min-w-0">
            {/* Elon Post History — 55% */}
            <div className="flex-[6] bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] flex flex-col overflow-hidden min-h-0">
              <div className="px-3 py-2 border-b border-[#1a1a1a] shrink-0 flex items-center justify-between">
                <span className="text-xs font-bold text-[#e5e5e5]">Elon Post History</span>
                <span className="text-[10px] text-[#555555]">{tweets.length} posts</span>
              </div>
              <div className="flex-1 overflow-y-auto p-1.5">
                {tweets.length === 0 ? (
                  <div className="p-4 text-[#555555] text-xs text-center">No tweets yet</div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {tweets.map((t) => {
                      const age = now - t.ts;
                      const ageStr = age < 60 ? `${age}s` : age < 3600 ? `${Math.floor(age / 60)}m` : age < 86400 ? `${Math.floor(age / 3600)}h` : `${Math.floor(age / 86400)}d`;
                      return (
                        <div key={t.id} className="flex gap-2.5 px-3 py-2 rounded-lg bg-[#111111] border border-[#1a1a1a]/40 hover:bg-[#141414] transition-colors">
                          <div className="w-8 h-8 rounded-full bg-[#1a1a1a] shrink-0 overflow-hidden">
                            <img src="/elon.jpg" alt="" className="w-full h-full object-cover" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-xs font-bold text-[#e5e5e5]">Elon Musk</span>
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

            {/* Top Wallet Tracker — 45% */}
            <div className="flex-[4] bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] flex flex-col overflow-hidden min-h-0">
              <div className="px-3 py-2 border-b border-[#1a1a1a] shrink-0">
                <span className="text-xs font-bold text-[#e5e5e5]">Top Wallet Tracker</span>
              </div>
              <div className="px-3 py-2 border-b border-[#1a1a1a]/40 shrink-0">
                <div className="flex gap-1.5">
                  <input type="text" value={walletInput} onChange={(e) => setWalletInput(e.target.value)}
                    placeholder="0x... wallet address"
                    className="flex-1 bg-[#0a0a0a] border border-[#1a1a1a]/50 rounded-md px-2.5 py-1.5 text-[11px] text-[#e5e5e5] font-mono focus:outline-none focus:border-[#3b82f6]/50" />
                  <button onClick={() => {
                    if (walletInput.trim() && !trackedWallets.includes(walletInput.trim())) {
                      setTrackedWallets((prev) => [...prev, walletInput.trim()]);
                      setWalletInput("");
                    }
                  }} className="px-3 py-1.5 rounded-md text-[10px] font-bold bg-[#3b82f6] text-white hover:bg-blue-500 transition-colors shrink-0">
                    Track
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {trackedWallets.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-[#555555] text-xs">
                    Add wallet addresses to track their trades
                  </div>
                ) : (
                  <div className="p-1.5 flex flex-col gap-1">
                    {trackedWallets.map((w, i) => (
                      <div key={i} className="flex items-center px-3 py-2 rounded-lg bg-[#111111] border border-[#1a1a1a]/40 text-[11px]">
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#3b82f6]/30 to-[#0ecb81]/30 flex items-center justify-center text-[9px] font-bold text-[#808080] shrink-0">
                          {i + 1}
                        </div>
                        <span className="text-[#3b82f6] font-mono ml-2">{w.slice(0, 6)}...{w.slice(-4)}</span>
                        <span className="text-[#555555] ml-auto">No trades yet</span>
                        <button onClick={() => setTrackedWallets((prev) => prev.filter((_, j) => j !== i))}
                          className="text-[#f6465d] ml-2 hover:text-red-400 text-xs">×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right: Comments + News + Flight */}
          <div className="w-[22%] shrink-0 flex flex-col gap-2">
            {/* Polymarket Comments */}
            <div className="flex-1 bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] flex flex-col overflow-hidden min-h-0">
              <div className="px-3 py-2 border-b border-[#1a1a1a] shrink-0">
                <span className="text-xs font-bold text-[#e5e5e5]">Polymarket Comments</span>
              </div>
              <div className="flex-1 overflow-y-auto">
                <Comments initialData={commentsData as any} />
              </div>
            </div>

            {/* Elon News */}
            <div className="flex-1 bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] flex flex-col overflow-hidden min-h-0">
              <div className="px-3 py-2 border-b border-[#1a1a1a] shrink-0">
                <span className="text-xs font-bold text-[#e5e5e5]">Elon News</span>
              </div>
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-2xl mb-1 text-[#1a1a1a]">&#128240;</div>
                  <div className="text-[11px] text-[#555555]">Coming soon</div>
                </div>
              </div>
            </div>

            {/* Flight Tracker */}
            <div className="flex-1 bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] flex flex-col overflow-hidden min-h-0">
              <div className="px-3 py-2 border-b border-[#1a1a1a] shrink-0">
                <span className="text-xs font-bold text-[#e5e5e5]">Flight Tracker</span>
              </div>
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-2xl mb-1 text-[#1a1a1a]">&#9992;</div>
                  <div className="text-[11px] text-[#555555]">Coming soon</div>
                </div>
              </div>
            </div>
          </div>
        </div>

    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex-1 bg-[#111] rounded-lg border border-[#1a1a1a]/50 px-3 py-2">
      <div className="text-[8px] text-[#555555] uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
