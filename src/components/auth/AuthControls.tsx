"use client";

import Link from "next/link";
import { LogIn, LogOut } from "lucide-react";
import { AuthProviderBoundary } from "@/components/auth/AuthProviderBoundary";
import { useOptionalUserData } from "@/components/auth/UserDataProvider";

export function AuthControls({ compact = false }: { compact?: boolean }) {
  const userData = useOptionalUserData();

  if (!userData) {
    return (
      <AuthProviderBoundary>
        <AuthControls compact={compact} />
      </AuthProviderBoundary>
    );
  }

  const { authAvailable, isAuthenticated, status, userEmail, userName } = userData;

  if (!authAvailable) return null;

  const label = userName || userEmail || "Account";
  const title = isAuthenticated && userEmail ? `Signed in as ${userEmail}` : undefined;

  async function handleSignOut() {
    await fetch("/api/auth/logout", { method: "POST", body: "" });
    window.location.assign("/");
  }

  if (isAuthenticated) {
    return (
      <div className="flex min-w-0 items-center gap-1.5" title={title}>
        <Link
          href="/account"
          className="soft-button min-h-8 px-2.5 py-1.5 text-xs"
          data-variant="ghost"
        >
          <span className={compact ? "sr-only sm:not-sr-only" : ""}>{compact ? "Account" : label}</span>
        </Link>
        <button
          type="button"
          className="soft-button min-h-8 px-2.5 py-1.5 text-xs"
          data-variant="secondary"
          onClick={() => void handleSignOut()}
        >
          <LogOut size={14} aria-hidden="true" />
          <span className={compact ? "sr-only sm:not-sr-only" : ""}>Sign out</span>
        </button>
      </div>
    );
  }

  return (
    <Link
      href="/account"
      className="soft-button min-h-8 px-2.5 py-1.5 text-xs"
      data-variant="secondary"
      aria-busy={status === "loading"}
    >
      <LogIn size={14} aria-hidden="true" />
      <span>Sign in</span>
    </Link>
  );
}
