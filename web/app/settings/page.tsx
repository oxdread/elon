"use client";

import { useState, useEffect } from "react";
import { Shield, Trash2, Wallet, Plus, Eye, EyeOff, RefreshCw } from "lucide-react";

type WalletData = {
  key: string;
  address: string | null;
  funder: string | null;
  balance: string | null;
  portfolioValue: number | null;
  positions: any[];
  trades: any[];
};

export default function SettingsPage() {
  const [wallets, setWallets] = useState<WalletData[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [showImport, setShowImport] = useState(false);
  const [privateKeyInput, setPrivateKeyInput] = useState("");
  const [funderInput, setFunderInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState<Record<number, boolean>>({});
  const [tab, setTab] = useState<"overview" | "positions" | "history">("overview");
  const [mounted, setMounted] = useState(false);

  // Load wallets from localStorage
  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem("poly_wallets");
    if (stored) {
      try {
        const keys: { key: string; funder: string | null }[] = JSON.parse(stored);
        setWallets(keys.map((k) => ({
          key: k.key, address: null, funder: k.funder,
          balance: null, portfolioValue: null, positions: [], trades: [],
        })));
        keys.forEach((k, i) => fetchWalletData(k.key, k.funder, i));
      } catch {}
    } else {
      // Migrate from old single-wallet format
      const key = localStorage.getItem("poly_private_key");
      const funder = localStorage.getItem("poly_funder");
      if (key) {
        const w: WalletData = { key, address: null, funder, balance: null, portfolioValue: null, positions: [], trades: [] };
        setWallets([w]);
        saveWallets([{ key, funder }]);
        fetchWalletData(key, funder, 0);
      }
    }
  }, []);

  const saveWallets = (keys: { key: string; funder: string | null }[]) => {
    localStorage.setItem("poly_wallets", JSON.stringify(keys));
    // Keep legacy keys for trade page compatibility
    if (keys.length > 0) {
      localStorage.setItem("poly_private_key", keys[0].key);
      if (keys[0].funder) localStorage.setItem("poly_funder", keys[0].funder);
    } else {
      localStorage.removeItem("poly_private_key");
      localStorage.removeItem("poly_funder");
    }
  };

  const fetchWalletData = async (key: string, funder: string | null, idx: number) => {
    try {
      // Get info
      const infoRes = await fetch("/api/wallet", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ private_key: key, action: "info", funder: funder || "" }),
      });
      const info = await infoRes.json();

      const funderAddr = funder || info.funder;

      setWallets((prev) => {
        const copy = [...prev];
        if (copy[idx]) {
          copy[idx] = { ...copy[idx], address: info.address, funder: funderAddr };
        }
        return copy;
      });

      if (funderAddr) {
        // Balance
        const balRes = await fetch("/api/wallet", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ private_key: key, action: "balance", funder: funderAddr }),
        });
        const bal = await balRes.json();

        // Portfolio
        let pv = null;
        try {
          const valRes = await fetch(`https://data-api.polymarket.com/value?user=${funderAddr}`);
          const valData = await valRes.json();
          if (Array.isArray(valData) && valData[0]) pv = valData[0].value;
        } catch {}

        // Positions
        const posRes = await fetch("/api/wallet", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ private_key: key, action: "positions", funder: funderAddr }),
        });
        const positions = await posRes.json();

        // Trades
        const tradesRes = await fetch("/api/wallet", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ private_key: key, action: "trades" }),
        });
        const trades = await tradesRes.json();

        setWallets((prev) => {
          const copy = [...prev];
          if (copy[idx]) {
            copy[idx] = {
              ...copy[idx],
              funder: funderAddr,
              balance: bal.balance || null,
              portfolioValue: pv,
              positions: Array.isArray(positions) ? positions.filter((p: any) => parseFloat(p.size || 0) > 0 && parseFloat(p.currentValue || 0) > 0) : [],
              trades: Array.isArray(trades) ? trades : [],
            };
          }
          return copy;
        });
      }
    } catch {}
  };

  const importWallet = async () => {
    if (!privateKeyInput.trim()) return;
    let key = privateKeyInput.trim();
    if (!key.startsWith("0x")) key = "0x" + key;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/wallet", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ private_key: key, action: "info" }),
      });
      const d = await res.json();
      if (d.error) { setError(d.error); setLoading(false); return; }

      const funder = funderInput.trim() || d.funder || null;
      const newWallet: WalletData = {
        key, address: d.address, funder,
        balance: null, portfolioValue: null, positions: [], trades: [],
      };

      setWallets((prev) => {
        const updated = [...prev, newWallet];
        saveWallets(updated.map((w) => ({ key: w.key, funder: w.funder })));
        return updated;
      });

      setActiveIdx(wallets.length);
      setPrivateKeyInput("");
      setFunderInput("");
      setShowImport(false);
      fetchWalletData(key, funder, wallets.length);
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  };

  const removeWallet = (idx: number) => {
    setWallets((prev) => {
      const updated = prev.filter((_, i) => i !== idx);
      saveWallets(updated.map((w) => ({ key: w.key, funder: w.funder })));
      return updated;
    });
    if (activeIdx >= wallets.length - 1) setActiveIdx(Math.max(0, wallets.length - 2));
  };

  if (!mounted) return <div className="p-4 text-[#555555]">Loading...</div>;

  const w = wallets[activeIdx];

  return (
    <div className="flex flex-col h-full bg-[#060606]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a] shrink-0">
        <h1 className="text-lg font-bold text-[#e5e5e5]">Settings</h1>
      </div>

      <div className="flex-1 flex min-h-0 p-3 gap-3">
        {/* Left: Wallet list */}
        <div className="w-64 flex flex-col gap-2 shrink-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-[#555555] uppercase tracking-wider">Wallets</span>
            <button onClick={() => setShowImport(true)}
              className="flex items-center gap-1 text-[10px] text-[#3b82f6] hover:text-blue-400 font-medium">
              <Plus size={12} /> Add
            </button>
          </div>

          {wallets.map((wallet, i) => (
            <button key={i} onClick={() => { setActiveIdx(i); setTab("overview"); }}
              className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                activeIdx === i
                  ? "bg-[#111111] border-[#3b82f6]/30"
                  : "bg-[#0d0d0d] border-[#1a1a1a]/50 hover:bg-[#111111]"
              }`}>
              <div className="flex items-center gap-2 mb-1">
                <Wallet size={14} className={activeIdx === i ? "text-[#3b82f6]" : "text-[#555555]"} />
                <span className="text-xs font-bold text-[#e5e5e5] font-mono">
                  {wallet.funder ? `${wallet.funder.slice(0, 6)}...${wallet.funder.slice(-4)}` : wallet.address ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}` : "Loading..."}
                </span>
              </div>
              <div className="flex items-center gap-3 text-[10px]">
                <span className="text-[#0ecb81] tabular-nums font-medium">
                  {wallet.balance != null ? `$${(parseFloat(wallet.balance) / 1e6).toFixed(2)}` : "—"}
                </span>
                <span className="text-[#808080] tabular-nums">
                  {wallet.portfolioValue != null ? `P: $${wallet.portfolioValue.toFixed(2)}` : ""}
                </span>
              </div>
            </button>
          ))}

          {wallets.length === 0 && !showImport && (
            <div className="text-xs text-[#555555] text-center py-4">No wallets added yet</div>
          )}

          {/* Import form */}
          {showImport && (
            <div className="bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] p-3 space-y-2">
              <div className="text-[11px] text-[#808080] font-medium">Import Wallet</div>
              {error && <div className="text-[10px] text-[#f6465d] bg-[#f6465d]/10 p-1.5 rounded">{error}</div>}
              <input type="password" value={privateKeyInput} onChange={(e) => setPrivateKeyInput(e.target.value)}
                placeholder="Private key (0x...)"
                className="w-full bg-[#0a0a0a] border border-[#1a1a1a]/50 rounded-md px-2.5 py-1.5 text-[11px] text-[#e5e5e5] font-mono focus:outline-none focus:border-[#3b82f6]/50" />
              <input type="text" value={funderInput} onChange={(e) => setFunderInput(e.target.value)}
                placeholder="Funder address (optional)"
                className="w-full bg-[#0a0a0a] border border-[#1a1a1a]/50 rounded-md px-2.5 py-1.5 text-[11px] text-[#e5e5e5] font-mono focus:outline-none focus:border-[#3b82f6]/50" />
              <div className="flex gap-1.5">
                <button onClick={importWallet} disabled={loading || !privateKeyInput.trim()}
                  className="flex-1 py-1.5 rounded-md text-[11px] font-bold bg-[#3b82f6] text-white disabled:opacity-30">
                  {loading ? "..." : "Import"}
                </button>
                <button onClick={() => { setShowImport(false); setError(null); }}
                  className="px-3 py-1.5 rounded-md text-[11px] text-[#555555] hover:text-[#808080] bg-[#111] border border-[#1a1a1a]/50">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right: Wallet detail */}
        {w ? (
          <div className="flex-1 flex flex-col gap-3 min-w-0">
            {/* Tabs */}
            <div className="flex gap-1 shrink-0">
              {(["overview", "positions", "history"] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-3 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    tab === t ? "bg-[#1a1a1a] text-[#e5e5e5]" : "text-[#555555] hover:text-[#808080]"
                  }`}>{t === "overview" ? "Overview" : t === "positions" ? "Active Positions" : "Trade History"}</button>
              ))}
            </div>

            {tab === "overview" && (
              <div className="space-y-3">
                {/* Stats */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] p-3">
                    <div className="text-[9px] text-[#555555] uppercase tracking-wider mb-1">Cash</div>
                    <div className="text-xl font-bold text-[#0ecb81] tabular-nums">
                      {w.balance != null ? `$${(parseFloat(w.balance) / 1e6).toFixed(2)}` : "—"}
                    </div>
                  </div>
                  <div className="bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] p-3">
                    <div className="text-[9px] text-[#555555] uppercase tracking-wider mb-1">Portfolio</div>
                    <div className="text-xl font-bold text-[#0ecb81] tabular-nums">
                      {w.portfolioValue != null ? `$${w.portfolioValue.toFixed(2)}` : "—"}
                    </div>
                  </div>
                  <div className="bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] p-3">
                    <div className="text-[9px] text-[#555555] uppercase tracking-wider mb-1">Positions</div>
                    <div className="text-xl font-bold text-[#e5e5e5] tabular-nums">{w.positions.length}</div>
                  </div>
                </div>

                {/* Addresses */}
                <div className="bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] p-3 space-y-2">
                  <div>
                    <div className="text-[9px] text-[#555555] uppercase tracking-wider mb-0.5">Signing Address</div>
                    <div className="text-[11px] text-[#808080] font-mono break-all">{w.address || "—"}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-[#555555] uppercase tracking-wider mb-0.5">Deposit Address</div>
                    <div className="text-[11px] text-[#e5e5e5] font-mono break-all">{w.funder || "—"}</div>
                  </div>
                </div>

                {/* Key + Actions */}
                <div className="bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] p-3">
                  <div className="flex items-center gap-2">
                    <Shield size={14} className="text-[#0ecb81] shrink-0" />
                    <span className="text-[11px] text-[#808080] font-mono flex-1">
                      {showKey[activeIdx] ? w.key : `${w.key.slice(0, 6)}••••••${w.key.slice(-4)}`}
                    </span>
                    <button onClick={() => setShowKey((p) => ({ ...p, [activeIdx]: !p[activeIdx] }))}
                      className="p-1 rounded hover:bg-[#1a1a1a] text-[#555555] hover:text-[#e5e5e5] transition-colors">
                      {showKey[activeIdx] ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button onClick={() => fetchWalletData(w.key, w.funder, activeIdx)}
                      className="p-1 rounded hover:bg-[#1a1a1a] text-[#555555] hover:text-[#e5e5e5] transition-colors">
                      <RefreshCw size={14} />
                    </button>
                    <button onClick={() => removeWallet(activeIdx)}
                      className="p-1 rounded hover:bg-[#f6465d]/10 text-[#f6465d] transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#0ecb81]" />
                  <span className="text-[11px] text-[#0ecb81]">Connected</span>
                  <span className="text-[10px] text-[#555555] ml-1">Key stored in browser only</span>
                </div>
              </div>
            )}

            {tab === "positions" && (
              <div className="flex-1 overflow-y-auto">
                {w.positions.length === 0 ? (
                  <div className="text-xs text-[#555555] text-center py-8">No active positions</div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {w.positions.map((p: any, i: number) => {
                      const label = p.title?.replace(/^Will Elon Musk post\s*/i, "").replace(/\s*twee?ts?.*$/i, "").trim() || p.conditionId?.slice(0, 12) || "—";
                      const isYes = p.outcome === "Yes";
                      const pnl = parseFloat(p.cashPnl || 0);
                      return (
                        <div key={i} className="px-3 py-2.5 rounded-lg border border-[#1a1a1a]/50 relative overflow-hidden"
                          style={{ background: isYes
                            ? "linear-gradient(135deg, rgba(14,203,129,0.04) 0%, transparent 50%)"
                            : "linear-gradient(135deg, rgba(246,70,93,0.04) 0%, transparent 50%)"
                          }}>
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-[#e5e5e5]">{label}</span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isYes ? "text-[#0ecb81] bg-[#0ecb81]/10 border border-[#0ecb81]/20" : "text-[#f6465d] bg-[#f6465d]/10 border border-[#f6465d]/20"}`}>
                                {p.outcome || "—"}
                              </span>
                            </div>
                            <span className={`text-sm font-bold tabular-nums ${parseFloat(p.currentValue || 0) > 0 ? "text-[#e5e5e5]" : "text-[#555555]"}`}>
                              ${parseFloat(p.currentValue || 0).toFixed(2)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <div className="px-2 py-0.5 rounded-md bg-[#0d0d0d]/80 text-[10px]">
                              <span className="text-[#555555]">Shares </span>
                              <span className="text-[#e5e5e5] font-bold tabular-nums">{parseFloat(p.size || 0).toFixed(1)}</span>
                            </div>
                            <div className="px-2 py-0.5 rounded-md bg-[#0d0d0d]/80 text-[10px]">
                              <span className="text-[#555555]">Avg </span>
                              <span className="text-[#e5e5e5] tabular-nums">{(parseFloat(p.avgPrice || 0) * 100).toFixed(1)}¢</span>
                            </div>
                            <div className="px-2 py-0.5 rounded-md bg-[#0d0d0d]/80 text-[10px]">
                              <span className="text-[#555555]">Cur </span>
                              <span className="text-[#e5e5e5] tabular-nums">{(parseFloat(p.curPrice || 0) * 100).toFixed(1)}¢</span>
                            </div>
                            <span className={`ml-auto text-[11px] font-medium tabular-nums ${pnl >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
                              {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {tab === "history" && (
              <div className="flex-1 overflow-y-auto">
                {w.trades.length === 0 ? (
                  <div className="text-xs text-[#555555] text-center py-8">No trade history</div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {w.trades.slice(0, 50).map((t: any, i: number) => {
                      const ts = parseInt(t.match_time || t.timestamp || "0");
                      const date = ts ? new Date(ts * 1000) : null;
                      const dateStr = date ? date.toLocaleDateString([], { month: "short", day: "numeric" }) : "—";
                      const timeStr = date ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
                      return (
                        <div key={i} className="flex items-center px-3 py-2 rounded-lg bg-[#0d0d0d] border border-[#1a1a1a]/50 text-[11px] gap-3">
                          <span className={`font-bold w-8 ${t.side === "BUY" ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>{t.side}</span>
                          <div className="flex-1 min-w-0">
                            <span className="text-[#e5e5e5] tabular-nums font-medium">{parseFloat(t.size || 0).toFixed(1)}</span>
                            <span className="text-[#555555] mx-1">@</span>
                            <span className="text-[#e5e5e5] tabular-nums">{(parseFloat(t.price || 0) * 100).toFixed(1)}¢</span>
                          </div>
                          <span className="text-[#808080] truncate max-w-[120px]">{t.outcome || ""}</span>
                          <div className="text-right shrink-0 text-[10px] text-[#555555]">
                            <div>{dateStr}</div>
                            <div>{timeStr}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[#555555] text-sm">
            <div className="text-center">
              <Wallet size={32} className="mx-auto mb-2 text-[#333]" />
              <div>Import a wallet to get started</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
