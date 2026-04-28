"use client";

type Event = { id: string; slug: string; title: string; start_date: string; end_date: string };

export function shortSlug(slug: string): string {
  const m = slug.match(/(\w+)-(\d+)-(\w+)-(\d+)$/);
  if (m) return `${m[1].charAt(0).toUpperCase() + m[1].slice(1)} ${m[2]} - ${m[3].charAt(0).toUpperCase() + m[3].slice(1)} ${m[4]}`;
  return slug;
}

export function eventDurationDays(ev: Event): number {
  const m = ev.slug.match(/(\w+)-(\d+)-(\w+)-(\d+)$/);
  if (!m) return 0;
  const months: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  };
  return (months[m[3].toLowerCase()] ?? 0) * 30 + parseInt(m[4]) - (months[m[1].toLowerCase()] ?? 0) * 30 - parseInt(m[2]);
}

export default function EventTabs({
  events, selectedEvent, onSelect, tweetCounts, now,
}: {
  events: Event[];
  selectedEvent: string | null;
  onSelect: (id: string) => void;
  tweetCounts: Record<string, number>;
  now: number;
}) {
  const weeklyEvents = events.filter((e) => eventDurationDays(e) >= 5);
  const dailyEvents = events.filter((e) => eventDurationDays(e) < 5);
  const currentTweetCount = selectedEvent ? (tweetCounts[selectedEvent] ?? 0) : 0;
  const selectedEv = events.find((e) => e.id === selectedEvent);

  // Timer
  let timerStr = "";
  if (selectedEv?.end_date) {
    const endTs = Math.floor(new Date(selectedEv.end_date).getTime() / 1000);
    const remaining = endTs - now;
    if (remaining <= 0) {
      timerStr = "ENDED";
    } else {
      const d = Math.floor(remaining / 86400);
      const h = Math.floor((remaining % 86400) / 3600);
      const m = Math.floor((remaining % 3600) / 60);
      const parts = [];
      if (d > 0) parts.push(`${d}d`);
      if (h > 0) parts.push(`${h}h`);
      parts.push(`${m}m`);
      timerStr = parts.join(" ");
    }
  }

  return (
    <div className="space-y-1.5">
      {weeklyEvents.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-neutral-600 w-12 shrink-0">7-day</span>
          <div className="flex gap-1 overflow-x-auto">
            {weeklyEvents.map((ev) => (
              <button key={ev.id} onClick={() => onSelect(ev.id)}
                className={`px-2.5 py-1 rounded text-[10px] font-bold whitespace-nowrap transition-colors ${
                  selectedEvent === ev.id ? "bg-blue-600 text-white" : "bg-neutral-800/60 text-neutral-500 hover:text-neutral-200"
                }`}>{shortSlug(ev.slug)}</button>
            ))}
          </div>
        </div>
      )}
      {dailyEvents.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-neutral-600 w-12 shrink-0">2-day</span>
          <div className="flex gap-1 overflow-x-auto">
            {dailyEvents.map((ev) => (
              <button key={ev.id} onClick={() => onSelect(ev.id)}
                className={`px-2.5 py-1 rounded text-[10px] font-bold whitespace-nowrap transition-colors ${
                  selectedEvent === ev.id ? "bg-purple-600 text-white" : "bg-neutral-800/60 text-neutral-500 hover:text-neutral-200"
                }`}>{shortSlug(ev.slug)}</button>
            ))}
          </div>
        </div>
      )}
      {/* Count + timer */}
      <div className="flex items-center gap-3">
        <span className="text-[10px] uppercase tracking-wider text-neutral-600 w-12 shrink-0"></span>
        <div className="flex items-center gap-2 px-2.5 py-1 rounded bg-blue-950/40 border border-blue-800/30">
          <span className="text-blue-400 text-[10px]">TWEETS</span>
          <span className="text-lg font-bold text-blue-300 tabular-nums">{currentTweetCount}</span>
        </div>
        {timerStr && (
          <>
            <div className="w-px h-5 bg-neutral-800" />
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-neutral-800/40 border border-neutral-700/30">
              <span className="text-neutral-500 text-[10px]">ENDS</span>
              <span className={`text-sm font-bold tabular-nums ${timerStr === "ENDED" ? "text-rose-400" : "text-amber-400"}`}>{timerStr}</span>
            </div>
          </>
        )}
        {selectedEv && (
          <span className="text-neutral-600 text-[10px]">{shortSlug(selectedEv.slug)}</span>
        )}
      </div>
    </div>
  );
}
