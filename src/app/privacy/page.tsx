import type { Metadata } from "next";
import { MarketingPageFrame } from "@/components/marketing/MarketingShell";
import { FOUNDER_EMAIL, RIGHTS_CONTACT_EMAIL, SITE_NAME } from "@/lib/marketing";

export const metadata: Metadata = {
  title: `${SITE_NAME} Privacy`,
  description: `Privacy information for the ${SITE_NAME} website and app.`,
};

export default function PrivacyPage() {
  return (
    <MarketingPageFrame
      eyebrow="Privacy"
      title="A simple privacy page for a simple educational site."
      description={`${SITE_NAME} keeps data handling intentionally narrow. If that changes in a meaningful way, this page should change too.`}
    >
      <div className="grid gap-6 text-sm leading-8 text-secondary sm:text-base">
        <section className="soft-panel rounded-[28px] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-primary">What you share directly</h2>
          <p className="mt-4">
            If you email us, we receive your email address and anything else you choose to include
            in that message.
          </p>
        </section>

        <section className="soft-panel rounded-[28px] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-primary">Study data and synced progress</h2>
          <p className="mt-4">
            Public browsing does not require an account. Anonymous progress can stay in your
            browser. If you sign in, progress data may also be stored in Supabase so it can sync
            across your devices.
          </p>
        </section>

        <section className="soft-panel rounded-[28px] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-primary">Account data</h2>
          <p className="mt-4">
            If you create an account, the app may process basic identity information such as your
            email address and the minimum session data needed to keep your workspace separate and
            your progress synced.
          </p>
        </section>

        <section className="soft-panel rounded-[28px] p-6 sm:p-7">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-primary">Copyright and takedown requests</h2>
          <p className="mt-4">
            If you contact us about attribution, copyright, or a takedown request, we will use the
            contact details and supporting information you provide to review and respond to that
            request.
          </p>
          <p className="mt-4">
            Good-faith removal or correction requests can be sent to <a className="text-accent underline-offset-4 hover:underline" href={`mailto:${RIGHTS_CONTACT_EMAIL}`}>{RIGHTS_CONTACT_EMAIL}</a>.
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
