import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthProviderBoundary } from "@/components/auth/AuthProviderBoundary";
import { AccountPanel } from "@/components/auth/AccountPanel";
import { StudyNav } from "@/components/StudyNav";
import { getPublicAuthState } from "@/lib/auth-availability";

export const metadata: Metadata = {
  title: "Account - UPSCat",
  description: "Account status and progress settings for UPSCat.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default function Page() {
  const copy = accountPageCopy(getPublicAuthState());

  return (
    <AuthProviderBoundary>
      <main className="library-page min-h-screen">
        <StudyNav />
        <section className="mx-auto max-w-5xl px-5 py-10 sm:px-8 lg:px-10">
          <div className="mb-8 max-w-3xl">
            <div className="overline mb-3">Account</div>
            <h1 className="text-3xl sm:text-4xl">{copy.title}</h1>
            <p className="mt-3 text-base leading-8 text-secondary">
              {copy.body}
            </p>
          </div>
          <Suspense fallback={<AccountPanel next="/" />}>
            <AccountPanel />
          </Suspense>
        </section>
      </main>
    </AuthProviderBoundary>
  );
}

function accountPageCopy(state: ReturnType<typeof getPublicAuthState>) {
  if (state.mode === "qa-disabled") {
    return {
      title: "Account access temporarily disabled for QA.",
      body: "Public browsing, topper details, summaries, and PDFs are currently open while account sync is being tested.",
    };
  }

  if (state.mode === "configured") {
    return {
      title: "Sign in to sync progress.",
      body: "Use email and password sign-in to keep PYQ progress available across devices.",
    };
  }

  if (state.mode === "misconfigured-production") {
    return {
      title: "Authentication temporarily unavailable.",
      body: "Account sync is closed until production authentication configuration is repaired.",
    };
  }

  return {
    title: "Account sync is not configured locally.",
    body: "Public study pages still work in this environment. Configure Supabase auth to test synced progress.",
  };
}
