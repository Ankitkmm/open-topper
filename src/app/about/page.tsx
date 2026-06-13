import type { Metadata } from "next";
import { MarketingPageFrame } from "@/components/marketing/MarketingShell";
import {
  COPYRIGHT_NOTICE,
  FOUNDER_EMAIL,
  RIGHTS_CONTACT_EMAIL,
  SITE_DOMAIN,
  SITE_NAME,
} from "@/lib/marketing";

// TODO: remove before production — Cloudflare Workers edge runtime proof-of-concept
// This page has no Node.js-only dependencies (no fs, path, crypto, process.cwd())
// and serves as a validation that static marketing pages can run on edge runtime.
// NOTE: edge runtime disables static generation — this page becomes ƒ (dynamic)
// instead of ○ (static). For production, consider removing this annotation and
// keeping the page statically generated for best performance.
export const runtime = "edge";

export const metadata: Metadata = {
  title: `About ${SITE_NAME}`,
  description: `Why ${SITE_NAME} exists and who it is meant to help.`,
};

export default function AboutPage() {
  return (
    <MarketingPageFrame
      eyebrow="About"
      title="Built as a calm educational reference for UPSC preparation."
      description={`${SITE_NAME} exists to help serious aspirants move from PYQs to study material with less clutter, less hunting, and clearer context.`}
    >
      <div className="grid gap-6 text-sm leading-8 text-secondary sm:text-base">
        <section className="soft-panel rounded-[28px] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-primary">What this site is for</h2>
          <p className="mt-4">
            {SITE_NAME} is an independent study utility for searching PYQs, reviewing topper-copy
            references, and organizing revision in one place.
          </p>
          <p className="mt-4">
            It is built for personal educational use by students who want a quieter, more direct
            path from question to reference material.
          </p>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          {[
            "Search by issue, theme, or paper instead of chasing scattered folders and links.",
            "Review study references in the context of the original PYQ, not as isolated files.",
            "Track revision progress in a lightweight way that stays secondary to actual study.",
          ].map((item) => (
            <div key={item} className="soft-panel rounded-[24px] p-5">
              {item}
            </div>
          ))}
        </section>

        <section className="soft-panel rounded-[28px] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-primary">Educational purpose only</h2>
          <p className="mt-4">
            {SITE_NAME} is presented as an educational reference project. It is not a coaching
            service, not an endorsement by any topper or institution, and not presented as a
            marketplace for study material.
          </p>
          <p className="mt-4">
            The focus is practical access and better organization. The site has no commercial
            interest in claiming ownership over third-party study material or promoting any
            institute through these references.
          </p>
        </section>

        <section className="soft-panel rounded-[28px] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-primary">Ownership and attribution</h2>
          <p className="mt-4">
            Original topper copies, question papers, and third-party source materials remain the
            property of their respective authors, publishers, and rights holders.
          </p>
          <p className="mt-4">
            {COPYRIGHT_NOTICE}
          </p>
          <p className="mt-4">
            If you represent a rights holder and want a correction, attribution update, or removal
            review, email <a className="text-accent underline-offset-4 hover:underline" href={`mailto:${RIGHTS_CONTACT_EMAIL}`}>{RIGHTS_CONTACT_EMAIL}</a>.
          </p>
          <p className="mt-4">
            Good-faith takedown requests will be reviewed promptly, and material may be limited or
            removed while the request is assessed.
          </p>
        </section>

        <section className="soft-panel rounded-[28px] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-primary">Contact</h2>
          <p className="mt-4">
            For general questions, factual corrections, or study-material concerns, write to <a className="text-accent underline-offset-4 hover:underline" href={`mailto:${FOUNDER_EMAIL}`}>{FOUNDER_EMAIL}</a>.
          </p>
          <p className="mt-4 text-muted">Home: {SITE_DOMAIN}</p>
        </section>
      </div>
    </MarketingPageFrame>
  );
}
