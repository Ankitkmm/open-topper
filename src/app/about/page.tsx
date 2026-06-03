import type { Metadata } from "next";
import { MarketingPageFrame } from "@/components/marketing/MarketingShell";
import { FOUNDER_EMAIL, SITE_NAME, SITE_DOMAIN } from "@/lib/marketing";

export const metadata: Metadata = {
  title: `About ${SITE_NAME}`,
  description: `Why ${SITE_NAME} exists and who it is meant to help.`,
};

export default function AboutPage() {
  return (
    <MarketingPageFrame
      eyebrow="About"
      title="Built to democratize UPSC prep without adding more noise."
      description={`${SITE_NAME} exists for a simple reason: serious preparation should not depend on who has the best folder system, the cleanest Telegram archive, or the right insider link at the right time.`}
    >
      <div className="grid gap-6 text-sm leading-8 text-secondary sm:text-base">
        <section className="soft-panel rounded-[28px] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-primary">What the product is trying to solve</h2>
          <p className="mt-4">
            {SITE_NAME} is trying to make prep more searchable, more trackable, and less dependent
            on scattered PDFs, random channels, and memory-based revision.
          </p>
          <p className="mt-4">
            It is meant for students who already know the exam is hard and do not need more hype.
            They need a workspace that helps them move from PYQs to topper approaches to revision
            decisions with less friction.
          </p>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          {[
            "Track progress in a way that feels real, not performative.",
            "Search by issue, theme, or paper instead of guessing where you saved something.",
            "Stay close to the original question while reviewing topper signals and revision paths.",
          ].map((item) => (
            <div key={item} className="soft-panel rounded-[24px] p-5">
              {item}
            </div>
          ))}
        </section>

        <section className="soft-panel rounded-[28px] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-primary">Why this matters</h2>
          <p className="mt-4">
            The long-term goal is simple: democratize access to better prep workflows. A student
            should be able to study smarter because the product is thoughtful, not because they
            happened to collect the right material from the right place at the right time.
          </p>
        </section>

        <section className="soft-panel rounded-[28px] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-primary">Contact</h2>
          <p className="mt-4">
            If you want to reach out, join the waitlist or write directly to <a className="text-accent underline-offset-4 hover:underline" href={`mailto:${FOUNDER_EMAIL}`}>{FOUNDER_EMAIL}</a>.
          </p>
          <p className="mt-4 text-muted">Home: {SITE_DOMAIN}</p>
        </section>
      </div>
    </MarketingPageFrame>
  );
}
