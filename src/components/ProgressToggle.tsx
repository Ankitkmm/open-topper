"use client";

import { Check, Circle } from "lucide-react";
import { useUserData } from "@/components/auth/UserDataProvider";
import { EMPTY_PROGRESS } from "@/lib/local-user-store";

interface ProgressToggleProps {
  itemId: string;
}

export function ProgressToggle({ itemId }: ProgressToggleProps) {
  const { progressMap, toggleProgress } = useUserData();
  const progress = progressMap[itemId] || EMPTY_PROGRESS;

  return (
    <button
      type="button"
      onClick={() => toggleProgress(itemId)}
      className="soft-button min-h-8 px-2.5 py-1 text-[11px]"
      data-variant={progress.done ? "primary" : "secondary"}
      title={progress.done ? "Marked done" : "Mark done"}
      aria-pressed={progress.done}
    >
      {progress.done ? <Check size={13} /> : <Circle size={13} />}
      Done
    </button>
  );
}
