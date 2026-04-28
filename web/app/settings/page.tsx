"use client";

import { useState, useEffect } from "react";
import { Key, Shield, Trash2, Wallet, RefreshCw } from "lucide-react";

export default function SettingsPage() {
  const [privateKey, setPrivateKey] = useState("");
  const [funderInput, setFunderInput] = useState("");
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [funderAddress, setFunderAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [portfolioValue, setPortfolioValue] = useState<number | null>(null);
  const [tradeCount, setTradeCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const key = localStorage.getItem("poly_private_key");
    const funder = localStorage.getItem("poly_funder");
    if (key) {
      setSavedKey(key);
      if (funder) setFunderAddress(funder);
      fetchFullAccount(key, funder);
    }
  }, []);

  const fetchFullAccount = async (key: string, funder?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      // Get signing address
      const infoRes = await fetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ private_key: key, action: "info" }),
      });
      const info = await infoRes.json();
      if (info.error) { setError(info.error); setLoading(false); return; }
      setWalletAddress(info.address);

      // Use stored funder or auto-detected one
      const funderAddr = funder || info.funder;
      if (funderAddr) {
        setFunderAddress(funderAddr);

        // Get balance
        const balRes = await fetch("/api/wallet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ private_key: key, action: "balance", funder: funderAddr }),
        });
        const bal = await balRes.json();
        if (!bal.error) setBalance(bal.balance);

        // Get portfolio value via data-api
        try {
          const valRes = await fetch(`https://data-api.polymarket.com/value?user=${funderAddr}`);
          const valData = await valRes.json();
          if (Array.isArray(valData) && valData[0]) setPortfolioValue(valData[0].value);
        } catch {}
      }
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  };

  const saveKey = async () => {
    if (!privateKey.trim()) return;
    let key = privateKey.trim();
    if (!key.startsWith("0x")) key = "0x" + key;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ private_key: key, action: "full" }),
      });
      const d = await res.json();
      if (d.error) {
        setError("Invalid private key: " + d.error);
        setLoading(false);
        return;
      }

      localStorage.setItem("poly_private_key", key);
      if (d.funder) localStorage.setItem("poly_funder", d.funder);
      setSavedKey(key);
      setPrivateKey("");
      setWalletAddress(d.address);
      setFunderAddress(d.funder);
      setBalance(d.cash);
      setPortfolioValue(d.portfolio_value);
      setTradeCount(d.trade_count);
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  };

  const removeKey = () => {
    localStorage.removeItem("poly_private_key");
    localStorage.removeItem("poly_funder");
    setSavedKey(null);
    setWalletAddress(null);
    setFunderAddress(null);
    setBalance(null);
    setPortfolioValue(null);
    setTradeCount(null);
  };

  const maskedKey = savedKey ? savedKey.slice(0, 6) + "••••••••" + savedKey.slice(-4) : null;

  return (
    <div className="p-4 max-w-2xl">
      <h1 className="text-xl font-bold mb-6 text-[#e5e5e5]">Settings</h1>

      {/* Wallet */}
      <section className="rounded-lg border border-[#1a1a1a] bg-[#0d0d0d] p-4 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <Wallet size={16} className="text-[#808080]" />
          <h2 className="text-sm font-bold text-[#e5e5e5]">Polymarket Wallet</h2>
        </div>

        {savedKey ? (
          <div className="space-y-4">
            {/* Addresses */}
            {walletAddress && (
              <div className="bg-[#131313] rounded-lg p-3 border border-[#1a1a1a]">
                <div className="text-[10px] text-[#555555] uppercase tracking-wider mb-1">Signing Address</div>
                <div className="text-xs text-[#808080] font-mono break-all">{walletAddress}</div>
              </div>
            )}

            {/* Funder / Proxy Wallet */}
            <div className="bg-[#131313] rounded-lg p-3 border border-[#1a1a1a]">
              <div className="text-[10px] text-[#555555] uppercase tracking-wider mb-1">
                Deposit Address (Proxy Wallet)
              </div>
              {funderAddress ? (
                <div className="flex items-center gap-2">
                  <div className="text-sm text-[#e5e5e5] font-mono break-all flex-1">{funderAddress}</div>
                  <button onClick={() => { setFunderAddress(null); localStorage.removeItem("poly_funder"); }}
                    className="text-[10px] text-[#555555] hover:text-[#e5e5e5] px-2 py-1 rounded bg-[#1a1a1a] shrink-0">
                    Change
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[10px] text-[#555555]">
                    Your Polymarket deposit address. Find it on polymarket.com → Settings → Deposit.
                  </p>
                  <div className="flex gap-2">
                    <input type="text" value={funderInput} onChange={(e) => setFunderInput(e.target.value)}
                      placeholder="0x..."
                      className="flex-1 bg-[#0d0d0d] border border-[#1a1a1a] rounded px-3 py-1.5 text-xs text-[#e5e5e5] font-mono focus:outline-none focus:border-[#3b82f6]" />
                    <button onClick={() => {
                      let addr = funderInput.trim().toLowerCase();
                      if (!addr.startsWith("0x")) addr = "0x" + addr;
                      if (addr.length === 42) {
                        localStorage.setItem("poly_funder", addr);
                        setFunderAddress(addr);
                        setFunderInput("");
                        if (savedKey) fetchFullAccount(savedKey, addr);
                      }
                    }} disabled={!funderInput.trim()}
                      className="px-3 py-1.5 rounded bg-[#3b82f6] text-white text-xs font-bold disabled:opacity-30">
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Balance + Portfolio */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#131313] rounded-lg p-3 border border-[#1a1a1a]">
                <div className="text-[10px] text-[#555555] uppercase tracking-wider mb-1">Cash</div>
                <div className="text-xl font-bold text-[#0ecb81] tabular-nums">
                  {balance != null ? `$${(parseFloat(balance) / 1e6).toFixed(2)}` : loading ? "..." : "—"}
                </div>
                <div className="text-[10px] text-[#555555]">USDC available</div>
              </div>
              <div className="bg-[#131313] rounded-lg p-3 border border-[#1a1a1a]">
                <div className="text-[10px] text-[#555555] uppercase tracking-wider mb-1">Portfolio</div>
                <div className="text-xl font-bold text-[#0ecb81] tabular-nums">
                  {portfolioValue != null ? `$${portfolioValue.toFixed(2)}` : loading ? "..." : "—"}
                </div>
                <div className="text-[10px] text-[#555555]">{tradeCount ?? 0} trades</div>
              </div>
            </div>

            {/* Private Key */}
            <div className="bg-[#131313] rounded-lg p-3 border border-[#1a1a1a]">
              <div className="text-[10px] text-[#555555] uppercase tracking-wider mb-1">Private Key</div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 flex-1">
                  <Shield size={14} className="text-[#0ecb81] shrink-0" />
                  <span className="text-xs text-[#808080] font-mono">
                    {showKey ? savedKey : maskedKey}
                  </span>
                </div>
                <button onClick={() => setShowKey(!showKey)}
                  className="text-[10px] text-[#555555] hover:text-[#e5e5e5] px-2 py-1 rounded bg-[#1a1a1a] border border-[#252525]">
                  {showKey ? "Hide" : "Show"}
                </button>
                <button onClick={removeKey}
                  className="text-[10px] text-[#f6465d] hover:text-[#f6465d] px-2 py-1 rounded bg-[#f6465d10] border border-[#f6465d30] flex items-center gap-1">
                  <Trash2 size={10} /> Remove
                </button>
              </div>
            </div>

            {/* Status */}
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#0ecb81]" />
              <span className="text-xs text-[#0ecb81]">Wallet connected — trading enabled</span>
            </div>

            <p className="text-[10px] text-[#555555]">
              Your private key is stored locally in your browser. It is sent to the server only when placing orders.
              Never shared with third parties.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-[#808080]">
              Import your Polymarket proxy wallet private key to enable trading.
              Find it in your Polymarket account settings under &quot;Export Private Key&quot;.
            </p>

            {error && (
              <div className="text-[10px] p-2 rounded border border-[#f6465d30] bg-[#f6465d10] text-[#f6465d]">
                {error}
              </div>
            )}

            <div className="flex gap-2">
              <input
                type="password"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder="0x..."
                className="flex-1 bg-[#131313] border border-[#1a1a1a] rounded-lg px-3 py-2 text-sm text-[#e5e5e5] placeholder-[#333] focus:outline-none focus:border-[#3b82f6] font-mono"
              />
              <button
                onClick={saveKey}
                disabled={!privateKey.trim() || loading}
                className="px-4 py-2 rounded-lg bg-[#3b82f6] text-white text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#2563eb] transition-colors"
              >
                {loading ? "Validating..." : "Import"}
              </button>
            </div>
            <p className="text-[10px] text-[#555555]">
              Key is validated before saving — if the address can&apos;t be derived, it will be rejected.
            </p>
          </div>
        )}
      </section>

      {/* About */}
      <section className="rounded-lg border border-[#1a1a1a] bg-[#0d0d0d] p-4">
        <h2 className="text-sm font-bold text-[#e5e5e5] mb-2">About</h2>
        <p className="text-xs text-[#808080]">
          ElonTrader — Polymarket Elon Tweet Trading Platform.
          Track tweets, bracket prices, and trade in real-time.
        </p>
      </section>
    </div>
  );
}
