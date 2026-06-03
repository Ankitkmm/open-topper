import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  Compass,
  Mail,
  Search,
  Target,
} from "lucide-react";
import { AuthControls } from "@/components/auth/AuthControls";
import { ActivityHeatmap } from "@/components/marketing/ActivityHeatmap";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/MarketingShell";
import { SITE_NAME, SITE_DOMAIN, WAITLIST_LINK } from "@/lib/marketing";
import { getOfficialPyqStats } from "@/lib/official-pyqs";

export const metadata: Metadata = {
  title: `${SITE_NAME} | Track prep, search PYQs, revise smarter`,
  description:
    "UPSCat helps aspirants search PYQs, study topper approaches, and track preparation with more clarity.",
};

function loadStats() {
  const stats = getOfficialPyqStats();
  return {
    totalQuestions: stats.totalQuestions,
    answerLinks: stats.linkedCopies,
    categoryCounts: new Map(stats.categories.map((item) => [item.name, item.count])),
  };
}

const ENTRY_POINTS = [
  { href: "/gs1", title: "GS I", subtitle: "History, society, geography", category: "GS 1" },
  { href: "/gs2", title: "GS II", subtitle: "Polity, governance, IR", category: "GS 2" },
  { href: "/gs3", title: "GS III", subtitle: "Economy, environment, security", category: "GS 3" },
  { href: "/gs4", title: "GS IV", subtitle: "Ethics and case studies", category: "GS 4" },
  { href: "/essay", title: "Essay", subtitle: "Themes and writing paths", category: "Essay" },
  { href: "/browse", title: "Browse all", subtitle: "Search across questions", category: "All" },
] as const;

const PRODUCT_COLUMNS = [
  {
    icon: Target,
    title: "Know what needs revision",
    description:
      "See what you studied, what got ignored, and what is slipping before revision season becomes panic season.",
  },
  {
    icon: Search,
    title: "Search by topic",
    description:
      "Look up a topic like federalism, inflation, ethics, or disaster management and jump straight to the relevant PYQs.",
  },
  {
    icon: BrainCircuit,
    title: "Study with context",
    description:
      "Move from the original question to topper approaches, answer signals, and related themes without losing context.",
  },
];

const FREE_FEATURES = [
  "Browse GS, Essay, and optional PYQ workspaces",
  "Search PYQs, themes, and linked answer signals",
  "Track study progress locally in your browser",
  "Move from a question to the right source trail quickly",
];

const PLUS_FEATURES = [
  "Personalised agentic tracking of progress",
  "Smarter revision nudges based on your study trail",
  "Deeper topic-to-topic recall support",
  "Early access to future mentor and agent workflows",
];

export default function LandingPage() {
  const stats = loadStats();

  return (
    <main className="library-page min-h-screen overflow-hidden">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div
          className="absolute left-[-8rem] top-[-8rem] h-[24rem] w-[24rem] rounded-full blur-3xl"
          style={{ background: "color-mix(in srgb, var(--gold) 18%, transparent)" }}
        />
        <div
          className="absolute right-[-10rem] top-[5rem] h-[28rem] w-[28rem] rounded-full blur-3xl"
          style={{ background: "color-mix(in srgb, var(--accent) 18%, transparent)" }}
        />
        <div
          className="absolute bottom-[10%] left-[12%] h-[18rem] w-[18rem] rounded-full blur-3xl"
          style={{ background: "color-mix(in srgb, var(--question) 12%, transparent)" }}
        />
      </div>

      <div className="relative">
        <MarketingHeader />

        <section className="mx-auto grid max-w-7xl gap-10 px-5 pb-10 pt-4 sm:px-8 lg:grid-cols-[minmax(0,1.02fr)_minmax(360px,0.98fr)] lg:gap-14 lg:px-10 lg:pb-16 lg:pt-8">
          <div className="pt-6 sm:pt-10">
            <div className="study-badge study-badge-accent">Now live on {SITE_DOMAIN}</div>
            <h1 className="mt-6 max-w-5xl text-5xl font-semibold leading-[0.98] tracking-[-0.05em] sm:text-6xl lg:text-8xl">
              Your UPSC prep, finally in one place.
            </h1>
            <p className="mt-6 max-w-3xl text-base leading-8 text-secondary sm:text-lg">
              {SITE_NAME} is built for aspirants who want PYQs, topper thinking, and progress
              tracking in one workflow instead of juggling scattered PDFs, notes, Telegram links,
              and half-remembered bookmarks.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/browse" className="btn-primary">
                Browse all questions <ArrowRight size={15} aria-hidden="true" />
              </Link>
              <a href={WAITLIST_LINK} className="btn-secondary">
                Join waitlist <Mail size={15} aria-hidden="true" />
              </a>
              <AuthControls />
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <HeroStat label="PYQs indexed" value={stats.totalQuestions.toLocaleString()} />
              <HeroStat label="Answer links" value={stats.answerLinks.toLocaleString()} />
              <HeroStat label="What it helps with" value="Track, search, revise" />
            </div>

            <div className="mt-10 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {ENTRY_POINTS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="soft-panel group rounded-[26px] p-4 transition-transform hover:-translate-y-1"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold tracking-[-0.03em]">{item.title}</div>
                      <div className="mt-1 text-sm leading-6 text-secondary">
                        {item.subtitle}
                      </div>
                    </div>
                    <ArrowRight
                      size={16}
                      className="text-muted transition-transform group-hover:translate-x-1 group-hover:text-accent"
                      aria-hidden="true"
                    />
                  </div>
                  {item.category !== "All" && (
                    <div className="mt-4 text-xs text-muted">
                      {(stats.categoryCounts.get(item.category) || 0).toLocaleString()} questions
                    </div>
                  )}
                </Link>
              ))}
            </div>
          </div>

          <div className="grid gap-4 lg:pt-8">
            <section className="soft-panel relative overflow-hidden rounded-[32px] p-5 sm:p-6">
              <div
                className="absolute -right-10 top-0 h-40 w-40 rounded-full blur-3xl"
                style={{ background: "color-mix(in srgb, var(--gold) 14%, transparent)" }}
              />
              <div className="relative flex items-start justify-between gap-4">
                <div>
                  <div className="overline">Your recent study pattern</div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
                    Tracks your progress in real time with AI agents
                  </h2>
                </div>
                <div className="relative hidden h-24 w-24 shrink-0 rounded-[28px] border border-terminal bg-[color-mix(in_srgb,var(--bg-surface)_86%,transparent)] text-[var(--accent-strong)] sm:grid sm:place-items-center">
                  <Image
                    src="/brand/cat-silhouette.svg"
                    alt=""
                    width={58}
                    height={58}
                    className="translate-x-[2px] translate-y-[2px] opacity-90"
                    style={{ height: "auto" }}
                  />
                </div>
              </div>

              <div className="mt-5 rounded-[28px] border border-terminal bg-[color-mix(in_srgb,var(--bg-elevated)_82%,transparent)] p-4 shadow-[0_18px_48px_rgba(0,0,0,0.08)]">
                <ActivityHeatmap />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <PreviewCard
                  title="Opens questions"
                  detail="Question views, topic clicks, revision actions, and source opens all count as study activity."
                  icon={BookOpen}
                />
                <PreviewCard
                  title="Feels personal"
                  detail="The system keeps noticing what you touch, what you skip, and what needs to come back into revision."
                  icon={Compass}
                />
                <PreviewCard
                  title="Stays usable"
                  detail="A simple progress layer keeps the signal clear instead of drowning you in dashboards for the sake of it."
                  icon={CheckCircle2}
                />
              </div>
            </section>
          </div>
        </section>

        <section className="section-band py-16 sm:py-20">
          <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
            <div className="max-w-3xl">
              <div className="overline">What UPSCat helps you do</div>
              <h2 className="mt-4 text-4xl font-semibold leading-tight tracking-[-0.04em] sm:text-6xl">
                Study with less chaos and better recall.
              </h2>
              <p className="mt-5 text-base leading-8 text-secondary sm:text-lg">
                This is for aspirants who want to know what to revise next, what topper material is
                worth opening, and how their prep is actually moving week to week.
              </p>
            </div>

            <div className="mt-10 grid gap-4 lg:grid-cols-3">
              {PRODUCT_COLUMNS.map((item) => (
                <article key={item.title} className="soft-panel rounded-[30px] p-6 sm:p-7">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--accent-soft)] text-accent">
                    <item.icon size={20} aria-hidden="true" />
                  </span>
                  <h3 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">
                    {item.title}
                  </h3>
                  <p className="mt-4 text-sm leading-7 text-secondary">{item.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="section-band py-16 sm:py-20">
          <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
            <div className="max-w-3xl">
              <div className="overline">Pricing</div>
              <h2 className="mt-4 text-4xl font-semibold leading-tight tracking-[-0.04em] sm:text-6xl">
                Start free. Upgrade when the extra depth matters.
              </h2>
              <p className="mt-5 text-base leading-8 text-secondary sm:text-lg">
                The free workspace is usable right away. Plus is for aspirants who want more
                personalised agentic tracking, deeper revision support, and sharper guidance as the
                product grows.
              </p>
            </div>

            <div className="mt-10 grid gap-4 lg:grid-cols-2">
              <PriceCard
                title="Free"
                price="₹0"
                subtitle="Good for getting started"
                features={FREE_FEATURES}
                ctaLabel="Open the free workspace"
                ctaHref="/browse"
                accent={false}
              />
              <PriceCard
                title="Plus"
                price="₹499/mo"
                subtitle="For more personalised agentic prep support"
                features={PLUS_FEATURES}
                ctaLabel="Join the Plus waitlist"
                ctaHref={WAITLIST_LINK}
                accent
              />
            </div>
          </div>
        </section>

        <MarketingFooter />
      </div>
    </main>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[26px] border border-terminal bg-[color-mix(in_srgb,var(--bg-surface)_78%,transparent)] px-4 py-4 shadow-[0_10px_30px_rgba(0,0,0,0.06)] backdrop-blur">
      <div className="mono-stat text-xl text-accent">{value}</div>
      <div className="mt-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </div>
    </div>
  );
}

function PreviewCard({
  title,
  detail,
  icon: Icon,
}: {
  title: string;
  detail: string;
  icon: typeof BookOpen;
}) {
  return (
    <div className="rounded-[26px] border border-terminal bg-[color-mix(in_srgb,var(--bg-surface)_70%,transparent)] p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--accent-soft)] text-accent">
          <Icon size={17} aria-hidden="true" />
        </span>
        <div className="text-sm font-semibold">{title}</div>
      </div>
      <p className="mt-3 text-sm leading-6 text-secondary">{detail}</p>
    </div>
  );
}

function PriceCard({
  title,
  price,
  subtitle,
  features,
  ctaLabel,
  ctaHref,
  accent,
}: {
  title: string;
  price: string;
  subtitle: string;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
  accent: boolean;
}) {
  return (
    <article
      className={`rounded-[34px] border p-6 sm:p-8 ${accent ? "bg-[var(--accent-soft)] border-[color-mix(in_srgb,var(--accent)_40%,transparent)]" : "soft-panel border-terminal"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="overline">{title}</div>
          <div className="mt-3 text-4xl font-semibold tracking-[-0.04em]">{price}</div>
          <p className="mt-3 max-w-md text-sm leading-7 text-secondary">{subtitle}</p>
        </div>
        {accent && <div className="study-badge study-badge-accent">Waitlist open</div>}
      </div>

      <div className="mt-8 grid gap-3">
        {features.map((feature) => (
          <div
            key={feature}
            className="flex items-start gap-3 text-sm leading-7 text-secondary"
          >
            <CheckCircle2 size={18} className="mt-1 shrink-0 text-accent" aria-hidden="true" />
            <span>{feature}</span>
          </div>
        ))}
      </div>

      <div className="mt-6">
        {ctaHref.startsWith("http") || ctaHref.startsWith("mailto:") ? (
          <a href={ctaHref} className={accent ? "btn-primary" : "btn-secondary"}>
            {ctaLabel}
          </a>
        ) : (
          <Link href={ctaHref} className={accent ? "btn-primary" : "btn-secondary"}>
            {ctaLabel}
          </Link>
        )}
      </div>
    </article>
  );
}
