"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { Check, Circle, FileCheck2, PenLine, StickyNote } from "lucide-react";
import { useUserData } from "@/components/auth/UserDataProvider";
import {
  EMPTY_PROGRESS,
  PROGRESS_EVENT,
  type ProgressKey,
  type ProgressMap,
  readProgressMapForScope,
  writeProgressMapForScope,
} from "@/lib/local-user-store";

interface ProgressToggleProps {
  questionId: string;
}

export function ProgressToggle({ questionId }: ProgressToggleProps) {
  const { trackActivity, userScope } = useUserData();
  const progressMap = useSyncExternalStore(
    (onChange) => {
      window.addEventListener(PROGRESS_EVENT, onChange);
      window.addEventListener("storage", onChange);
      return () => {
        window.removeEventListener(PROGRESS_EVENT, onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    () => readProgressMapForScope(userScope),
    () => ({} as ProgressMap),
  );
  const progress = useMemo(() => progressMap[questionId] || EMPTY_PROGRESS, [progressMap, questionId]);

  function toggle(key: ProgressKey) {
    const current = progressMap[questionId] || EMPTY_PROGRESS;
    const nextRecord = { ...current, [key]: !current[key] };
    if (key === "full" && !current.full) {
      nextRecord.done = true;
      nextRecord.notes = true;
      nextRecord.answer = true;
    }
    const next = { ...progressMap, [questionId]: nextRecord };
    writeProgressMapForScope(userScope, next);
    trackActivity(key === "full" ? 2 : 1);
  }

  return (
    <div className="grid grid-cols-2 gap-1.5 sm:w-44" aria-label="Progress states">
      <ProgressButton label="Done" active={progress.done} onClick={() => toggle("done")} icon={progress.done ? <Check size={13} /> : <Circle size={13} />} />
      <ProgressButton label="Notes" active={progress.notes} onClick={() => toggle("notes")} icon={<StickyNote size={13} />} />
      <ProgressButton label="Answer" active={progress.answer} onClick={() => toggle("answer")} icon={<PenLine size={13} />} />
      <ProgressButton label="Full" active={progress.full} onClick={() => toggle("full")} icon={<FileCheck2 size={13} />} />
    </div>
  );
}

function ProgressButton({
  label,
  active,
  icon,
  onClick,
}: {
  label: string;
  active: boolean;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="soft-button min-h-8 px-2 py-1 text-[11px]"
      data-variant={active ? "primary" : "secondary"}
      title={label}
    >
      {icon}
      {label}
    </button>
  );
}
