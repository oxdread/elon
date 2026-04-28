"use client";

import { useEffect, useState, useRef } from "react";

type OrderEntry = { price: string; size: string };

export default function OrderBook({
  tokenId, label, initialData, outcome = "yes",
  onClickOrder,
}: {
  tokenId: string;
  label: string;
  initialData?: { bids: OrderEntry[]; asks: OrderEntry[] } | null;
  outcome?: "yes" | "no";
  onClickOrder?: (side: "buy" | "sell", price: number, size: number) => void;
}) {
  const [book, setBook] = useState<{ bids: OrderEntry[]; asks: OrderEntry[] } | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const managed = initialData !== undefined;
  const asksEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialData) { setBook(initialData); setLoading(false); }
  }, [initialData]);

  useEffect(() => {
    if (managed) return;
    let active = true;
    const fetchBook = async () => {
      try {
        const r = await fetch(`/api/orderbook?token_id=${tokenId}`, { cache: "no-store" });
        const d = await r.json();
        if (active && !d.error) {
          const bids = (d.bids || []).sort((a: OrderEntry, b: OrderEntry) => parseFloat(b.price) - parseFloat(a.price));
          const asks = (d.asks || []).sort((a: OrderEntry, b: OrderEntry) => parseFloat(a.price) - parseFloat(b.price));
          setBook({ bids, asks });
        }
      } catch {}
      if (active) setLoading(false);
    };
    fetchBook();
    const id = setInterval(fetchBook, 2000);
    return () => { active = false; clearInterval(id); };
  }, [tokenId, managed]);

  // Auto-scroll asks to bottom (near spread) on first load
  useEffect(() => {
    if (asksEndRef.current) {
      asksEndRef.current.scrollIntoView({ block: "end" });
    }
  }, [book?.asks?.length]);

  if (loading) return <div className="flex items-center justify-center h-full text-neutral-600 text-xs">Loading...</div>;
  if (!book) return <div className="flex items-center justify-center h-full text-neutral-600 text-xs">No data</div>;

  const asks = book.asks.slice(0, 30).reverse();
  const bids = book.bids.slice(0, 30);
  const maxSize = Math.max(1, ...asks.map((a) => parseFloat(a.size)), ...bids.map((b) => parseFloat(b.size)));

  const bestBid = bids.length > 0 ? parseFloat(bids[0].price) : null;
  const bestAsk = asks.length > 0 ? parseFloat(asks[asks.length - 1].price) : null;
  const spread = bestBid != null && bestAsk != null ? bestAsk - bestBid : null;
  const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null;

  const handleClick = (side: "buy" | "sell", price: string, size: string) => {
    if (onClickOrder) {
      onClickOrder(side, parseFloat(price), parseFloat(size));
    }
  };

  return (
    <div className="flex flex-col h-full text-[11px] font-mono">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-[#1a1a1a] shrink-0">
        <span className="text-[#808080]">Price</span>
        <span className="text-[#808080]">Size ($)</span>
      </div>

      {/* Asks — red, scrollable, auto-scroll to bottom */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="flex flex-col justify-end min-h-full">
          {asks.map((a, i) => {
            const pct = (parseFloat(a.size) / maxSize) * 100;
            return (
              <div key={i}
                className="flex items-center px-2 py-[2px] relative cursor-pointer hover:bg-[#131313]"
                onClick={() => handleClick("buy", a.price, a.size)}>
                <div className="absolute right-0 top-0 bottom-0 bg-[#f6465d12]" style={{ width: `${pct}%` }} />
                <span className="relative text-[#f6465d] flex-1 tabular-nums">{(parseFloat(a.price) * 100).toFixed(1)}¢</span>
                <span className="relative text-[#e5e5e5] tabular-nums">{parseFloat(a.size).toFixed(0)}</span>
              </div>
            );
          })}
          <div ref={asksEndRef} />
        </div>
      </div>

      {/* Spread / Mid price */}
      <div className="flex items-center justify-between px-2 py-1.5 border-y border-[#1a1a1a] shrink-0 bg-[#131313]">
        <span className="text-[#e5e5e5] font-bold tabular-nums">
          {mid != null ? (mid * 100).toFixed(1) + "¢" : "—"}
        </span>
        {spread != null && (
          <span className="text-[#555555] text-[10px] tabular-nums">
            spread {(spread * 100).toFixed(1)}¢
          </span>
        )}
      </div>

      {/* Bids — green, scrollable */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {bids.map((b, i) => {
          const pct = (parseFloat(b.size) / maxSize) * 100;
          return (
            <div key={i}
              className="flex items-center px-2 py-[2px] relative cursor-pointer hover:bg-[#131313]"
              onClick={() => handleClick("sell", b.price, b.size)}>
              <div className="absolute right-0 top-0 bottom-0 bg-[#0ecb8112]" style={{ width: `${pct}%` }} />
              <span className="relative text-[#0ecb81] flex-1 tabular-nums">{(parseFloat(b.price) * 100).toFixed(1)}¢</span>
              <span className="relative text-[#e5e5e5] tabular-nums">{parseFloat(b.size).toFixed(0)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
