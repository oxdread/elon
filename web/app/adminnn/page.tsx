"use client";

import { useState, useEffect, useRef } from "react";

export default function AdminPage() {
  useEffect(() => {
    const sidebar = document.querySelector("aside");
    const header = document.querySelector("header");
    if (sidebar) sidebar.style.display = "none";
    if (header) header.style.display = "none";
    return () => {
      if (sidebar) sidebar.style.display = "";
      if (header) header.style.display = "";
    };
  }, []);

  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  const [wallets, setWallets] = useState<any[]>([]);
  const [addressInput, setAddressInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const login = async () => {
    if (!password) return;
    setChecking(true);
    setError("");
    try {
      const r = await fetch("/api/admin-auth", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const d = await r.json();
      if (d.status === "ok") {
        setAuthed(true);
        sessionStorage.setItem("admin_authed", "1");
        fetchWallets();
      } else {
        setError("Wrong password");
      }
    } catch {
      setError("Error");
    }
    setChecking(false);
  };

  useEffect(() => {
    if (sessionStorage.getItem("admin_authed") === "1") {
      setAuthed(true);
      fetchWallets();
    }
  }, []);

  const fetchWallets = async () => {
    try {
      const r = await fetch("/api/tracked-wallets");
      const d = await r.json();
      if (Array.isArray(d)) setWallets(d);
    } catch {}
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onload = (ev) => setImagePreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const addWallet = async () => {
    if (!addressInput.trim()) return;
    let addr = addressInput.trim().toLowerCase();
    if (!addr.startsWith("0x")) addr = "0x" + addr;
    setLoading(true);
    setStatus("Adding trader...");
    try {
      // First add the wallet (scrapes profile from Polymarket)
      const r = await fetch("/api/tracked-wallets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr, name: nameInput.trim() || undefined }),
      });
      const d = await r.json();

      // If user selected a custom image, upload it
      if (d.status === "ok" && imageFile) {
        const formData = new FormData();
        formData.append("image", imageFile);
        formData.append("address", addr);
        await fetch("/api/tracked-wallets/upload", { method: "POST", body: formData });
      }

      if (d.status === "ok") {
        setStatus(`Added: ${d.name || addr}`);
        setAddressInput("");
        setNameInput("");
        setImageFile(null);
        setImagePreview(null);
        if (fileRef.current) fileRef.current.value = "";
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
    if (!confirm(`Remove ${addr.slice(0, 10)}...?`)) return;
    await fetch("/api/tracked-wallets", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: addr, action: "remove" }),
    });
    fetchWallets();
  };

  const updateName = async (addr: string, newName: string) => {
    await fetch("/api/tracked-wallets", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: addr, action: "update", name: newName }),
    });
    setEditingId(null);
    fetchWallets();
  };

  // Password gate
  if (!authed) {
    return (
      <div className="min-h-screen bg-[#060606] flex items-center justify-center">
        <div className="w-80 bg-[#0d0d0d] rounded-xl border border-[#1a1a1a] p-6">
          <div className="text-center mb-5">
            <div className="text-2xl mb-2">&#128274;</div>
            <div className="text-sm font-bold text-[#e5e5e5]">Admin Access</div>
            <div className="text-[10px] text-[#555555] mt-1">Enter password to continue</div>
          </div>
          {error && (
            <div className="text-[11px] text-[#f6465d] bg-[#f6465d]/10 px-3 py-1.5 rounded-lg mb-3 text-center">{error}</div>
          )}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && login()}
            placeholder="Password" autoFocus
            className="w-full bg-[#111] border border-[#1a1a1a] rounded-lg px-4 py-2.5 text-sm text-[#e5e5e5] text-center focus:outline-none focus:border-[#3b82f6] mb-3" />
          <button onClick={login} disabled={checking || !password}
            className="w-full py-2.5 rounded-lg text-sm font-bold bg-[#3b82f6] text-white hover:bg-blue-500 disabled:opacity-30 transition-colors">
            {checking ? "Checking..." : "Enter"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#060606] text-[#e5e5e5] p-8 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Top Traders Config</h1>
          <p className="text-[#555555] text-xs mt-0.5">Add, edit, or remove tracked Polymarket wallets</p>
        </div>
        <button onClick={() => { setAuthed(false); sessionStorage.removeItem("admin_authed"); }}
          className="text-[11px] text-[#555555] hover:text-[#e5e5e5] px-3 py-1.5 rounded-lg border border-[#1a1a1a] transition-colors">
          Logout
        </button>
      </div>

      {/* Add form */}
      <div className="bg-[#0d0d0d] rounded-xl border border-[#1a1a1a] p-4 mb-4">
        <div className="text-xs font-bold text-[#808080] mb-3">Add Trader</div>
        <div className="flex gap-3">
          {/* Avatar preview */}
          <div className="shrink-0">
            <div className="w-14 h-14 rounded-full bg-[#1a1a1a] overflow-hidden cursor-pointer border-2 border-dashed border-[#333] hover:border-[#3b82f6] transition-colors"
              onClick={() => fileRef.current?.click()}>
              {imagePreview ? (
                <img src={imagePreview} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[10px] text-[#555555]">Photo</div>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
          </div>
          {/* Inputs */}
          <div className="flex-1 space-y-2">
            <input type="text" value={addressInput} onChange={(e) => setAddressInput(e.target.value)}
              placeholder="0x... wallet address"
              className="w-full bg-[#111] border border-[#1a1a1a] rounded-lg px-3 py-2 text-sm text-[#e5e5e5] font-mono focus:outline-none focus:border-[#3b82f6]" />
            <div className="flex gap-2">
              <input type="text" value={nameInput} onChange={(e) => setNameInput(e.target.value)}
                placeholder="Display name (optional, auto-fetched)"
                className="flex-1 bg-[#111] border border-[#1a1a1a] rounded-lg px-3 py-2 text-sm text-[#e5e5e5] focus:outline-none focus:border-[#3b82f6]" />
              <button onClick={addWallet} disabled={loading || !addressInput.trim()}
                className="px-5 py-2 rounded-lg text-sm font-bold bg-[#3b82f6] text-white hover:bg-blue-500 disabled:opacity-30 transition-colors shrink-0">
                {loading ? "Adding..." : "Add"}
              </button>
            </div>
          </div>
        </div>
        <p className="text-[9px] text-[#555555] mt-2">Profile pic is auto-scraped from Polymarket. Upload a custom one by clicking the photo circle.</p>
      </div>

      {status && (
        <div className={`text-xs mb-4 px-3 py-2 rounded-lg ${status.startsWith("Error") ? "bg-[#f6465d]/10 text-[#f6465d]" : "bg-[#0ecb81]/10 text-[#0ecb81]"}`}>
          {status}
        </div>
      )}

      {/* Trader list */}
      <div className="space-y-2">
        {wallets.length === 0 ? (
          <div className="text-[#555555] text-sm py-8 text-center bg-[#0d0d0d] rounded-xl border border-[#1a1a1a]">No traders tracked yet</div>
        ) : (
          wallets.map((w) => (
            <div key={w.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#0d0d0d] border border-[#1a1a1a]">
              <div className="w-11 h-11 rounded-full bg-[#1a1a1a] shrink-0 overflow-hidden">
                {w.profile_image ? (
                  <img src={`/traders/${w.address}.jpg?t=${Date.now()}`} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-sm font-bold text-[#555555]">
                    {(w.name || "?").charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                {editingId === w.id ? (
                  <div className="flex gap-1.5">
                    <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && updateName(w.address, editName)}
                      autoFocus
                      className="flex-1 bg-[#111] border border-[#3b82f6] rounded px-2 py-1 text-sm text-[#e5e5e5] focus:outline-none" />
                    <button onClick={() => updateName(w.address, editName)}
                      className="text-[10px] text-[#0ecb81] px-2">Save</button>
                    <button onClick={() => setEditingId(null)}
                      className="text-[10px] text-[#555555] px-2">Cancel</button>
                  </div>
                ) : (
                  <>
                    <div className="text-sm font-bold">{w.name}</div>
                    <div className="text-[11px] text-[#555555] font-mono">{w.address}</div>
                  </>
                )}
              </div>
              <button onClick={() => { setEditingId(w.id); setEditName(w.name); }}
                className="px-3 py-1.5 rounded-lg text-xs text-[#808080] hover:text-[#e5e5e5] hover:bg-[#1a1a1a] transition-colors">
                Edit
              </button>
              <button onClick={() => removeWallet(w.address)}
                className="px-3 py-1.5 rounded-lg text-xs text-[#f6465d] hover:bg-[#f6465d]/10 border border-[#f6465d]/20 transition-colors">
                Remove
              </button>
            </div>
          ))
        )}
      </div>

      <div className="text-[9px] text-[#333] mt-6 text-center">{wallets.length} trader(s) tracked</div>
    </div>
  );
}
