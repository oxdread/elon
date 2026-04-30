"use client";

import { useState, useEffect, useRef } from "react";
import toast from "react-hot-toast";

type Bracket = {
  id: string; label: string; yes_token_id: string | null;
  mid: number | null; bid: number | null; ask: number | null;
};

export default function TradingPanel({
  bracket, limitPrice, initialAction, initialAmount, onOutcomeChange,
}: {
  bracket: Bracket | null;
  limitPrice?: number | null;
  initialAction?: "buy" | "sell";
  initialAmount?: string;
  onOutcomeChange?: (outcome: "yes" | "no") => void;
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

  // Notify parent when outcome changes
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

  // Set default price when bracket/action changes — use ask for buys, bid for sells
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
    const toastStyle = { background: "#141414", border: "1px solid #252525", borderRadius: "12px" };

    const onFill = () => {
      if (pendingToastRef.current) {
        const elapsed = ((performance.now() - orderStartTimeRef.current) / 1000).toFixed(1);
        console.log(`[trade] Filled! ${elapsed}s from click`);
        toast.success("Filled!", { id: pendingToastRef.current, duration: 3000, style: { ...toastStyle, color: "#0ecb81" } });
        pendingToastRef.current = null;
        setLoading(false);
      }
    };
    const onOrderEvent = (e: Event) => {
      if (!pendingToastRef.current) return;
      const detail = (e as CustomEvent).detail;
      const elapsed = ((performance.now() - orderStartTimeRef.current) / 1000).toFixed(1);
      console.log(`[trade] Order ${detail?.type} ${elapsed}s from click`);
      if (detail?.type === "PLACEMENT") {
        toast.success("Limit order placed", { id: pendingToastRef.current, duration: 3000, style: { ...toastStyle, color: "#3b82f6" } });
        pendingToastRef.current = null;
        setLoading(false);
      } else if (detail?.type === "CANCELLATION") {
        toast.error("Order cancelled", { id: pendingToastRef.current, duration: 3000, style: { ...toastStyle, color: "#f6465d" } });
        pendingToastRef.current = null;
        setLoading(false);
      }
    };

    window.addEventListener("ws-trade-fill", onFill);
    window.addEventListener("ws-order-event", onOrderEvent);
    return () => {
      window.removeEventListener("ws-trade-fill", onFill);
      window.removeEventListener("ws-order-event", onOrderEvent);
    };
  }, []);

  const hasKey = typeof window !== "undefined" && !!localStorage.getItem("poly_private_key");

  // Prices
  const yesBid = bracket?.bid != null ? bracket.bid * 100 : null;
  const yesAsk = bracket?.ask != null ? bracket.ask * 100 : null;
  const noBid = yesAsk != null ? (100 - yesAsk) : null;
  const noAsk = yesBid != null ? (100 - yesBid) : null;

  const priceNum = parseFloat(price) || 0; // in cents
  const amountNum = parseFloat(amount) || 0;

  // Calculations
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
    const toastStyle = { background: "#141414", color: "#e5e5e5", border: "1px solid #252525", borderRadius: "12px" };
    const toastId = toast.loading("Placing order...", { position: "bottom-right", style: toastStyle });
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
        // API succeeded — now wait for WS to confirm fill/placement
        toast.loading("Order submitted, waiting for confirmation...", { id: toastId, style: { ...toastStyle, color: "#0ecb81" } });
        // Safety timeout: if no WS event in 15s, dismiss anyway
        setTimeout(() => {
          if (pendingToastRef.current === toastId) {
            toast.success("Order submitted", { id: toastId, duration: 3000, style: { ...toastStyle, color: "#0ecb81" } });
            pendingToastRef.current = null;
            setLoading(false);
          }
        }, 15000);
      } else {
        toast.error(d.error || "Order failed", { id: toastId, duration: 5000, style: { ...toastStyle, color: "#f6465d" } });
        pendingToastRef.current = null;
        setLoading(false);
      }
    } catch (e) {
      toast.error(String(e).slice(0, 100), { id: toastId, duration: 5000, style: { ...toastStyle, color: "#f6465d" } });
      pendingToastRef.current = null;
      setLoading(false);
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

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        {/* Bracket label */}
        <div className="px-3 pt-3 pb-2 border-b border-[#1a1a1a]/40 mb-1">
          <span className="text-base font-bold text-[#e5e5e5]">{bracket.label}</span>
        </div>

        {/* Buy / Sell tabs */}
        <div className="flex items-center px-3 pb-2">
          <div className="flex gap-4">
            <button onClick={() => setAction("buy")}
              className={`text-sm font-bold pb-1 transition-colors ${
                action === "buy" ? "text-[#e5e5e5] border-b-2 border-neutral-100" : "text-[#555555] hover:text-[#808080]"
              }`}>Buy</button>
            <button onClick={() => setAction("sell")}
              className={`text-sm font-bold pb-1 transition-colors ${
                action === "sell" ? "text-[#e5e5e5] border-b-2 border-neutral-100" : "text-[#555555] hover:text-[#808080]"
              }`}>Sell</button>
          </div>
          <div className="ml-auto">
            <select value={orderType} onChange={(e) => setOrderType(e.target.value as "market" | "limit")}
              className="bg-transparent text-xs text-[#808080] cursor-pointer focus:outline-none appearance-none pr-3">
              <option value="limit" className="bg-[#060606]">Limit</option>
              <option value="market" className="bg-[#060606]">Market</option>
            </select>
            <span className="text-[#555555] text-[10px] -ml-2">&#9662;</span>
          </div>
        </div>

        <div className="border-t border-[#1a1a1a]/40 mx-3" />

        {/* Yes / No buttons */}
        <div className="flex gap-2 px-3 py-3">
          <button onClick={() => handleOutcomeChange("yes")}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
              outcome === "yes"
                ? "bg-[#0ecb81] text-white"
                : "bg-[#131313]/60 text-[#808080] hover:bg-[#131313] border border-[#1a1a1a]/50"
            }`}>
            Yes {yesAsk != null ? `${yesAsk.toFixed(1)}¢` : ""}
          </button>
          <button onClick={() => handleOutcomeChange("no")}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
              outcome === "no"
                ? "bg-[#f6465d] text-white"
                : "bg-[#131313]/60 text-[#808080] hover:bg-[#131313] border border-[#1a1a1a]/50"
            }`}>
            No {noAsk != null ? `${noAsk.toFixed(1)}¢` : ""}
          </button>
        </div>

        {/* Limit Price */}
        {orderType === "limit" && (
          <div className="px-3 pb-3">
            <div className="border-t border-[#1a1a1a]/40 mb-3" />
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#808080]">Limit Price</span>
              <div className="flex items-center gap-0 border border-[#1a1a1a]/50 rounded overflow-hidden">
                <button onClick={() => adjustPrice(-0.5)}
                  className="px-2.5 py-1.5 text-[#808080] hover:text-[#e5e5e5] hover:bg-[#131313] text-sm">−</button>
                <div className="px-3 py-1.5 text-sm font-bold text-[#e5e5e5] tabular-nums min-w-[60px] text-center bg-[#060606]">
                  {priceNum.toFixed(1)}¢
                </div>
                <button onClick={() => adjustPrice(0.5)}
                  className="px-2.5 py-1.5 text-[#808080] hover:text-[#e5e5e5] hover:bg-[#131313] text-sm">+</button>
              </div>
            </div>
          </div>
        )}

        {/* Amount input */}
        <div className="px-3 pb-2">
          <div className="border-t border-[#1a1a1a]/40 mb-3" />
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#808080]">{inputMode === "dollars" ? "Amount" : "Shares"}</span>
              <button onClick={() => setInputMode(inputMode === "dollars" ? "shares" : "dollars")}
                className="text-[9px] text-[#3b82f6] hover:text-blue-300 underline">
                Switch to {inputMode === "dollars" ? "shares" : "$"}
              </button>
            </div>
          </div>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="w-full bg-[#060606] border border-[#1a1a1a] rounded-lg px-3 py-2 text-sm text-[#e5e5e5] text-right focus:outline-none focus:border-blue-600 tabular-nums" />
          <div className="flex gap-1.5 mt-2">
            {(inputMode === "dollars" ? [1, 5, 10, 20, 50] : [10, 50, 100, 500]).map((v) => (
              <button key={v} onClick={() => setAmount(String(v))}
                className="flex-1 py-1 rounded-full text-[10px] font-medium bg-[#131313]/60 text-[#808080] hover:text-[#e5e5e5] hover:bg-[#1a1a1a]/60 transition-colors">
                {inputMode === "dollars" ? `$${v}` : v}
              </button>
            ))}
          </div>
        </div>

        {/* Summary */}
        <div className="px-3 pb-3">
          <div className="border-t border-[#1a1a1a]/40 mb-3" />
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-[#808080]">Total</span>
              <span className="text-[#e5e5e5] font-bold tabular-nums">${total.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[#808080]">To win</span>
              <span className="text-[#0ecb81] font-bold tabular-nums">${toWin > 0 ? toWin.toFixed(2) : "0.00"}</span>
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="px-3 pb-3">
          <button
            onClick={placeOrder}
            disabled={!hasKey || loading || total <= 0}
            className="w-full py-3 rounded-lg font-bold text-sm bg-blue-600 hover:bg-blue-500 text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {!hasKey ? "Import key in Settings" : `Place ${action} order`}
          </button>
        </div>
      </div>
    </div>
  );
}
