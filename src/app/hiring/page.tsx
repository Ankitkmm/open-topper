import type { Metadata } from "next";
import { MarketingPageFrame } from "@/components/marketing/MarketingShell";
import { FOUNDER_EMAIL, HIRING_LINK, SITE_NAME } from "@/lib/marketing";

export const metadata: Metadata = {
  title: `${SITE_NAME} Hiring`,
  description: `Join the ${SITE_NAME} talent network for future product, design, and engineering conversations.`,
};

export default function HiringPage() {
  return (
    <MarketingPageFrame
      eyebrow="Hiring"
      title="We are keeping a small talent network open."
      description={`${SITE_NAME} is looking for thoughtful people who care about useful products, good learning experiences, and building with clarity instead of noise.`}
    >
      <div className="grid gap-6 text-sm leading-8 text-secondary sm:text-base">
        <section className="soft-panel rounded-[28px] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-primary">Who we would like to meet</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              "Product-minded engineers who can keep interfaces fast and simple.",
              "Designers who care about clarity, trust, and study-heavy workflows.",
              "Researchers or operators who understand how aspirants actually prepare.",
              "People who like solving real user problems before polishing the story around them.",
            ].map((item) => (
              <div key={item} className="rounded-[22px] border border-terminal bg-[color-mix(in_srgb,var(--bg-surface)_74%,transparent)] px-4 py-4">
                {item}
              </div>
            ))}
          </div>
        </section>

        <section className="soft-panel rounded-[28px] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-primary">How to reach out</h2>
          <p className="mt-4">
            Send a short note about who you are, what you do, and why this problem matters to you. You can write to <a className="text-accent underline-offset-4 hover:underline" href={`mailto:${FOUNDER_EMAIL}`}>{FOUNDER_EMAIL}</a> or use the talent-network email below.
          </p>
          <a href={HIRING_LINK} className="btn-primary mt-5 inline-flex">
            Join the talent network
          </a>
        </section>
      </div>
    </MarketingPageFrame>
  );
}
