"use client";

import { useEffect, useState } from "react";
import { Wallet, RefreshCw } from "lucide-react";

export default function PortfolioPage() {
  const [balance, setBalance] = useState<string | null>(null);
  const [positions, setPositions] = useState<Array<Record<string, string>>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const hasKey = mounted && typeof window !== "undefined" && !!localStorage.getItem("poly_private_key");

  const refresh = async () => {
    if (!hasKey) return;
    const key = localStorage.getItem("poly_private_key")!;
    setLoading(true);
    setError(null);

    try {
      const [balR, posR] = await Promise.all([
        fetch("/api/balance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ private_key: key }) }),
        fetch("/api/positions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ private_key: key }) }),
      ]);
      const balD = await balR.json();
      const posD = await posR.json();

      if (balD.error) setError(balD.error);
      else setBalance(balD.balance);

      if (Array.isArray(posD)) setPositions(posD);
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  };

  useEffect(() => {
    if (hasKey) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasKey]);

  if (!mounted) return <div className="p-4 text-neutral-500">Loading...</div>;

  if (!hasKey) {
    return (
      <div className="p-4">
        <h1 className="text-xl font-bold mb-4">Portfolio</h1>
        <div className="rounded-xl border border-neutral-800/60 bg-neutral-900/30 p-6 text-center">
          <Wallet size={24} className="text-neutral-600 mx-auto mb-2" />
          <p className="text-neutral-500 text-sm">Import your Polymarket private key in Settings to view portfolio.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-xl font-bold">Portfolio</h1>
        <button onClick={refresh} disabled={loading}
          className="text-neutral-500 hover:text-neutral-300 disabled:opacity-30">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-800/40 bg-rose-950/30 px-3 py-2 text-xs text-rose-400">{error}</div>
      )}

      {/* Balance */}
      <section className="rounded-xl border border-neutral-800/60 bg-neutral-900/30 p-4 mb-4">
        <h2 className="text-[10px] text-neutral-500 uppercase tracking-wider mb-2">Balance</h2>
        <div className="text-2xl font-bold text-neutral-100 tabular-nums">
          {balance != null ? `$${(parseFloat(balance) / 1e6).toFixed(2)}` : "—"}
        </div>
        <span className="text-[10px] text-neutral-600">USDC on Polymarket</span>
      </section>

      {/* Open Orders */}
      <section className="rounded-xl border border-neutral-800/60 bg-neutral-900/30 p-4">
        <h2 className="text-[10px] text-neutral-500 uppercase tracking-wider mb-2">Open Orders</h2>
        {positions.length === 0 ? (
          <p className="text-neutral-600 text-xs">No open orders.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-neutral-500">
                <tr>
                  <th className="text-left py-1">Market</th>
                  <th className="text-left">Side</th>
                  <th className="text-right">Price</th>
                  <th className="text-right">Size</th>
                  <th className="text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p, i) => (
                  <tr key={i} className="border-t border-neutral-800/40">
                    <td className="py-1 text-neutral-300">{p.asset_id?.slice(0, 10) ?? "—"}...</td>
                    <td className={p.side === "BUY" ? "text-emerald-400" : "text-rose-400"}>{p.side ?? "—"}</td>
                    <td className="text-right tabular-nums text-neutral-400">{p.price ?? "—"}</td>
                    <td className="text-right tabular-nums text-neutral-400">{p.original_size ?? p.size ?? "—"}</td>
                    <td className="text-right text-neutral-500">{p.status ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
