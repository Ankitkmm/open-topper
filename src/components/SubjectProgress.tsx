"use client";

import { useMemo } from "react";
import { useUserData } from "@/components/auth/UserDataProvider";

type ProgressRecord = {
  done?: boolean;
};

export function SubjectProgress({ questionIds, label = "Overall progress" }: { questionIds: string[]; label?: string }) {
  const { progressMap } = useUserData();
  const done = useMemo(() => {
    const progress = progressMap as Record<string, ProgressRecord>;
    return questionIds.reduce((sum, id) => sum + (progress[id]?.done ? 1 : 0), 0);
  }, [progressMap, questionIds]);

  const total = questionIds.length || 1;
  const pct = Math.round((done / total) * 100);

  return (
    <div className="soft-panel min-w-[240px] p-4">
      <div className="overline mb-2">{label}</div>
      <div className="mb-3 flex items-end gap-2">
        <span className="mono-stat text-3xl text-accent">{done}</span>
        <span className="mb-1 text-sm text-secondary">/ {questionIds.length} marked done</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full border border-terminal bg-[var(--bg-elevated)]">
        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-3 text-xs text-muted">
        Overall progress tracks PYQs. Copy-level Done states are saved separately for revision.
      </div>
    </div>
  );
}
