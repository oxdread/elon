"use client";

import { useEffect, useState } from "react";

type Comment = {
  id: string;
  body: string;
  createdAt: string;
  profile?: {
    name?: string;
    pseudonym?: string;
    profileImage?: string;
  };
};

export default function Comments({ initialData }: { initialData?: Comment[] | null }) {
  const [comments, setComments] = useState<Comment[]>(initialData ?? []);
  const [loading, setLoading] = useState(!initialData);

  const managed = initialData !== undefined;

  useEffect(() => {
    if (initialData) { setComments(initialData); setLoading(false); }
  }, [initialData]);

  useEffect(() => {
    if (managed) return;
    let active = true;
    const fetch_ = async () => {
      try {
        const r = await fetch("/api/comments?limit=30", { cache: "no-store" });
        const d = await r.json();
        if (active && Array.isArray(d)) setComments(d);
      } catch {}
      if (active) setLoading(false);
    };
    fetch_();
    const id = setInterval(fetch_, 10000);
    return () => { active = false; clearInterval(id); };
  }, []);

  if (loading) return <div className="px-3 py-3 text-[#808080] text-xs">Loading comments...</div>;

  const now = Math.floor(Date.now() / 1000);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center px-3 py-1.5 border-b border-[#1e1e21] shrink-0">
        <span className="text-[11px] text-[#808080] uppercase tracking-wider">Comments</span>
        <span className="ml-auto text-[10px] text-[#555555]">Elon Tweets Series</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {comments.length === 0 ? (
          <div className="px-3 py-3 text-[#555555] text-xs">No comments yet</div>
        ) : (
          comments.map((c) => {
            const name = c.profile?.name || c.profile?.pseudonym || "Anon";
            const ts = Math.floor(new Date(c.createdAt).getTime() / 1000);
            const age = now - ts;
            const ageStr = age < 60 ? `${age}s` : age < 3600 ? `${Math.floor(age / 60)}m` : age < 86400 ? `${Math.floor(age / 3600)}h` : `${Math.floor(age / 86400)}d`;
            return (
              <div key={c.id} className="flex gap-2 px-3 py-2 border-b border-[#1a1a1c]/30 hover:bg-white/[0.01]">
                <div className="w-5 h-5 rounded-full bg-[#131313] shrink-0 overflow-hidden mt-0.5">
                  {c.profile?.profileImage && (
                    <img src={c.profile.profileImage} alt="" className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-[#e5e5e5]">{name}</span>
                    <span className="text-[10px] text-[#222222] tabular-nums">{ageStr}</span>
                  </div>
                  <p className="text-[11px] text-[#808080] break-words leading-relaxed">{c.body || <span className="italic text-[#222222]">empty</span>}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
