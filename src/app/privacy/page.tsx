import type { Metadata } from "next";
import { MarketingPageFrame } from "@/components/marketing/MarketingShell";
import { FOUNDER_EMAIL, SITE_NAME } from "@/lib/marketing";

export const metadata: Metadata = {
  title: `${SITE_NAME} Privacy`,
  description: `Privacy information for the ${SITE_NAME} website and app.`,
};

export default function PrivacyPage() {
  return (
    <MarketingPageFrame
      eyebrow="Privacy"
      title="A straightforward privacy page for a straightforward product."
      description={`${SITE_NAME} keeps this simple. If something important changes about how user data is handled, this page should change too.`}
    >
      <div className="grid gap-6 text-sm leading-8 text-secondary sm:text-base">
        <section className="soft-panel rounded-[28px] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-primary">What you share directly</h2>
          <p className="mt-4">
            If you email us or join the waitlist, we receive your email address and whatever information you choose to send.
          </p>
        </section>

        <section className="soft-panel rounded-[28px] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-primary">Future account features</h2>
          <p className="mt-4">
            If account features are enabled later, the app may receive basic identity information
            needed to separate your workspace and progress cleanly.
          </p>
        </section>

        <section className="soft-panel rounded-[28px] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-primary">Local progress</h2>
          <p className="mt-4">
            Progress tracking and study activity are currently stored in your browser on your
            device. This version does not yet use a database-backed progress store.
          </p>
        </section>

        <section className="soft-panel rounded-[28px] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-primary">Questions</h2>
          <p className="mt-4">
            For privacy questions, email <a className="text-accent underline-offset-4 hover:underline" href={`mailto:${FOUNDER_EMAIL}`}>{FOUNDER_EMAIL}</a>.
          </p>
        </section>
      </div>
    </MarketingPageFrame>
  );
}
