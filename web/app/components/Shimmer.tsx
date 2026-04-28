"use client";

export function Shimmer({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-pulse ${className}`}>
      <div className="h-full w-full bg-gradient-to-r from-[#141414] via-[#1a1a1a] to-[#141414] bg-[length:200%_100%] animate-[shimmer_1.5s_ease-in-out_infinite] rounded" />
    </div>
  );
}

export function ChartShimmer() {
  return (
    <div className="w-full h-full flex flex-col p-4 gap-2">
      <div className="flex justify-between">
        <div className="h-3 w-24 bg-[#1a1a1a] rounded animate-pulse" />
        <div className="h-3 w-16 bg-[#1a1a1a] rounded animate-pulse" />
      </div>
      <div className="flex-1 flex items-end gap-1">
        {Array.from({ length: 40 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 bg-[#1a1a1a] rounded-t animate-pulse"
            style={{ height: `${20 + Math.random() * 60}%`, animationDelay: `${i * 30}ms` }}
          />
        ))}
      </div>
      <div className="flex justify-between">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-2 w-10 bg-[#141414] rounded animate-pulse" />
        ))}
      </div>
    </div>
  );
}

export function OrderbookShimmer() {
  return (
    <div className="w-full h-full flex flex-col p-2 gap-1">
      <div className="flex justify-between mb-1">
        <div className="h-2 w-12 bg-[#1a1a1a] rounded animate-pulse" />
        <div className="h-2 w-12 bg-[#1a1a1a] rounded animate-pulse" />
      </div>
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="flex justify-between">
          <div className="h-3 w-14 bg-[#f6465d08] rounded animate-pulse" style={{ animationDelay: `${i * 50}ms` }} />
          <div className="h-3 w-10 bg-[#1a1a1a] rounded animate-pulse" style={{ animationDelay: `${i * 50}ms` }} />
        </div>
      ))}
      <div className="h-4 w-20 bg-[#1a1a1a] rounded animate-pulse my-1 mx-auto" />
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="flex justify-between">
          <div className="h-3 w-14 bg-[#0ecb8108] rounded animate-pulse" style={{ animationDelay: `${i * 50}ms` }} />
          <div className="h-3 w-10 bg-[#1a1a1a] rounded animate-pulse" style={{ animationDelay: `${i * 50}ms` }} />
        </div>
      ))}
    </div>
  );
}

export function PanelShimmer({ rows = 5 }: { rows?: number }) {
  return (
    <div className="w-full h-full flex flex-col p-3 gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-2 items-center" style={{ animationDelay: `${i * 80}ms` }}>
          <div className="w-6 h-6 rounded-full bg-[#1a1a1a] animate-pulse shrink-0" />
          <div className="flex-1">
            <div className="h-2.5 w-3/4 bg-[#1a1a1a] rounded animate-pulse mb-1" />
            <div className="h-2 w-1/2 bg-[#141414] rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
