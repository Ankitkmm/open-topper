import type { Metadata } from "next";
import { MarketingPageFrame } from "@/components/marketing/MarketingShell";
import {
  COPYRIGHT_NOTICE,
  FOUNDER_EMAIL,
  RIGHTS_CONTACT_EMAIL,
  SITE_NAME,
} from "@/lib/marketing";

export const metadata: Metadata = {
  title: `${SITE_NAME} Terms`,
  description: `Basic terms for using ${SITE_NAME}.`,
};

export default function TermsPage() {
  return (
    <MarketingPageFrame
      eyebrow="Terms"
      title="Basic terms for using the site and app."
      description={`${SITE_NAME} is meant to be useful, not legalistic. These terms set expectations for educational use, ownership, and content concerns.`}
    >
      <div className="grid gap-6 text-sm leading-8 text-secondary sm:text-base">
        <section className="soft-panel rounded-[28px] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-primary">Educational use</h2>
          <p className="mt-4">
            You may use the site and app for personal, non-commercial educational use. Please do
            not abuse, disrupt, bulk-scrape, misrepresent, or intentionally damage the service.
          </p>
        </section>

        <section className="soft-panel rounded-[28px] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-primary">Ownership and copyright</h2>
          <p className="mt-4">
            Original topper copies, exam papers, and other third-party study materials remain the
            property of their respective authors, publishers, and rights holders.
          </p>
          <p className="mt-4">
            {COPYRIGHT_NOTICE}
          </p>
        </section>

        <section className="soft-panel rounded-[28px] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-primary">Corrections and takedowns</h2>
          <p className="mt-4">
            If you believe content on the site is misattributed, infringing, or should not be
            available, send a good-faith notice with the relevant details to <a className="text-accent underline-offset-4 hover:underline" href={`mailto:${RIGHTS_CONTACT_EMAIL}`}>{RIGHTS_CONTACT_EMAIL}</a>.
          </p>
          <p className="mt-4">
            We may review, limit, correct, or remove material while that request is assessed, and
            valid takedown requests will be acted on as quickly as reasonably possible.
          </p>
        </section>

        <section className="soft-panel rounded-[28px] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-primary">No guarantee</h2>
          <p className="mt-4">
            The product is provided as-is. We do not guarantee uninterrupted availability, perfect accuracy, or any specific exam result.
          </p>
        </section>

        <section className="soft-panel rounded-[28px] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-primary">Contact</h2>
          <p className="mt-4">
            If you have questions about these terms, email <a className="text-accent underline-offset-4 hover:underline" href={`mailto:${FOUNDER_EMAIL}`}>{FOUNDER_EMAIL}</a>.
          </p>
        </section>
      </div>
    </MarketingPageFrame>
  );
}
