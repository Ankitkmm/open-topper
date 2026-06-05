import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FileText, ListChecks, Search, Sparkles } from "lucide-react";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/MarketingShell";
import { SITE_NAME } from "@/lib/marketing";
import { getBrowseStats, getFeaturedSubjectQuestion } from "@/lib/pyq";
import { getSubjectDefinition, getSubjectDefinitions, type SubjectKey } from "@/lib/subject-definitions";
import { normalizePublicTopperName } from "@/lib/public-records";

export const metadata: Metadata = {
  title: `${SITE_NAME} | Semantic search for UPSC topper answers`,
  description:
    "Search thousands of UPSC past year questions by meaning, then study the exact topper copies that answered them. A calm study space, not a dashboard.",
};

const PRIMARY_SUBJECTS: SubjectKey[] = ["gs1", "gs2", "gs3", "gs4", "essay"];
const OPTIONAL_SUBJECTS: SubjectKey[] = [
  "geography",
  "sociology",
  "psir",
  "public-administration",
  "anthropology",
  "history",
];

const EXAMPLE_QUERIES = [
  "federalism",
  "ethical dilemma",
  "Article 356",
  "monsoon",
  "secularism",
  "poverty & inclusion",
];

const FEATURES = [
  {
    icon: Search,
    title: "Search by meaning",
    detail: "Type an idea, not just keywords. Semantic + keyword retrieval surfaces the right questions even when the wording differs.",
  },
  {
    icon: ListChecks,
    title: "Mapped to the syllabus",
    detail: "Every question sits in its real syllabus spot, so you can revise a topic the way the exam actually frames it.",
  },
  {
    icon: FileText,
    title: "Real topper copies",
    detail: "Open the linked topper answers, skim a short summary, and read the source page itself in a new tab.",
  },
];

export default async function LandingPage() {
  const stats = await getBrowseStats();
  const featuredCard = await getFeaturedSubjectQuestion("gs1");
  const featuredCopies = featuredCard?.linkedInsights.slice(0, 3) || [];
  const subjectCount = getSubjectDefinitions().length;

  return (
    <main className="library-page min-h-screen">
      <MarketingHeader />

      {/* ---------------- Hero ---------------- */}
      <section className="relative overflow-hidden">
        <div className="hero-glow left-[-12%] top-[-10%] h-[26rem] w-[26rem]" style={{ background: "color-mix(in srgb, var(--gold) 30%, transparent)" }} aria-hidden="true" />
        <div className="hero-glow right-[-12%] top-[-6%] h-[30rem] w-[30rem]" style={{ background: "color-mix(in srgb, var(--accent) 28%, transparent)" }} aria-hidden="true" />

        <div className="relative mx-auto max-w-3xl px-5 pb-16 pt-16 text-center sm:px-8 sm:pt-24">
          <div className="animate-rise inline-flex items-center gap-2 study-badge study-badge-accent" style={{ animationDelay: "0ms" }}>
            <Sparkles size={13} aria-hidden="true" />
            Semantic PYQ search
          </div>

          <h1 className="animate-rise mt-6 text-[2.7rem] leading-[1.05] tracking-[-0.025em] sm:text-[3.9rem]" style={{ animationDelay: "60ms" }}>
            Search UPSC questions the way{" "}
            <span style={{ color: "var(--accent)" }}>toppers</span> answered them.
          </h1>

          <p className="animate-rise mx-auto mt-6 max-w-xl text-base leading-8 text-secondary sm:text-lg" style={{ animationDelay: "120ms" }}>
            A search engine over thousands of past year questions and the real topper copies that go
            with them. Type an idea — not just keywords — and start studying in seconds.
          </p>
          <p className="animate-rise mx-auto mt-4 max-w-xl text-sm leading-7 text-muted" style={{ animationDelay: "150ms" }}>
            PYQs stay public. Opening topper-copy details, summaries, and PDFs requires sign-in.
          </p>

          <form action="/browse" className="animate-rise mx-auto mt-9 max-w-2xl" style={{ animationDelay: "180ms" }}>
            <div className="search-hero">
              <Search size={20} className="shrink-0 text-muted" aria-hidden="true" />
              <input
                name="q"
                placeholder="Search a topic, theme, or paper…"
                aria-label="Search past year questions"
                autoComplete="off"
              />
              <button type="submit" className="btn-primary h-12 shrink-0 px-5">
                Search <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </form>

          <div className="animate-rise mt-5 flex flex-wrap items-center justify-center gap-2" style={{ animationDelay: "240ms" }}>
            <span className="text-xs text-muted">Try</span>
            {EXAMPLE_QUERIES.map((q) => (
              <Link
                key={q}
                href={`/browse?q=${encodeURIComponent(q)}`}
                className="study-badge transition hover:border-[var(--accent-border)] hover:text-accent"
              >
                {q}
              </Link>
            ))}
          </div>

          <div className="animate-rise mt-9 flex flex-wrap items-center justify-center gap-x-8 gap-y-3" style={{ animationDelay: "300ms" }}>
            <Stat value={stats.totalQuestions.toLocaleString()} label="questions" />
            <Divider />
            <Stat value={stats.answerLinks.toLocaleString()} label="topper answer links" />
            <Divider />
            <Stat value={`${subjectCount}`} label="subjects & papers" />
          </div>
        </div>
      </section>

      {/* ---------------- Live preview ---------------- */}
      {featuredCard && (
        <section className="mx-auto max-w-4xl px-5 pb-4 sm:px-8 lg:px-10">
          <div className="soft-panel animate-rise overflow-hidden p-6 sm:p-8" style={{ animationDelay: "360ms" }}>
            <div className="flex items-center justify-between gap-4">
              <span className="overline">A result, the way you read it</span>
              <span className="study-badge">{featuredCard.paper}</span>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {featuredCard.estimatedYear && <span className="study-badge">{featuredCard.estimatedYear}</span>}
              {featuredCard.marks && <span className="study-badge">{featuredCard.marks} marks</span>}
              <span className="study-badge study-badge-accent">{featuredCard.syllabusPath.at(-1)}</span>
            </div>

            <h2 className="question-title mt-4 max-w-3xl text-2xl leading-relaxed sm:text-[1.7rem]">
              {featuredCard.question}
            </h2>

            {featuredCopies.length > 0 && (
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {featuredCopies.map((copy) => {
                  const name = normalizePublicTopperName(copy.topperName);
                  return (
                    <div key={copy.answerId} className="soft-panel-muted p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <FileText size={14} className="text-accent" aria-hidden="true" />
                        {name ?? "Topper copy"}
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        {[copy.rank ? `AIR ${copy.rank}` : null, copy.year, copy.pageHint ? `Page ${copy.pageHint}` : null]
                          .filter(Boolean)
                          .join(" · ") || "Source linked"}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-7">
              <Link href="/gs1" className="btn-primary">
                Open this in the workspace <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
            <p className="mt-4 text-xs leading-6 text-muted">
              Source availability varies by question. Rights remain with the original institutes and
              material owners, and valid takedown requests are honored promptly.
            </p>
          </div>
        </section>
      )}

      {/* ---------------- Browse by paper ---------------- */}
      <section className="mx-auto max-w-6xl px-5 py-14 sm:px-8 lg:px-10">
        <div className="mb-5 flex items-baseline justify-between gap-4">
          <h2 className="text-2xl tracking-[-0.01em] sm:text-3xl">Browse by paper</h2>
          <Link href="/browse" className="quiet-link inline-flex items-center gap-1.5 text-sm">
            Search everything <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PRIMARY_SUBJECTS.map((key) => {
            const subject = getSubjectDefinition(key);
            const count = stats.categoryCounts.get(subject.label) || 0;
            return (
              <Link
                key={key}
                href={subject.href}
                className="pyq-card group flex flex-col p-5 transition-transform hover:-translate-y-0.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xl tracking-[-0.01em]">{subject.title}</span>
                  <ArrowRight
                    size={17}
                    className="text-muted transition-transform group-hover:translate-x-1 group-hover:text-accent"
                    aria-hidden="true"
                  />
                </div>
                <p className="mt-2 text-sm leading-6 text-secondary">{subject.description}</p>
                {count > 0 && (
                  <span className="mt-4 text-xs text-muted">
                    <span className="mono-stat">{count.toLocaleString()}</span> questions
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        <div className="mt-5">
          <div className="overline mb-2">Optional subjects</div>
          <div className="flex flex-wrap gap-2">
            {OPTIONAL_SUBJECTS.map((key) => {
              const subject = getSubjectDefinition(key);
              return (
                <Link
                  key={key}
                  href={subject.href}
                  className="study-badge transition hover:border-[var(--accent-border)] hover:text-accent"
                >
                  {subject.label}
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---------------- How it works ---------------- */}
      <section className="section-band">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 lg:px-10">
          <h2 className="text-2xl tracking-[-0.01em] sm:text-3xl">Built for long study sessions</h2>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {FEATURES.map((feature) => (
              <article key={feature.title} className="soft-panel p-6">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--accent-soft)] text-accent">
                  <feature.icon size={19} aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-xl tracking-[-0.01em]">{feature.title}</h3>
                <p className="mt-2 text-sm leading-7 text-secondary">{feature.detail}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <div className="mono-stat text-2xl text-primary">{value}</div>
      <div className="mt-1 text-xs text-muted">{label}</div>
    </div>
  );
}

function Divider() {
  return <span className="hidden h-8 w-px bg-[var(--border-strong)] sm:block" aria-hidden="true" />;
}
