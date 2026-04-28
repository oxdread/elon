"use client";

import { useEffect, useState } from "react";

type Trade = {
  pseudonym: string;
  side: string;
  size: number;
  price: number;
  outcome: string;
  timestamp: number;
  profileImage?: string;
};

export default function TradeHistory({ conditionId, label, initialData }: { conditionId: string; label: string; initialData?: Trade[] | null }) {
  const [trades, setTrades] = useState<Trade[]>(initialData ?? []);
  const [loading, setLoading] = useState(!initialData);

  const managed = initialData !== undefined;

  useEffect(() => {
    if (initialData) { setTrades(initialData); setLoading(false); }
  }, [initialData]);

  useEffect(() => {
    if (managed) return;
    let active = true;
    const fetchTrades = async () => {
      try {
        const r = await fetch(`/api/public-trades?condition_id=${conditionId}&limit=30`, { cache: "no-store" });
        const d = await r.json();
        if (active && Array.isArray(d)) setTrades(d);
      } catch {}
      if (active) setLoading(false);
    };
    fetchTrades();
    const id = setInterval(fetchTrades, 5000);
    return () => { active = false; clearInterval(id); };
  }, [conditionId, managed]);

  if (loading) return <div className="px-3 py-3 text-[#808080] text-xs">Loading trades...</div>;

  const now = Math.floor(Date.now() / 1000);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center px-3 py-1.5 border-b border-[#1a1a1a]/40 shrink-0">
        <span className="text-[11px] text-[#808080] uppercase tracking-wider">Activity — {label}</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {trades.length === 0 ? (
          <div className="px-3 py-3 text-[#555555] text-xs">No recent trades</div>
        ) : (
          trades.map((t, i) => {
            const age = now - t.timestamp;
            const ageStr = age < 60 ? `${age}s` : age < 3600 ? `${Math.floor(age / 60)}m` : `${Math.floor(age / 3600)}h`;
            const isBuy = t.side === "BUY";
            const total = t.size * t.price;
            return (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5 border-b border-[#1a1a1a]/20 hover:bg-[#131313]/20">
                {/* Avatar */}
                <div className="w-5 h-5 rounded-full bg-neutral-700 shrink-0 overflow-hidden">
                  {t.profileImage && (
                    <img src={t.profileImage} alt="" className="w-full h-full object-cover" />
                  )}
                </div>
                {/* Trade info */}
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-[#e5e5e5] font-medium">{t.pseudonym || "Anon"}</span>
                  <span className="text-xs text-[#555555]"> {isBuy ? "bought" : "sold"} </span>
                  <span className={`text-xs font-bold ${isBuy ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
                    {Math.round(t.size)} {t.outcome}
                  </span>
                  <span className="text-xs text-[#555555]"> at </span>
                  <span className="text-xs text-[#e5e5e5]">{(t.price * 100).toFixed(1)}¢</span>
                  <span className="text-xs text-[#555555]"> (${total.toFixed(0)})</span>
                </div>
                {/* Time */}
                <span className="text-[10px] text-[#555555] shrink-0 tabular-nums">{ageStr} ago</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
