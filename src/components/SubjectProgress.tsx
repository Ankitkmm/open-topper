"use client";

import { useEffect, useState } from "react";
import { useUserData } from "@/components/auth/UserDataProvider";
import { PROGRESS_EVENT, readProgressMapForScope } from "@/lib/local-user-store";

type ProgressRecord = {
  done?: boolean;
  notes?: boolean;
  answer?: boolean;
  full?: boolean;
};

export function SubjectProgress({ questionIds }: { questionIds: string[] }) {
  const { userScope } = useUserData();
  const [counts, setCounts] = useState({ done: 0, notes: 0, answer: 0, full: 0 });

  useEffect(() => {
    const update = () => {
      const progress = readProgressMapForScope(userScope) as Record<string, ProgressRecord>;
      const next = { done: 0, notes: 0, answer: 0, full: 0 };
      for (const id of questionIds) {
        if (progress[id]?.done) next.done += 1;
        if (progress[id]?.notes) next.notes += 1;
        if (progress[id]?.answer) next.answer += 1;
        if (progress[id]?.full) next.full += 1;
      }
      setCounts(next);
    };
    update();
    window.addEventListener(PROGRESS_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(PROGRESS_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, [questionIds, userScope]);

  const total = questionIds.length || 1;
  const pct = Math.round((counts.full / total) * 100);

  return (
    <div className="soft-panel min-w-[240px] p-4">
      <div className="overline mb-2">Your progress</div>
      <div className="mb-3 flex items-end gap-2">
        <span className="mono-stat text-3xl text-accent">{counts.full}</span>
        <span className="mb-1 text-sm text-secondary">/ {questionIds.length} fully completed</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full border border-terminal bg-[var(--bg-elevated)]">
        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-muted">
        <span>{counts.done} done</span>
        <span>{counts.notes} notes</span>
        <span>{counts.answer} answers</span>
      </div>
    </div>
  );
}
