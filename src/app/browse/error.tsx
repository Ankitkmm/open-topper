"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function BrowseError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => { console.error("Browse page error:", error); }, [error]);

  const C = { bg: "#050C09", text: "#E8EDEA", textSecondary: "#687D70", textMuted: "#3D5245", accent: "#4A7C59" };

  return (
    <div className="max-w-lg mx-auto px-6 py-24 text-center" style={{ background: C.bg }}>
      <AlertTriangle size={48} className="mx-auto mb-4" style={{ color: "#4A7C59" }} />
      <h2 className="text-xl font-semibold mb-2" style={{ color: C.text }}>Something went wrong</h2>
      <p className="text-sm mb-6" style={{ color: C.textSecondary }}>There was an error loading questions. Please try again.</p>
      <button onClick={reset} className="btn-primary">
        <RotateCcw size={15} /> Try again
      </button>
    </div>
  );
}
