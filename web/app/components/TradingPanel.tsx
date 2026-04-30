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
  const pendingToastRef = useRef<string | null>(null);
  const orderStartTimeRef = useRef<number>(0);

  // Sync from orderbook click
  useEffect(() => {
    if (initialAction) setAction(initialAction);
  }, [initialAction]);

  useEffect(() => {
    if (initialAmount) { setAmount(initialAmount); setInputMode("shares"); }
  }, [initialAmount]);

  const handleOutcomeChange = (o: "yes" | "no") => {
    setOutcome(o);
    onOutcomeChange?.(o);
  };

  useEffect(() => {
    if (limitPrice != null) {
      setOrderType("limit");
      setPrice((limitPrice * 100).toFixed(1));
    }
  }, [limitPrice]);

  useEffect(() => {
    if (bracket) {
      let p: number | null = null;
      if (outcome === "yes") {
        p = action === "buy" ? bracket.ask : bracket.bid;
      } else {
        p = action === "buy"
          ? (bracket.bid != null ? 1 - bracket.bid : null)
          : (bracket.ask != null ? 1 - bracket.ask : null);
      }
      if (p != null) setPrice((p * 100).toFixed(1));
    }
  }, [bracket?.id, outcome, action]);

  // Listen for WS events to resolve pending toast
  useEffect(() => {
    const ts = { background: "#141414", border: "1px solid #252525", borderRadius: "12px" };
    const onFill = () => {
      if (pendingToastRef.current) {
        toast.success("Filled!", { id: pendingToastRef.current, duration: 3000, style: { ...ts, color: "#0ecb81" } });
        pendingToastRef.current = null;
        setLoading(false);
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

  // Current shares for this bracket+outcome
  const currentTokenId = outcome === "yes" ? bracket?.yes_token_id : bracket?.no_token_id;
  const currentPos = positions?.find((p) => p.asset === currentTokenId);
  const currentShares = currentPos ? parseFloat(currentPos.size || 0) : 0;

  // Prices
  const yesBid = bracket?.bid != null ? bracket.bid * 100 : null;
  const yesAsk = bracket?.ask != null ? bracket.ask * 100 : null;
  const noBid = yesAsk != null ? (100 - yesAsk) : null;
  const noAsk = yesBid != null ? (100 - yesBid) : null;

  const priceNum = parseFloat(price) || 0;
  const amountNum = parseFloat(amount) || 0;

  let shares = 0;
  let total = 0;
  let toWin = 0;

  if (priceNum > 0 && amountNum > 0) {
    if (inputMode === "shares") {
      shares = amountNum;
      total = (shares * priceNum) / 100;
      toWin = shares * 1.0 - total;
    } else {
      total = amountNum;
      shares = (total * 100) / priceNum;
      toWin = shares * 1.0 - total;
    }
  }

  const adjustPrice = (delta: number) => {
    const current = parseFloat(price) || 0;
    const next = Math.max(0.1, Math.min(99.9, current + delta));
    setPrice(next.toFixed(1));
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
      const side = action === "buy" ? "BUY" : "SELL";
      const body: Record<string, string | number> = {
        private_key: key,
        token_id: bracket.yes_token_id,
        side,
        order_type: orderType,
        funder,
      };
      if (orderType === "limit") {
        body.price = priceNum / 100;
        body.size = shares;
      } else {
        body.amount = total;
      }
      const r = await fetch("/api/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, _t0: Date.now() }),
      });
      const d = await r.json();

      if (d.status === "ok") {
        toast.loading("Waiting for confirmation...", { id: toastId, style: { ...ts, color: "#0ecb81" } });
        setTimeout(() => {
          if (pendingToastRef.current === toastId) {
            toast.success("Order submitted", { id: toastId, duration: 3000, style: { ...ts, color: "#0ecb81" } });
            pendingToastRef.current = null; setLoading(false);
          }
        }, 15000);
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
    return (
      <div className="h-full flex items-center justify-center text-[#555555] text-xs p-4">
        <div className="text-center">
          <div className="text-2xl mb-1 text-[#1a1a1a]">&#8644;</div>
          <div>Select a bracket</div>
        </div>
      </div>
    );
  }

  const isBuy = action === "buy";

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        {/* Bracket label */}
        <div className="px-3 pt-3 pb-2 border-b border-[#1a1a1a]/40">
          <span className="text-base font-bold text-[#e5e5e5]">{bracket.label}</span>
        </div>

        {/* Buy / Sell toggle */}
        <div className="px-3 pt-2 pb-1">
          <div className="flex bg-[#0d0d0d] rounded-lg p-0.5 border border-[#1a1a1a]/50">
            <button onClick={() => setAction("buy")}
              className={`flex-1 py-2 rounded-md text-sm font-bold transition-all ${
                isBuy ? "bg-[#0ecb81] text-white" : "text-[#555555] hover:text-[#808080]"
              }`}>Buy</button>
            <button onClick={() => setAction("sell")}
              className={`flex-1 py-2 rounded-md text-sm font-bold transition-all ${
                !isBuy ? "bg-[#f6465d] text-white" : "text-[#555555] hover:text-[#808080]"
              }`}>Sell</button>
          </div>
        </div>

        {/* Yes / No + Order Type */}
        <div className="px-3 py-2 flex items-center gap-2">
          <div className="flex gap-1.5 flex-1">
            <button onClick={() => handleOutcomeChange("yes")}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                outcome === "yes"
                  ? "bg-[#0ecb81]/15 text-[#0ecb81] border border-[#0ecb81]/30"
                  : "bg-[#111] text-[#555555] border border-[#1a1a1a]/50 hover:text-[#808080]"
              }`}>
              Yes {yesAsk != null ? `${yesAsk.toFixed(1)}¢` : ""}
            </button>
            <button onClick={() => handleOutcomeChange("no")}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                outcome === "no"
                  ? "bg-[#f6465d]/15 text-[#f6465d] border border-[#f6465d]/30"
                  : "bg-[#111] text-[#555555] border border-[#1a1a1a]/50 hover:text-[#808080]"
              }`}>
              No {noAsk != null ? `${noAsk.toFixed(1)}¢` : ""}
            </button>
          </div>
          <select value={orderType} onChange={(e) => setOrderType(e.target.value as "market" | "limit")}
            className="bg-[#111] text-[11px] text-[#808080] border border-[#1a1a1a]/50 rounded-lg px-2 py-2 cursor-pointer focus:outline-none">
            <option value="limit" className="bg-[#060606]">Limit</option>
            <option value="market" className="bg-[#060606]">Market</option>
          </select>
        </div>

        {/* Current shares */}
        {currentShares > 0 && (
          <div className="px-3 pb-1">
            <div className={`text-[10px] px-2 py-1 rounded-md inline-flex items-center gap-1 ${
              outcome === "yes" ? "bg-[#0ecb81]/10 text-[#0ecb81]" : "bg-[#f6465d]/10 text-[#f6465d]"
            }`}>
              <span>You own</span>
              <span className="font-bold">{currentShares.toFixed(0)}</span>
              <span>{outcome === "yes" ? "Yes" : "No"} shares</span>
            </div>
          </div>
        )}

        {/* Limit Price */}
        {orderType === "limit" && (
          <div className="px-3 py-2">
            <div className="text-[11px] text-[#555555] mb-1.5">Limit Price</div>
            <div className="flex items-center bg-[#0d0d0d] rounded-lg border border-[#1a1a1a]/50 overflow-hidden">
              <button onClick={() => adjustPrice(-0.5)}
                className="px-3 py-2 text-[#555555] hover:text-[#e5e5e5] hover:bg-[#131313] text-lg font-light transition-colors">−</button>
              <div className="flex-1 text-center text-sm font-bold text-[#e5e5e5] tabular-nums py-2">
                {priceNum.toFixed(1)}¢
              </div>
              <button onClick={() => adjustPrice(0.5)}
                className="px-3 py-2 text-[#555555] hover:text-[#e5e5e5] hover:bg-[#131313] text-lg font-light transition-colors">+</button>
            </div>
          </div>
        )}

        {/* Amount input */}
        <div className="px-3 py-2">
          {/* USD / Shares toggle */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[11px] text-[#555555]">{inputMode === "dollars" ? "Amount" : "Shares"}</div>
            <div className="flex bg-[#0d0d0d] rounded-md p-0.5 border border-[#1a1a1a]/50">
              <button onClick={() => setInputMode("dollars")}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                  inputMode === "dollars" ? "bg-[#1a1a1a] text-[#e5e5e5]" : "text-[#555555]"
                }`}>USD</button>
              <button onClick={() => setInputMode("shares")}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                  inputMode === "shares" ? "bg-[#1a1a1a] text-[#e5e5e5]" : "text-[#555555]"
                }`}>Shares</button>
            </div>
          </div>
          <div className="flex items-center bg-[#0d0d0d] rounded-lg border border-[#1a1a1a]/50 overflow-hidden">
            <span className="pl-3 text-[#555555] text-sm">{inputMode === "dollars" ? "$" : "#"}</span>
            <input type="text" inputMode="decimal" value={amount} onChange={(e) => {
              const v = e.target.value.replace(/[^0-9.]/g, "");
              setAmount(v);
            }}
              placeholder="0.00"
              className="flex-1 bg-transparent px-2 py-2.5 text-sm text-[#e5e5e5] text-right focus:outline-none tabular-nums font-medium" />
          </div>
          {/* Quick buttons */}
          <div className="flex gap-1 mt-2">
            {isBuy ? (
              (inputMode === "dollars" ? [1, 5, 10, 20, 50] : [10, 50, 100, 500]).map((v) => (
                <button key={v} onClick={() => setAmount(String(v))}
                  className="flex-1 py-1 rounded-md text-[10px] font-medium bg-[#111] text-[#555555] hover:text-[#e5e5e5] hover:bg-[#1a1a1a] border border-[#1a1a1a]/30 transition-colors">
                  {inputMode === "dollars" ? `$${v}` : v}
                </button>
              ))
            ) : (
              [10, 25, 50, 100].map((pct) => (
                <button key={pct} onClick={() => {
                  if (currentShares > 0) {
                    const sellShares = Math.floor(currentShares * pct / 100);
                    setAmount(String(sellShares));
                    setInputMode("shares");
                  }
                }}
                  className="flex-1 py-1 rounded-md text-[10px] font-medium bg-[#111] text-[#555555] hover:text-[#e5e5e5] hover:bg-[#1a1a1a] border border-[#1a1a1a]/30 transition-colors">
                  {pct === 100 ? "All" : `${pct}%`}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Summary */}
        <div className="px-3 py-2">
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-[#555555]">{inputMode === "shares" ? "Shares" : "Est. shares"}</span>
              <span className="text-[#e5e5e5] tabular-nums font-medium">{shares > 0 ? shares.toFixed(1) : "—"}</span>
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
        </div>

        {/* Submit */}
        <div className="px-3 pb-3">
          <button
            onClick={placeOrder}
            disabled={!hasKey || loading || total <= 0}
            className={`w-full py-3 rounded-lg font-bold text-sm text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
              isBuy ? "bg-[#0ecb81] hover:bg-[#0bb874]" : "bg-[#f6465d] hover:bg-[#e03e54]"
            }`}
          >
            {!hasKey ? "Import key in Settings" : isBuy ? `Buy ${outcome === "yes" ? "Yes" : "No"}` : `Sell ${outcome === "yes" ? "Yes" : "No"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
