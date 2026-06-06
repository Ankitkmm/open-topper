import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthProviderBoundary } from "@/components/auth/AuthProviderBoundary";
import { AccountPanel } from "@/components/auth/AccountPanel";
import { StudyNav } from "@/components/StudyNav";

export const metadata: Metadata = {
  title: "Account - UPSCat",
  description: "Account status and progress settings for UPSCat.",
};

export default function Page() {
  return (
    <AuthProviderBoundary>
      <main className="library-page min-h-screen">
        <StudyNav />
        <section className="mx-auto max-w-5xl px-5 py-10 sm:px-8 lg:px-10">
          <div className="mb-8 max-w-3xl">
            <div className="overline mb-3">Account</div>
            <h1 className="text-3xl sm:text-4xl">Account access is temporarily disabled for QA</h1>
            <p className="mt-3 text-base leading-8 text-secondary">
              Public browsing, topper details, summaries, and PDFs are currently open for QA. Sign-in will return later with synced progress.
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
