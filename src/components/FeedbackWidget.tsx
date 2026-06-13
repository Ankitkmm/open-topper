"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { CheckCircle2, ImagePlus, Loader2, MessageCircle, X } from "lucide-react";

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const MAX_FEEDBACK_CHARS = 4000;

type SubmitState = "idle" | "submitting" | "success";

export function FeedbackWidget() {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SubmitState>("idle");
  const [feedback, setFeedback] = useState("");
  const [replyEmail, setReplyEmail] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && state !== "submitting") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    const firstInput = dialogRef.current?.querySelector<HTMLTextAreaElement>("textarea");
    window.setTimeout(() => firstInput?.focus(), 0);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, state]);

  function resetForm() {
    setState("idle");
    setFeedback("");
    setReplyEmail("");
    setScreenshot(null);
    setError(null);
  }

  function closeDialog() {
    if (state === "submitting") return;
    setOpen(false);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanFeedback = feedback.trim();
    if (!cleanFeedback) {
      setError("Write a short note before sending feedback.");
      return;
    }
    if (cleanFeedback.length > MAX_FEEDBACK_CHARS) {
      setError(`Keep feedback under ${MAX_FEEDBACK_CHARS.toLocaleString()} characters.`);
      return;
    }
    if (screenshot && screenshot.size > MAX_SCREENSHOT_BYTES) {
      setError("Screenshot must be 5 MB or smaller.");
      return;
    }

    setState("submitting");
    setError(null);

    const formData = new FormData();
    formData.set("message", cleanFeedback);
    formData.set("replyEmail", replyEmail.trim());
    if (typeof window !== "undefined") formData.set("pageUrl", window.location.href);
    if (screenshot) formData.set("screenshot", screenshot);

    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Feedback could not be sent. Please try again.");
      }
      setState("success");
      setFeedback("");
      setReplyEmail("");
      setScreenshot(null);
    } catch (cause) {
      setState("idle");
      setError(cause instanceof Error ? cause.message : "Feedback could not be sent. Please try again.");
    }
  }

  return (
    <>
      <button
        type="button"
        className="feedback-launcher"
        onClick={() => {
          setOpen(true);
          if (state === "success") resetForm();
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <MessageCircle size={17} aria-hidden="true" />
        <span>Feedback</span>
      </button>

      {open && (
        <div className="feedback-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}>
          <div
            ref={dialogRef}
            className="feedback-dialog soft-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-title"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="overline mb-2">Send feedback</div>
                <h2 id="feedback-title" className="text-2xl">What should we improve?</h2>
                <p className="mt-2 text-sm leading-6 text-secondary">
                  Send a bug, correction, idea, or screenshot directly to the founder.
                </p>
              </div>
              <button type="button" className="btn-ghost px-3" onClick={closeDialog} aria-label="Close feedback" disabled={state === "submitting"}>
                <X size={17} aria-hidden="true" />
              </button>
            </div>

            {state === "success" ? (
              <div className="soft-panel-muted mt-5 p-4" role="status" aria-live="polite">
                <div className="flex items-center gap-2 font-semibold text-primary">
                  <CheckCircle2 size={18} className="text-accent" aria-hidden="true" />
                  Feedback sent
                </div>
                <p className="mt-2 text-sm leading-6 text-secondary">
                  Thanks — it went to founder@upscat.click.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" className="btn-primary" onClick={resetForm}>Send another</button>
                  <button type="button" className="btn-secondary" onClick={closeDialog}>Close</button>
                </div>
              </div>
            ) : (
              <form className="mt-5 grid gap-4" onSubmit={onSubmit}>
                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-primary">Feedback <span className="text-muted">*</span></span>
                  <textarea
                    className="soft-input min-h-36 resize-y px-4 py-3 text-sm leading-6"
                    value={feedback}
                    onChange={(event) => setFeedback(event.currentTarget.value)}
                    placeholder="Tell us what broke, what confused you, or what would make UPSCat better…"
                    maxLength={MAX_FEEDBACK_CHARS}
                    required
                  />
                  <span className="text-xs text-muted">{feedback.length.toLocaleString()} / {MAX_FEEDBACK_CHARS.toLocaleString()}</span>
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-primary">Your email <span className="text-muted">optional</span></span>
                  <input
                    className="soft-input h-11 px-4 text-sm"
                    type="email"
                    value={replyEmail}
                    onChange={(event) => setReplyEmail(event.currentTarget.value)}
                    placeholder="name@example.com"
                    autoComplete="email"
                  />
                </label>

                <label className="feedback-file-drop">
                  <ImagePlus size={17} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">
                    {screenshot ? screenshot.name : "Attach a screenshot (optional, max 5 MB)"}
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0] || null;
                      setError(null);
                      if (file && file.size > MAX_SCREENSHOT_BYTES) {
                        setScreenshot(null);
                        event.currentTarget.value = "";
                        setError("Screenshot must be 5 MB or smaller.");
                        return;
                      }
                      setScreenshot(file);
                    }}
                  />
                </label>

                {error && <div className="soft-panel-muted p-3 text-sm text-secondary" role="alert">{error}</div>}

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs leading-5 text-muted">We only use your email to reply if you provide it.</p>
                  <button type="submit" className="btn-primary" disabled={state === "submitting"}>
                    {state === "submitting" && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
                    {state === "submitting" ? "Sending…" : "Send feedback"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
