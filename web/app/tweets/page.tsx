"use client";

import { useEffect, useState } from "react";
import EventTabs from "../components/EventTabs";
import TweetHeatmap from "../components/TweetHeatmap";

type Event = { id: string; slug: string; title: string; start_date: string; end_date: string };
type Tweet = {
  id: string; ts: number; text: string;
  prices: { label: string; mid: number | null }[];
};

function defaultRange(): [string, string] {
  const now = new Date();
  const et = new Date(now.getTime() - 4 * 3600 * 1000);
  return [
    new Date(et.getTime() - 6 * 86400 * 1000).toISOString().slice(0, 10),
    et.toISOString().slice(0, 10),
  ];
}

export default function TweetsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [tweetCounts, setTweetCounts] = useState<Record<string, number>>({});
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [heatmapFrom, setHeatmapFrom] = useState("");
  const [heatmapTo, setHeatmapTo] = useState("");
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(0);

  useEffect(() => {
    setMounted(true);
    setNow(Math.floor(Date.now() / 1000));
    const [f, t] = defaultRange();
    setHeatmapFrom(f);
    setHeatmapTo(t);
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
        const r = await fetch("/api/tweets?limit=100", { cache: "no-store" });
        const d = await r.json();
        if (!d.error) setTweets(d.tweets ?? []);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  }, []);

  if (!mounted) return <div className="p-4 text-neutral-500">Loading...</div>;

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Event tabs */}
      <div className="px-4 py-3 border-b border-neutral-800/60">
        <EventTabs events={events} selectedEvent={selectedEvent} onSelect={setSelectedEvent} tweetCounts={tweetCounts} now={now} />
      </div>

      <div className="flex-1 p-4 space-y-4">
        {/* Heatmap */}
        <section className="rounded-xl border border-neutral-800/60 bg-neutral-900/30 p-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[10px] uppercase tracking-wider text-neutral-500">
              Tweets Per Hour <span className="text-neutral-600">(ET)</span>
            </h2>
            <div className="flex items-center gap-2">
              <input type="date" value={heatmapFrom} onChange={(e) => setHeatmapFrom(e.target.value)}
                className="bg-neutral-800 border border-neutral-700 rounded px-1.5 py-0.5 text-[10px] text-neutral-300 w-[110px]" />
              <span className="text-neutral-600 text-[10px]">to</span>
              <input type="date" value={heatmapTo} onChange={(e) => setHeatmapTo(e.target.value)}
                className="bg-neutral-800 border border-neutral-700 rounded px-1.5 py-0.5 text-[10px] text-neutral-300 w-[110px]" />
            </div>
          </div>
          {heatmapFrom && heatmapTo && <TweetHeatmap heatmapFrom={heatmapFrom} heatmapTo={heatmapTo} />}
        </section>

        {/* Tweet Log */}
        <section className="rounded-xl border border-neutral-800/60 bg-neutral-900/30 p-3">
          <h2 className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Tweet Log</h2>
          {tweets.length === 0 ? (
            <p className="text-neutral-600 text-xs">No tweets recorded yet.</p>
          ) : (
            <div className="space-y-1">
              {tweets.map((t, idx) => (
                <TweetRow key={t.id} tweet={t} number={tweets.length - idx} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function TweetRow({ tweet, number }: { tweet: Tweet; number: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-neutral-800/40 rounded px-2.5 py-1.5 hover:bg-neutral-800/20 cursor-pointer transition-colors"
      onClick={() => setExpanded(!expanded)}>
      <div className="flex items-center gap-2">
        <span className="text-blue-400 font-bold text-[10px] shrink-0 w-6">#{number}</span>
        <span className="text-neutral-600 text-[10px] shrink-0 w-16">{new Date(tweet.ts * 1000).toLocaleTimeString()}</span>
        <p className="text-neutral-300 text-xs truncate flex-1">{tweet.text}</p>
      </div>
      {expanded && (
        <div className="mt-1.5 pl-8">
          <p className="text-neutral-400 text-xs break-words mb-1">{tweet.text}</p>
          {tweet.prices.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tweet.prices.map((p) => (
                <span key={p.label} className="text-[10px] bg-neutral-800/60 px-1.5 py-0.5 rounded">
                  <span className="text-neutral-500">{p.label}:</span>{" "}
                  <span className="text-neutral-200 font-bold">{p.mid != null ? (p.mid * 100).toFixed(1) + "%" : "—"}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
