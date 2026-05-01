"use client";

import { useState, useEffect, useRef } from "react";
import toast from "react-hot-toast";

type Bracket = {
  id: string; label: string; yes_token_id: string | null; no_token_id?: string | null;
  mid: number | null; bid: number | null; ask: number | null;
};

export default function TradingPanel({
  bracket, limitPrice, initialAction, initialAmount, onOutcomeChange, positions,
}: {
  bracket: Bracket | null;
  limitPrice?: number | null;
  initialAction?: "buy" | "sell";
  initialAmount?: string;
  onOutcomeChange?: (outcome: "yes" | "no") => void;
  positions?: any[];
}) {
  const [action, setAction] = useState<"buy" | "sell">("buy");
  const [outcome, setOutcome] = useState<"yes" | "no">("yes");
  const [orderType, setOrderType] = useState<"market" | "limit">("limit");
  const [inputMode, setInputMode] = useState<"dollars" | "shares">("dollars");
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState("");
  const [loading, setLoading] = useState(false);
  const [showOrderType, setShowOrderType] = useState(false);
  const pendingToastRef = useRef<string | null>(null);
  const orderStartTimeRef = useRef<number>(0);

  useEffect(() => { if (initialAction) setAction(initialAction); }, [initialAction]);
  useEffect(() => { if (initialAmount) { setAmount(initialAmount); setInputMode("shares"); } }, [initialAmount]);
  const handleOutcomeChange = (o: "yes" | "no") => { setOutcome(o); onOutcomeChange?.(o); };

  useEffect(() => {
    if (limitPrice != null) { setOrderType("limit"); setPrice((limitPrice * 100).toFixed(1)); }
  }, [limitPrice]);

  useEffect(() => {
    if (bracket) {
      let p: number | null = null;
      if (outcome === "yes") { p = action === "buy" ? bracket.ask : bracket.bid; }
      else { p = action === "buy" ? (bracket.bid != null ? 1 - bracket.bid : null) : (bracket.ask != null ? 1 - bracket.ask : null); }
      if (p != null) setPrice((p * 100).toFixed(1));
    }
  }, [bracket?.id, outcome, action]);

  useEffect(() => {
    const ts = { background: "#141414", border: "1px solid #252525", borderRadius: "12px" };
    const onFill = () => {
      if (pendingToastRef.current) {
        toast.success("Filled!", { id: pendingToastRef.current, duration: 3000, style: { ...ts, color: "#0ecb81" } });
        pendingToastRef.current = null; setLoading(false);
      }
    };
    const onOrderEvent = (e: Event) => {
      if (!pendingToastRef.current) return;
      const detail = (e as CustomEvent).detail;
      if (detail?.type === "PLACEMENT") {
        toast.success("Limit order placed", { id: pendingToastRef.current, duration: 3000, style: { ...ts, color: "#3b82f6" } });
        pendingToastRef.current = null; setLoading(false);
      } else if (detail?.type === "CANCELLATION") {
        toast.error("Order cancelled", { id: pendingToastRef.current, duration: 3000, style: { ...ts, color: "#f6465d" } });
        pendingToastRef.current = null; setLoading(false);
      }
    };
    window.addEventListener("ws-trade-fill", onFill);
    window.addEventListener("ws-order-event", onOrderEvent);
    return () => { window.removeEventListener("ws-trade-fill", onFill); window.removeEventListener("ws-order-event", onOrderEvent); };
  }, []);

  const hasKey = typeof window !== "undefined" && !!localStorage.getItem("poly_private_key");
  const yesPos = positions?.find((p) => p.asset === bracket?.yes_token_id);
  const noPos = positions?.find((p) => p.asset === bracket?.no_token_id);
  const yesShares = yesPos ? parseFloat(yesPos.size || 0) : 0;
  const noShares = noPos ? parseFloat(noPos.size || 0) : 0;
  const curShares = outcome === "yes" ? yesShares : noShares;

  const yesBid = bracket?.bid != null ? bracket.bid * 100 : null;
  const yesAsk = bracket?.ask != null ? bracket.ask * 100 : null;
  const noBid = yesAsk != null ? (100 - yesAsk) : null;
  const noAsk = yesBid != null ? (100 - yesBid) : null;

  const priceNum = parseFloat(price) || 0;
  const amountNum = parseFloat(amount) || 0;
  const isBuy = action === "buy";
  const isYes = outcome === "yes";

  let shares = 0, total = 0, toWin = 0;
  if (priceNum > 0 && amountNum > 0) {
    if (inputMode === "shares") { shares = amountNum; total = (shares * priceNum) / 100; }
    else { total = amountNum; shares = (total * 100) / priceNum; }
    toWin = shares - total;
  }

  const adjustPrice = (delta: number) => {
    setPrice(Math.max(0.1, Math.min(99.9, (parseFloat(price) || 0) + delta)).toFixed(1));
  };

  const placeOrder = async () => {
    if (!bracket?.yes_token_id || !hasKey) return;
    const key = localStorage.getItem("poly_private_key")!;
    const funder = localStorage.getItem("poly_funder") || "";
    setLoading(true);
    orderStartTimeRef.current = performance.now();
    const ts = { background: "#141414", color: "#e5e5e5", border: "1px solid #252525", borderRadius: "12px" };
    const toastId = toast.loading("Placing order...", { position: "bottom-right", style: ts });
    pendingToastRef.current = toastId;
    try {
      const side = isBuy ? "BUY" : "SELL";
      const body: Record<string, string | number> = { private_key: key, token_id: bracket.yes_token_id, side, order_type: orderType, funder };
      if (orderType === "limit") { body.price = priceNum / 100; body.size = shares; } else { body.amount = total; }
      const r = await fetch("/api/trade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, _t0: Date.now() }) });
      const d = await r.json();
      if (d.status === "ok") {
        toast.loading("Waiting for confirmation...", { id: toastId, style: { ...ts, color: "#0ecb81" } });
        setTimeout(() => { if (pendingToastRef.current === toastId) { toast.success("Order submitted", { id: toastId, duration: 3000, style: { ...ts, color: "#0ecb81" } }); pendingToastRef.current = null; setLoading(false); } }, 15000);
      } else {
        toast.error(d.error || "Order failed", { id: toastId, duration: 5000, style: { ...ts, color: "#f6465d" } });
        pendingToastRef.current = null; setLoading(false);
      }
    } catch (e) {
      toast.error(String(e).slice(0, 100), { id: toastId, duration: 5000, style: { ...ts, color: "#f6465d" } });
      pendingToastRef.current = null; setLoading(false);
    }
  };

  if (!bracket) {
    return <div className="h-full flex items-center justify-center text-[#555555] text-xs p-4"><div className="text-center"><div className="text-2xl mb-1 text-[#1a1a1a]">&#8644;</div><div>Select a bracket</div></div></div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Bracket label with image */}
      <div className="flex items-center gap-2.5 px-3 pt-3 pb-2">
        <div className="w-8 h-8 rounded-lg bg-[#1a1a1a] shrink-0 overflow-hidden">
          <img src="/elon-red.jpg" alt="" className="w-full h-full object-cover" />
        </div>
        <span className="text-[13px] font-bold text-[#e5e5e5]">{bracket.label}</span>
      </div>

      {/* Yes / No tabs */}
      <div className="flex shrink-0">
        <button onClick={() => handleOutcomeChange("yes")}
          className={`flex-1 py-2 text-sm font-bold transition-all ${
            isYes ? "text-[#0ecb81] rounded-t-lg border border-[#1a1a1a] border-b-0"
              : "text-[#555555] hover:text-[#808080] border-b border-[#1a1a1a]"
          }`}
          style={isYes ? { background: "linear-gradient(180deg, rgba(14,203,129,0.12) 0%, rgba(14,203,129,0.04) 100%)" } : {}}>
          Yes {yesAsk != null ? `${yesAsk.toFixed(1)}¢` : ""}
        </button>
        <button onClick={() => handleOutcomeChange("no")}
          className={`flex-1 py-2 text-sm font-bold transition-all ${
            !isYes ? "text-[#f6465d] rounded-t-lg border border-[#1a1a1a] border-b-0"
              : "text-[#555555] hover:text-[#808080] border-b border-[#1a1a1a]"
          }`}
          style={!isYes ? { background: "linear-gradient(180deg, rgba(246,70,93,0.12) 0%, rgba(246,70,93,0.04) 100%)" } : {}}>
          No {noAsk != null ? `${noAsk.toFixed(1)}¢` : ""}
        </button>
      </div>

      {/* Content — gradient continues from tab */}
      <div className="flex flex-col px-3 pb-3 gap-2.5 border-x border-b border-[#1a1a1a] rounded-b-lg"
        style={{ background: isYes
          ? "linear-gradient(180deg, rgba(14,203,129,0.04) 0%, #0d0d0d 25%)"
          : "linear-gradient(180deg, rgba(246,70,93,0.04) 0%, #0d0d0d 25%)"
        }}>

        {/* Your shares card */}
        <div className={`flex items-center justify-between px-3 py-2 mt-2 rounded-lg border ${
          isYes ? "border-[#0ecb81]/15 bg-[#0ecb81]/5" : "border-[#f6465d]/15 bg-[#f6465d]/5"
        }`}>
          <span className="text-[11px] text-[#808080]">{isYes ? "Yes" : "No"} Shares</span>
          <span className={`text-sm font-bold tabular-nums ${isYes ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
            {curShares > 0 ? curShares.toLocaleString() : "0"}
          </span>
        </div>

        {/* Buy / Sell toggle */}
        <div className="flex gap-2">
          <button onClick={() => setAction("buy")}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
              isBuy ? "bg-[#0ecb81] text-white" : "bg-[#111] text-[#555555] border border-[#1a1a1a]/50 hover:text-[#808080]"
            }`}>Buy</button>
          <button onClick={() => setAction("sell")}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
              !isBuy ? "bg-[#f6465d] text-white" : "bg-[#111] text-[#555555] border border-[#1a1a1a]/50 hover:text-[#808080]"
            }`}>Sell</button>
        </div>

        {/* Order type + Limit Price */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <button onClick={() => setShowOrderType(!showOrderType)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#111] border border-[#1a1a1a]/50 text-[11px] text-[#808080] hover:text-[#e5e5e5] transition-colors">
              {orderType === "limit" ? "Limit" : "Market"}
              <svg width="8" height="5" viewBox="0 0 8 5" className="ml-0.5"><path d="M0.5 0.5L4 4L7.5 0.5" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg>
            </button>
            {showOrderType && (
              <div className="absolute top-full left-0 mt-1 bg-[#141414] border border-[#252525] rounded-lg overflow-hidden z-20 shadow-xl min-w-[90px]">
                <button onClick={() => { setOrderType("limit"); setShowOrderType(false); }}
                  className={`block w-full text-left px-3 py-1.5 text-[11px] hover:bg-[#1a1a1a] ${orderType === "limit" ? "text-[#e5e5e5]" : "text-[#808080]"}`}>Limit</button>
                <button onClick={() => { setOrderType("market"); setShowOrderType(false); }}
                  className={`block w-full text-left px-3 py-1.5 text-[11px] hover:bg-[#1a1a1a] ${orderType === "market" ? "text-[#e5e5e5]" : "text-[#808080]"}`}>Market</button>
              </div>
            )}
          </div>
          {orderType === "limit" && (
            <div className="flex-1 flex items-center bg-[#0a0a0a] rounded-lg border border-[#1a1a1a]/50 overflow-hidden">
              <button onClick={() => adjustPrice(-0.5)} className="px-2.5 py-1.5 text-[#555555] hover:text-[#e5e5e5] hover:bg-[#131313] text-sm transition-colors">−</button>
              <div className="flex-1 text-center text-xs font-bold text-[#e5e5e5] tabular-nums py-1.5">{priceNum.toFixed(1)}¢</div>
              <button onClick={() => adjustPrice(0.5)} className="px-2.5 py-1.5 text-[#555555] hover:text-[#e5e5e5] hover:bg-[#131313] text-sm transition-colors">+</button>
            </div>
          )}
        </div>

        {/* Amount */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="text-[10px] text-[#555555]">{inputMode === "dollars" ? "Amount" : "Shares"}</div>
            <div className="flex bg-[#0a0a0a] rounded-md p-0.5 border border-[#1a1a1a]/50">
              <button onClick={() => setInputMode("dollars")}
                className={`px-2 py-0.5 rounded text-[9px] font-medium transition-all ${inputMode === "dollars" ? "bg-[#1a1a1a] text-[#e5e5e5]" : "text-[#555555]"}`}>USD</button>
              <button onClick={() => setInputMode("shares")}
                className={`px-2 py-0.5 rounded text-[9px] font-medium transition-all ${inputMode === "shares" ? "bg-[#1a1a1a] text-[#e5e5e5]" : "text-[#555555]"}`}>Shares</button>
            </div>
          </div>
          <div className="flex items-center bg-[#0a0a0a] rounded-lg border border-[#1a1a1a]/50 overflow-hidden">
            <span className="pl-3 text-[#555555] text-xs">{inputMode === "dollars" ? "$" : "#"}</span>
            <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0.00" className="flex-1 bg-transparent px-2 py-2 text-xs text-[#e5e5e5] text-right focus:outline-none tabular-nums font-medium" />
          </div>
          <div className="flex gap-1 mt-1.5">
            {isBuy ? (
              (inputMode === "dollars" ? [1, 5, 10, 20, 50] : [10, 50, 100, 500]).map((v) => (
                <button key={v} onClick={() => setAmount(String(v))}
                  className="flex-1 py-0.5 rounded-md text-[9px] font-medium bg-[#111] text-[#555555] hover:text-[#e5e5e5] hover:bg-[#1a1a1a] border border-[#1a1a1a]/30 transition-colors">
                  {inputMode === "dollars" ? `$${v}` : v}
                </button>
              ))
            ) : (
              [10, 25, 50, 100].map((pct) => (
                <button key={pct} onClick={() => { if (curShares > 0) { setAmount(String(Math.floor(curShares * pct / 100))); setInputMode("shares"); } }}
                  className="flex-1 py-0.5 rounded-md text-[9px] font-medium bg-[#111] text-[#555555] hover:text-[#e5e5e5] hover:bg-[#1a1a1a] border border-[#1a1a1a]/30 transition-colors">
                  {pct === 100 ? "All" : `${pct}%`}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Summary */}
        <div className="space-y-0.5 text-[11px]">
          <div className="flex justify-between">
            <span className="text-[#555555]">{inputMode === "shares" ? "Shares" : "Est. shares"}</span>
            <span className="text-[#e5e5e5] tabular-nums">{shares > 0 ? shares.toFixed(1) : "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#555555]">Total</span>
            <span className="text-[#e5e5e5] font-bold tabular-nums">${total > 0 ? total.toFixed(2) : "0.00"}</span>
          </div>
          {isBuy && toWin > 0 && (
            <div className="flex justify-between">
              <span className="text-[#555555]">Potential</span>
              <span className="text-[#0ecb81] font-bold tabular-nums">+${toWin.toFixed(2)}</span>
            </div>
          )}
        </div>

        {/* Place Order — blue */}
        <button
          onClick={placeOrder}
          disabled={!hasKey || loading || total <= 0}
          className="w-full py-3 rounded-lg font-bold text-sm text-white bg-blue-600 hover:bg-blue-500 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {!hasKey ? "Import key in Settings" : "Place Order"}
        </button>
      </div>
    </div>
  );
}
