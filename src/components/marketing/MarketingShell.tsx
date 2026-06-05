import type { ReactNode } from "react";
import Link from "next/link";
import { StudyNav } from "@/components/StudyNav";
import { FOOTER_LINKS, FOUNDER_EMAIL, SITE_DOMAIN, SITE_NAME } from "@/lib/marketing";

export function MarketingHeader() {
  return <StudyNav />;
}

export function MarketingFooter() {
  return (
    <footer className="section-band mt-20 py-10">
      <div className="mx-auto grid max-w-7xl gap-6 px-5 sm:px-8 lg:grid-cols-[1.4fr_0.6fr] lg:px-10">
        <div className="space-y-3">
          <div className="text-lg font-semibold tracking-[-0.02em]">{SITE_NAME}</div>
          <p className="max-w-2xl text-sm leading-7 text-secondary">
            A calm place to search UPSC past year questions and study how toppers approached them.
          </p>
          <p className="max-w-2xl text-xs leading-6 text-muted">
            {SITE_NAME} references publicly available topper-copy material for educational discovery.
            It does not claim ownership of that material, and valid takedown requests will be honored
            at <a className="quiet-link underline-offset-4 hover:underline" href={`mailto:${FOUNDER_EMAIL}`}>{FOUNDER_EMAIL}</a>.
          </p>
        </div>

        <div className="flex flex-col gap-2 lg:items-end">
          <div className="flex flex-wrap gap-x-5 gap-y-2 lg:justify-end">
            {FOOTER_LINKS.map((item) => (
              <Link key={item.href} href={item.href} className="quiet-link text-sm">
                {item.label}
              </Link>
            ))}
          </div>
          <div className="text-xs text-muted">{SITE_DOMAIN}</div>
        </div>
      </div>
    </footer>
  );
}

export function MarketingPageFrame({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="library-page min-h-screen">
      <MarketingHeader />
      <section className="border-b border-terminal py-12 sm:py-16">
        <div className="mx-auto max-w-4xl px-5 sm:px-8 lg:px-10">
          <div className="overline">{eyebrow}</div>
          <h1 className="mt-4 text-4xl leading-tight tracking-[-0.02em] sm:text-5xl">{title}</h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-secondary sm:text-lg">{description}</p>
        </div>
      </section>
      <section className="mx-auto max-w-4xl px-5 py-10 sm:px-8 sm:py-14 lg:px-10">
        {children}
      </section>
      <MarketingFooter />
    </main>
  );
}
