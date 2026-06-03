import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, Mail } from "lucide-react";
import { BrandLockup } from "./Brand";
import { AuthControls } from "@/components/auth/AuthControls";
import { FOOTER_LINKS, FOUNDER_EMAIL, HIRING_LINK, NAV_LINKS, SITE_DOMAIN, WAITLIST_LINK } from "@/lib/marketing";
import { ThemeSwitcher } from "@/components/ThemeProvider";

export function MarketingHeader() {
  return (
    <header className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8 lg:px-10">
      <BrandLockup />
      <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
        <nav className="flex flex-wrap items-center gap-1 rounded-full border border-terminal bg-[color-mix(in_srgb,var(--bg-surface)_78%,transparent)] p-1 backdrop-blur">
          {NAV_LINKS.map((item) => (
            <Link key={item.href} href={item.href} className="rounded-full px-3 py-2 text-sm font-medium text-secondary transition hover:bg-[var(--accent-soft)] hover:text-accent">
              {item.label}
            </Link>
          ))}
        </nav>
        <ThemeSwitcher compact />
        <AuthControls compact />
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="section-band mt-16 py-10 sm:mt-20">
      <div className="mx-auto grid max-w-7xl gap-8 px-5 sm:px-8 lg:grid-cols-[1.2fr_0.8fr] lg:px-10">
        <div className="space-y-4">
          <BrandLockup compact />
          <p className="max-w-2xl text-sm leading-7 text-secondary">
            UPSCat helps aspirants keep track of preparation, search PYQs faster, and revisit the right topics at the right time.
          </p>
          <div className="flex flex-wrap items-center gap-3 text-sm text-secondary">
            <span className="study-badge study-badge-accent">{SITE_DOMAIN}</span>
            <a href={`mailto:${FOUNDER_EMAIL}`} className="quiet-link">
              {FOUNDER_EMAIL}
            </a>
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <div className="overline">Explore</div>
            <div className="mt-3 grid gap-2 text-sm text-secondary">
              {FOOTER_LINKS.map((item) => (
                <Link key={item.href} href={item.href} className="quiet-link w-fit">
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
          <div>
            <div className="overline">Contact</div>
            <div className="mt-3 grid gap-2 text-sm text-secondary">
              <a href={WAITLIST_LINK} className="quiet-link inline-flex w-fit items-center gap-2">
                <Mail size={14} aria-hidden="true" />
                Join waitlist
              </a>
              <a href={HIRING_LINK} className="quiet-link inline-flex w-fit items-center gap-2">
                <ArrowUpRight size={14} aria-hidden="true" />
                Talent network
              </a>
            </div>
          </div>
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
      <section className="section-band border-b border-terminal py-12 sm:py-16">
        <div className="mx-auto max-w-4xl px-5 sm:px-8 lg:px-10">
          <div className="overline">{eyebrow}</div>
          <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-[-0.04em] sm:text-6xl">{title}</h1>
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
