"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { LogIn, LogOut, UserPlus } from "lucide-react";
import { useUserData } from "@/components/auth/UserDataProvider";

export function AccountPanel({ next = "/" }: { next?: string }) {
  const { authAvailable, isAuthenticated, status, userEmail, userName } = useUserData();
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupName, setSignupName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"login" | "signup" | "logout" | null>(null);

  const destination = useMemo(() => (next.startsWith("/") ? next : "/"), [next]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("login");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: loginEmail.trim().toLowerCase(),
          password: loginPassword,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Invalid email or password.");
      window.location.assign(destination || "/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid email or password.");
    } finally {
      setBusy(null);
    }
  }

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("signup");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: signupEmail.trim().toLowerCase(),
          password: signupPassword,
          name: signupName.trim(),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Account could not be created.");

      if (payload?.requiresEmailVerification) {
        setMessage("Account created. Verify your email, then sign in.");
        return;
      }

      window.location.assign(destination || "/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Account could not be created.");
    } finally {
      setBusy(null);
    }
  }

  async function handleSignOut() {
    setBusy("logout");
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.assign("/");
    } finally {
      setBusy(null);
    }
  }

  if (!authAvailable) {
    return (
      <div className="soft-panel p-6 text-center text-secondary">
        Email auth is not configured in this environment yet.
      </div>
    );
  }

  if (isAuthenticated) {
    return (
      <div className="soft-panel p-6">
        <div className="overline mb-3">Account</div>
        <h2 className="text-2xl">Signed in</h2>
        <p className="mt-3 text-secondary">{userName || userEmail}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href={destination} className="btn-primary">Continue</Link>
          <button type="button" className="btn-secondary" onClick={() => void handleSignOut()} disabled={busy === "logout"}>
            <LogOut size={15} aria-hidden="true" /> {busy === "logout" ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form className="soft-panel grid gap-4 p-6" onSubmit={handleLogin}>
        <div>
          <div className="overline mb-3">Sign in</div>
          <h2 className="text-2xl">Return to your progress</h2>
          <p className="mt-2 text-sm text-secondary">PYQ shells stay public. Summaries, topper details, PDFs, and synced progress require sign-in.</p>
        </div>
        <label className="grid gap-2 text-sm text-secondary">
          <span>Email</span>
          <input className="soft-input h-12 px-4" type="email" value={loginEmail} onChange={(event) => setLoginEmail(event.currentTarget.value)} required />
        </label>
        <label className="grid gap-2 text-sm text-secondary">
          <span>Password</span>
          <input className="soft-input h-12 px-4" type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.currentTarget.value)} required minLength={8} />
        </label>
        <button type="submit" className="btn-primary justify-center" disabled={busy !== null || status === "loading"}>
          <LogIn size={15} aria-hidden="true" /> {busy === "login" ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <form className="soft-panel grid gap-4 p-6" onSubmit={handleSignup}>
        <div>
          <div className="overline mb-3">Create account</div>
          <h2 className="text-2xl">Save progress across devices</h2>
          <p className="mt-2 text-sm text-secondary">Use email + password. If your Supabase project requires email confirmation, you&apos;ll verify once before signing in.</p>
        </div>
        <label className="grid gap-2 text-sm text-secondary">
          <span>Name (optional)</span>
          <input className="soft-input h-12 px-4" value={signupName} onChange={(event) => setSignupName(event.currentTarget.value)} />
        </label>
        <label className="grid gap-2 text-sm text-secondary">
          <span>Email</span>
          <input className="soft-input h-12 px-4" type="email" value={signupEmail} onChange={(event) => setSignupEmail(event.currentTarget.value)} required />
        </label>
        <label className="grid gap-2 text-sm text-secondary">
          <span>Password</span>
          <input className="soft-input h-12 px-4" type="password" value={signupPassword} onChange={(event) => setSignupPassword(event.currentTarget.value)} required minLength={8} />
        </label>
        <button type="submit" className="btn-secondary justify-center" disabled={busy !== null || status === "loading"}>
          <UserPlus size={15} aria-hidden="true" /> {busy === "signup" ? "Creating…" : "Create account"}
        </button>
      </form>

      {(message || error) && (
        <div className="soft-panel-muted lg:col-span-2 p-4 text-sm">
          <span className={error ? "text-[var(--rose)]" : "text-secondary"}>{error || message}</span>
        </div>
      )}
    </div>
  );
}
