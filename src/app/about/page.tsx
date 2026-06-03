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
      title="Built for aspirants who want preparation to feel less scattered."
      description={`${SITE_NAME} exists for a simple reason: UPSC prep becomes harder when everything important is buried under too many folders, too many tabs, and too little clarity about what to revise next.`}
    >
      <div className="grid gap-6 text-sm leading-8 text-secondary sm:text-base">
        <section className="soft-panel rounded-[28px] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-primary">What the product is trying to solve</h2>
          <p className="mt-4">
            {SITE_NAME} helps aspirants keep track of preparation, search PYQs quickly, and move from a question to useful answer guidance without losing context.
          </p>
          <p className="mt-4">
            It is meant for students who already know the exam is hard and do not need more hype. They need a workspace that helps them study with better recall and less chaos.
          </p>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          {[
            "Track study activity and local progress clearly.",
            "Search by issue or theme instead of guessing where you saved something.",
            "Stay close to the original question while reviewing answer signals.",
          ].map((item) => (
            <div key={item} className="soft-panel rounded-[24px] p-5">
              {item}
            </div>
          ))}
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
