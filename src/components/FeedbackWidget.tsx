"use client";

import { useCallback, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Flag, Loader2, X } from "lucide-react";
import clsx from "clsx";

const ISSUE_CATEGORIES = [
  { value: "bug", label: "Something is broken" },
  { value: "content", label: "Wrong content/mapping" },
  { value: "suggestion", label: "Suggestion" },
  { value: "other", label: "Other" },
] as const;

type FeedbackCategory = (typeof ISSUE_CATEGORIES)[number]["value"];

type WidgetState = "idle" | "open" | "submitting" | "success" | "error";

export function FeedbackWidget() {
  const pathname = usePathname();
  const [state, setState] = useState<WidgetState>("idle");
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [message, setMessage] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  const handleSubmit = useCallback(async () => {
    if (!category) return;

    // For non-"other" categories, use the category label as the message if empty
    const finalMessage =
      message.trim() ||
      ISSUE_CATEGORIES.find((c) => c.value === category)?.label ||
      category;

    setState("submitting");
    setErrorMsg("");

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page_path: pathname,
          category,
          message: finalMessage,
        }),
      });

      if (res.status === 201) {
        setState("success");
      } else {
        const data = await res.json().catch(() => ({ error: "Request failed" }));
        setErrorMsg(data.error || `Error (${res.status})`);
        setState("error");
      }
    } catch {
      setErrorMsg("Network error — check your connection");
      setState("error");
    }
  }, [pathname, category, message]);

  const handleRetry = useCallback(() => {
    setState("open");
  }, []);

  const handleClose = useCallback(() => {
    setState("idle");
    setCategory(null);
    setMessage("");
    setErrorMsg("");
  }, []);

  // Idle state — just the flag icon
  if (state === "idle") {
    return (
      <button
        type="button"
        onClick={() => setState("open")}
        className="study-badge"
        aria-label="Report an issue with this page"
        title="Report an issue"
      >
        <Flag size={12} aria-hidden="true" />
      </button>
    );
  }

  // Success state
  if (state === "success") {
    return (
      <span className="study-badge study-badge-accent">
        Thanks for the report
      </span>
    );
  }

  // Open / submitting / error states — show the form
  return (
    <div ref={panelRef} className="soft-panel mt-3 p-4" style={{ maxWidth: "22rem" }}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-secondary">Report an issue</span>
        <button
          type="button"
          onClick={handleClose}
          className="btn-ghost rounded-full p-1"
          aria-label="Close feedback form"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <fieldset disabled={state === "submitting"} className="grid gap-2">
        {ISSUE_CATEGORIES.map((cat) => (
          <label
            key={cat.value}
            className={clsx(
              "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
              category === cat.value
                ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                : "text-secondary hover:bg-[var(--accent-soft)]"
            )}
          >
            <input
              type="radio"
              name="feedback-category"
              value={cat.value}
              checked={category === cat.value}
              onChange={() => setCategory(cat.value)}
              className="accent-[var(--accent)]"
            />
            {cat.label}
          </label>
        ))}
      </fieldset>

      {(category === "other" || category === "content") && (
        <div className="mt-3">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={5000}
            placeholder="Describe the issue…"
            rows={3}
            disabled={state === "submitting"}
            className="w-full resize-none rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] p-3 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:border-[var(--accent-border)] focus:outline-none"
          />
          <p className="mt-1 text-right text-xs text-muted">{message.length}/5000</p>
        </div>
      )}

      {state === "error" && (
        <div className="mt-3 rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-sm text-[var(--rose)]" role="alert">
          {errorMsg}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        {state === "error" ? (
          <button type="button" onClick={handleRetry} className="btn-secondary text-sm">
            Retry
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!category || state === "submitting"}
            className="btn-secondary text-sm"
          >
            {state === "submitting" && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            Submit
          </button>
        )}
        <button type="button" onClick={handleClose} className="btn-ghost text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}
