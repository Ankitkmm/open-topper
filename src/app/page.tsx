import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  Compass,
  Layers3,
  Search,
  Target,
} from "lucide-react";
import { AuthControls } from "@/components/auth/AuthControls";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/MarketingShell";
import { SITE_NAME, SITE_DOMAIN, WAITLIST_LINK } from "@/lib/marketing";
import { getBrowseStats, getFeaturedSubjectQuestion } from "@/lib/pyq";
import { displayPublicTopperName } from "@/lib/public-records";

export const metadata: Metadata = {
  title: `${SITE_NAME} | Track prep, search PYQs, revise smarter`,
  description:
    "UPSCat helps aspirants search PYQs, study topper approaches, and track preparation with more clarity.",
};

const ENTRY_POINTS = [
  { href: "/gs1", title: "GS I", subtitle: "History, society, geography", category: "GS 1" },
  { href: "/gs2", title: "GS II", subtitle: "Polity, governance, IR", category: "GS 2" },
  { href: "/gs3", title: "GS III", subtitle: "Economy, environment, security", category: "GS 3" },
  { href: "/gs4", title: "GS IV", subtitle: "Ethics and case studies", category: "GS 4" },
  { href: "/essay", title: "Essay", subtitle: "Themes and writing paths", category: "Essay" },
  { href: "/browse", title: "Browse all", subtitle: "Search across questions", category: "All" },
  { href: "/analytics", title: "Analytics", subtitle: "See what gets asked most", category: "All" },
];

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
  "Personalised revision tracking and memory cues",
  "Smarter nudges on what to revisit next",
  "Deeper topic-to-topic recall support",
  "Early access to future agent workflows",
];

export default async function LandingPage() {
  const stats = await getBrowseStats();
  const featuredCard = await getFeaturedSubjectQuestion("gs1");
  const featuredCopies = featuredCard?.linkedInsights.slice(0, 2) || [];

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
            <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-[0.98] tracking-[-0.05em] sm:text-5xl lg:text-[5.9rem]">
              Search PYQs, study topper thinking, and keep revision on track.
            </h1>
            <p className="mt-6 max-w-3xl text-base leading-8 text-secondary sm:text-lg">
              {SITE_NAME} gives aspirants one workspace for past year questions, relevant topper
              material, and lightweight progress tracking instead of scattered PDFs, notes,
              Telegram links, and half-remembered bookmarks.
            </p>

            <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap">
              <Link href="/browse" className="btn-primary w-full sm:w-auto">
                Browse all questions <ArrowRight size={15} aria-hidden="true" />
              </Link>
              <Link href="/gs1" className="btn-secondary w-full sm:w-auto">
                Open GS I workspace <ArrowRight size={15} aria-hidden="true" />
              </Link>
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
                  <div className="overline">Inside the workspace</div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
                    A live PYQ workflow, not just a static library
                  </h2>
                </div>
                <div className="hidden shrink-0 rounded-[22px] border border-terminal bg-[color-mix(in_srgb,var(--bg-surface)_86%,transparent)] px-3 py-2 text-xs font-semibold text-secondary sm:inline-flex sm:items-center sm:gap-2">
                  <Layers3 size={14} aria-hidden="true" />
                  Live preview
                </div>
              </div>

              <div className="mt-5 rounded-[28px] border border-terminal bg-[color-mix(in_srgb,var(--bg-elevated)_82%,transparent)] p-5 shadow-[0_18px_48px_rgba(0,0,0,0.08)]">
                {featuredCard ? (
                  <div className="grid gap-4">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
                      <span className="study-badge">{featuredCard.paper}</span>
                      {featuredCard.estimatedYear && <span className="study-badge">{featuredCard.estimatedYear}</span>}
                      {featuredCard.marks && <span className="study-badge">{featuredCard.marks} marks</span>}
                      <span className="study-badge study-badge-accent">{featuredCard.syllabusPath.at(-1)}</span>
                      <span className="study-badge">{featuredCard.topperCount} topper copies</span>
                    </div>

                    <div>
                      <h3 className="max-w-3xl text-[1.65rem] font-semibold leading-tight tracking-[-0.03em] text-[var(--question)] sm:text-[2rem]">
                        {featuredCard.question}
                      </h3>
                      <p className="mt-4 max-w-3xl text-sm leading-7 text-secondary">
                        {featuredCard.syllabusPath.at(-1)}
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[22px] border border-terminal bg-[color-mix(in_srgb,var(--bg-surface)_74%,transparent)] p-4">
                        <div className="overline">What you can do</div>
                        <div className="mt-3 grid gap-2 text-sm leading-7 text-secondary">
                          <span>Search by topic, issue, or paper.</span>
                          <span>Open linked topper material with context.</span>
                          <span>Mark progress without overcomplicating the workflow.</span>
                        </div>
                      </div>
                      <div className="rounded-[22px] border border-terminal bg-[color-mix(in_srgb,var(--bg-surface)_74%,transparent)] p-4">
                        <div className="overline">Topper copies</div>
                        <div className="mt-3 grid gap-3">
                          {featuredCopies.length > 0 ? (
                            featuredCopies.map((copy) => (
                              <div key={copy.answerId} className="rounded-[18px] border border-terminal bg-[color-mix(in_srgb,var(--bg-elevated)_88%,transparent)] px-3 py-3 text-sm leading-6 text-secondary">
                                <div className="font-semibold text-primary">{displayPublicTopperName(copy.topperName)}</div>
                                <div className="mt-1 text-xs text-muted">
                                  {copy.pageHint ? `Page ${copy.pageHint}` : "Page pending"}
                                  {copy.sourceAvailable ? " · source ready" : " · source pending"}
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="rounded-[18px] border border-terminal bg-[color-mix(in_srgb,var(--bg-elevated)_88%,transparent)] px-3 py-3 text-sm leading-6 text-secondary">
                              Open a paper, then move straight from the PYQ to attached topper copies and source pages.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm leading-7 text-secondary">
                    Open a paper, search by topic, and move through related PYQs and topper material without leaving the workspace.
                  </div>
                )}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <PreviewCard
                  title="Follow question trails"
                  detail="Move from a PYQ to related questions, answer signals, and useful source pages from the same screen."
                  icon={BookOpen}
                />
                <PreviewCard
                  title="See revision gaps"
                  detail="Track what got studied, what got skipped, and which topics need to come back into revision."
                  icon={Compass}
                />
                <PreviewCard
                  title="Keep prep practical"
                  detail="The product is built to stay useful for daily prep, not to impress with extra panels and noise."
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
