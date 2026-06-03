import type { Metadata } from "next";
import { MarketingPageFrame } from "@/components/marketing/MarketingShell";
import { FOUNDER_EMAIL, SITE_NAME } from "@/lib/marketing";

export const metadata: Metadata = {
  title: `${SITE_NAME} Terms`,
  description: `Basic terms for using ${SITE_NAME}.`,
};

export default function TermsPage() {
  return (
    <MarketingPageFrame
      eyebrow="Terms"
      title="Basic terms for using the site and app."
      description={`${SITE_NAME} is meant to be useful, not legalistic. These terms are here to set clear expectations about access, usage, and future paid plans.`}
    >
      <div className="grid gap-6 text-sm leading-8 text-secondary sm:text-base">
        <section className="soft-panel rounded-[28px] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-primary">Use of the product</h2>
          <p className="mt-4">
            You may use the site and app for personal educational use. Please do not abuse, disrupt, scrape, or intentionally damage the service.
          </p>
        </section>

        <section className="soft-panel rounded-[28px] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-primary">Accounts and pricing</h2>
          <p className="mt-4">
            Google sign-in may be offered as an optional way to identify yourself in the app. Paid plans may be offered later, and any billing-specific terms will be shown clearly at the point of purchase.
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
