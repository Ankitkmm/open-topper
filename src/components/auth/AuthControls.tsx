"use client";

import { useTransition } from "react";
import { LogIn, LogOut } from "lucide-react";
import { signIn, signOut } from "next-auth/react";
import { useUserData } from "./UserDataProvider";

export function AuthControls({ compact = false }: { compact?: boolean }) {
  const { authAvailable, isAuthenticated, status, userEmail, userName } = useUserData();
  const [pending, startTransition] = useTransition();

  if (!authAvailable) return null;

  if (status === "loading") {
    return <span className="study-badge">Checking account...</span>;
  }

  if (!isAuthenticated) {
    return (
      <button
        type="button"
        className={compact ? "btn-secondary" : "btn-primary"}
        onClick={() => {
          startTransition(() => {
            void signIn("google", { callbackUrl: window.location.href });
          });
        }}
        disabled={pending}
      >
        <LogIn size={15} aria-hidden="true" />
        {pending ? "Opening Google..." : "Continue with Google"}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="study-badge study-badge-accent">
        {userName || userEmail?.split("@")[0] || "Signed in"}
      </span>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => {
          startTransition(() => {
            void signOut({ callbackUrl: "/" });
          });
        }}
        disabled={pending}
      >
        <LogOut size={15} aria-hidden="true" />
        Sign out
      </button>
    </div>
  );
}
