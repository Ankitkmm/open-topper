import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Mail } from "lucide-react";
import { SITE_DOMAIN, SITE_NAME, WAITLIST_LINK } from "@/lib/marketing";

export const metadata: Metadata = {
  title: `${SITE_NAME} | Track prep, search PYQs, revise smarter`,
  description:
    "UPSCat helps aspirants track preparation, search PYQs faster, and jump from a question to useful answer guidance.",
};

export default function LandingPage() {
  return (
    <main className="library-page min-h-screen">
      <section className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16 sm:px-10">
        <div className="study-badge study-badge-accent w-fit">Now live on {SITE_DOMAIN}</div>
        <h1 className="mt-6 max-w-4xl text-5xl font-semibold leading-[0.98] tracking-[-0.05em] sm:text-7xl">
          Your UPSC prep, finally in one place.
        </h1>
        <p className="mt-6 max-w-3xl text-base leading-8 text-secondary sm:text-lg">
          {SITE_NAME} helps aspirants track preparation, search PYQs faster, and revisit the
          right topics at the right time.
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/browse" className="btn-primary">
            Browse all questions <ArrowRight size={15} aria-hidden="true" />
          </Link>
          <a href={WAITLIST_LINK} className="btn-secondary">
            Join waitlist <Mail size={15} aria-hidden="true" />
          </a>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          <SimpleCard
            title="Structured PYQs"
            detail="Browse General Studies, Essay, and optional subject question sets from one place."
          />
          <SimpleCard
            title="Fast search"
            detail="Jump from a topic or keyword to the most relevant past year questions quickly."
          />
          <SimpleCard
            title="Live demo"
            detail="This production site is deployed for product review, feedback, and early access."
          />
        </div>
      </section>
    </main>
  );
}

function SimpleCard({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="soft-panel rounded-[28px] p-5">
      <h2 className="text-xl font-semibold tracking-[-0.03em]">{title}</h2>
      <p className="mt-3 text-sm leading-7 text-secondary">{detail}</p>
    </div>
  );
}
