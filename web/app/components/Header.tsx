"use client";

import { useEffect, useState } from "react";

type Status = {
  ws_connected: number;
  twitter_connected: number;
  events_count: number;
  brackets_count: number;
  last_poll_ts: number | null;
};

export default function Header() {
  const [status, setStatus] = useState<Status | null>(null);
  const [now, setNow] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [hasWallet, setHasWallet] = useState(false);
  const [walletAddr, setWalletAddr] = useState<string | null>(null);
  const [cash, setCash] = useState<string | null>(null);
  const [portfolio, setPortfolio] = useState<number | null>(null);

  useEffect(() => {
    setMounted(true);
    setNow(Math.floor(Date.now() / 1000));
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  // Fetch collector status
  useEffect(() => {
    const tick = async () => {
      try {
        const r = await fetch("/api/status", { cache: "no-store" });
        const d = await r.json();
        if (d.collector) setStatus(d.collector);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, []);

  // Wallet: initial load, then WS account_update takes over
  useEffect(() => {
    const key = localStorage.getItem("poly_private_key");
    const funder = localStorage.getItem("poly_funder");
    if (!key) { setHasWallet(false); return; }
    setHasWallet(true);
    setWalletAddr(funder);

    // One-time initial fetch
    (async () => {
      try {
        const balRes = await fetch("/api/wallet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ private_key: key, action: "balance", funder: funder || "" }),
        });
        const bal = await balRes.json();
        if (!bal.error) setCash(bal.balance);

        if (funder) {
          const valRes = await fetch(`https://data-api.polymarket.com/value?user=${funder}`);
          const valData = await valRes.json();
          if (Array.isArray(valData) && valData[0]) setPortfolio(valData[0].value);
        }
      } catch {}
    })();

    // Listen for WS account_update pushed by user_feed.py
    const wsUrl = typeof window !== "undefined"
      ? `ws://${window.location.hostname}:3001`
      : "ws://localhost:3001";
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "account_update" && msg.data) {
            if (msg.data.balance) setCash(msg.data.balance);
            if (msg.data.portfolio_value != null) setPortfolio(msg.data.portfolio_value);
          }
        } catch {}
      };
      ws.onclose = () => { reconnectTimer = setTimeout(connect, 3000); };
      ws.onerror = () => { ws?.close(); };
    };
    connect();

    return () => { clearTimeout(reconnectTimer); ws?.close(); };
  }, []);

  const statusAge = mounted && status?.last_poll_ts ? now - status.last_poll_ts : null;
  const fresh = statusAge != null && statusAge < 120;

  // Format cash (USDC has 6 decimals)
  const cashDisplay = cash != null ? `$${(parseFloat(cash) / 1e6).toFixed(2)}` : "—";
  const portfolioDisplay = portfolio != null ? `$${portfolio.toFixed(2)}` : "—";

  return (
    <header className="flex items-center h-12 px-4 border-b border-[#1a1a1a] bg-[#060606] shrink-0">
      <div className="flex items-center gap-3 ml-auto">
        <Dot on={status?.ws_connected === 1} label="CLOB" />
        <Dot on={status?.twitter_connected === 1} label="X API" />
        <span className={`text-[10px] tabular-nums ${fresh ? "text-[#0ecb81]" : "text-[#555555]"}`}>
          {mounted ? (fresh ? `${statusAge}s ago` : statusAge != null ? `${statusAge}s` : "—") : "—"}
        </span>
        <div className="w-px h-5 bg-[#1a1a1a]" />

        {hasWallet ? (
          <>
            {/* Portfolio + Cash */}
            <div className="flex flex-col leading-none">
              <span className="text-[9px] text-[#555555]">Portfolio</span>
              <span className="text-xs font-bold text-[#0ecb81] tabular-nums">{portfolioDisplay}</span>
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-[9px] text-[#555555]">Cash</span>
              <span className="text-xs font-bold text-[#0ecb81] tabular-nums">{cashDisplay}</span>
            </div>
            <div className="w-px h-5 bg-[#1a1a1a]" />
            {/* Wallet address */}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] bg-[#0ecb8110] text-[#0ecb81] border border-[#0ecb8130]">
              <div className="w-1.5 h-1.5 rounded-full bg-[#0ecb81]" />
              {walletAddr ? `${walletAddr.slice(0, 6)}...${walletAddr.slice(-4)}` : "Connected"}
            </div>
          </>
        ) : (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] bg-[#131313] text-[#555555] border border-[#1a1a1a]">
            <div className="w-1.5 h-1.5 rounded-full bg-[#555555]" />
            No Wallet
          </div>
        )}
      </div>
    </header>
  );
}

function Dot({ on, label }: { on: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="relative flex h-1.5 w-1.5">
        {on && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0ecb81] opacity-75" />}
        <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${on ? "bg-[#0ecb81]" : "bg-[#555555]"}`} />
      </span>
      <span className={`text-[10px] ${on ? "text-[#0ecb81]" : "text-[#555555]"}`}>{label}</span>
    </div>
  );
}
