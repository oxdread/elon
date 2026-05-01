"use client";

import { useState, useEffect } from "react";

export default function AdminPage() {
  const [wallets, setWallets] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const fetchWallets = async () => {
    try {
      const r = await fetch("/api/tracked-wallets");
      const d = await r.json();
      if (Array.isArray(d)) setWallets(d);
    } catch {}
  };

  useEffect(() => { fetchWallets(); }, []);

  const addWallet = async () => {
    if (!input.trim()) return;
    let addr = input.trim().toLowerCase();
    if (!addr.startsWith("0x")) addr = "0x" + addr;
    setLoading(true);
    setStatus("Fetching profile...");
    try {
      const r = await fetch("/api/tracked-wallets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr }),
      });
      const d = await r.json();
      if (d.status === "ok") {
        setStatus(`Added: ${d.name}`);
        setInput("");
        fetchWallets();
      } else {
        setStatus(`Error: ${d.error}`);
      }
    } catch (e) {
      setStatus(`Error: ${e}`);
    }
    setLoading(false);
    setTimeout(() => setStatus(""), 3000);
  };

  const removeWallet = async (addr: string) => {
    await fetch("/api/tracked-wallets", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: addr, action: "remove" }),
    });
    fetchWallets();
  };

  return (
    <div className="min-h-screen bg-[#060606] text-[#e5e5e5] p-8 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-1">Top Traders Config</h1>
      <p className="text-[#555555] text-xs mb-6">Add Polymarket wallet addresses to track. Profile pics are scraped automatically.</p>

      <div className="flex gap-2 mb-4">
        <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addWallet()}
          placeholder="0x... wallet address"
          className="flex-1 bg-[#0d0d0d] border border-[#1a1a1a] rounded-lg px-4 py-2.5 text-sm text-[#e5e5e5] font-mono focus:outline-none focus:border-[#3b82f6]" />
        <button onClick={addWallet} disabled={loading || !input.trim()}
          className="px-5 py-2.5 rounded-lg text-sm font-bold bg-[#3b82f6] text-white hover:bg-blue-500 disabled:opacity-30 transition-colors">
          {loading ? "Adding..." : "Add"}
        </button>
      </div>

      {status && (
        <div className={`text-xs mb-4 px-3 py-2 rounded-lg ${status.startsWith("Error") ? "bg-[#f6465d]/10 text-[#f6465d]" : "bg-[#0ecb81]/10 text-[#0ecb81]"}`}>
          {status}
        </div>
      )}

      <div className="space-y-2">
        {wallets.length === 0 ? (
          <div className="text-[#555555] text-sm py-8 text-center">No traders tracked yet</div>
        ) : (
          wallets.map((w) => (
            <div key={w.id} className="flex items-center gap-3 px-4 py-3 rounded-lg bg-[#0d0d0d] border border-[#1a1a1a]">
              <div className="w-10 h-10 rounded-full bg-[#1a1a1a] shrink-0 overflow-hidden">
                {w.profile_image ? (
                  <img src={`/traders/${w.address}.jpg`} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-sm font-bold text-[#555555]">
                    {(w.name || "?").charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold">{w.name}</div>
                <div className="text-[11px] text-[#555555] font-mono">{w.address}</div>
              </div>
              <button onClick={() => removeWallet(w.address)}
                className="px-3 py-1.5 rounded-lg text-xs text-[#f6465d] hover:bg-[#f6465d]/10 border border-[#f6465d]/20 transition-colors">
                Remove
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
