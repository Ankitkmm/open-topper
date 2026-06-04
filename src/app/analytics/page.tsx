import type { Metadata } from "next";
import Link from "next/link";
import { getAnalyticsSummary, getSearchStatus, isDbAnalytics } from "@/lib/search-status";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Analytics - UPSCat",
  description: "See what PYQs ask most often, which syllabus areas dominate, and what themes recur across answer cards.",
};

export default async function AnalyticsPage() {
  const analytics = await getAnalyticsSummary();
  const status = await getSearchStatus();

  return (
    <main className="safe-page min-h-screen">
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <Link href="/" className="quiet-link mb-8 inline-flex items-center gap-2 text-xs uppercase tracking-[0.1em]">
          Back to subjects
        </Link>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-end">
          <div>
            <div className="overline mb-3">Analytics</div>
            <h1 className="max-w-3xl text-3xl font-semibold leading-tight sm:text-5xl">
              What PYQs ask most and which topics dominate the answer corpus.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-secondary">
              This is a backend-first analytics view built on the same answer-card search spine as the semantic search and subject workspaces.
            </p>
          </div>

          <div className="terminal-frame p-4">
            <div className="overline">Current spine</div>
            <div className="mt-3 space-y-2 text-sm text-secondary">
              <div>{status.searchDocuments.toLocaleString()} answer cards</div>
              <div>{status.questions.toLocaleString()} questions</div>
              <div>{status.embeddedSearchDocuments.toLocaleString()} embedded vectors</div>
            </div>
          </div>
        </div>

        <section className="mt-8 grid gap-5 lg:grid-cols-2">
          <Panel title="Subjects Asked Most">
            {isDbAnalytics(analytics) && analytics.subjects.map((subject) => (
              <Row key={subject.subject_key} label={subject.subject_key} value={`${Number(subject.count).toLocaleString()} answer cards`} />
            ))}
          </Panel>

          <Panel title="Top Syllabus Areas">
            {isDbAnalytics(analytics) && analytics.syllabi.map((item) => (
              <Row key={item.label} label={item.label} value={`${Number(item.count).toLocaleString()} answer cards`} />
            ))}
          </Panel>

          <Panel title="Most Repeated Topic Tags">
            {isDbAnalytics(analytics) && analytics.topics.map((item) => (
              <Row key={item.label} label={item.label} value={`${Number(item.count).toLocaleString()} mentions`} />
            ))}
          </Panel>

          <Panel title="Page Confidence">
            {isDbAnalytics(analytics) && analytics.pageStatus.map((item) => (
              <Row key={item.page_status} label={item.page_status} value={`${Number(item.count).toLocaleString()} answers`} />
            ))}
          </Panel>
        </section>
      </section>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="terminal-frame p-4">
      <div className="overline mb-3">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-terminal/60 py-2 text-sm">
      <div className="min-w-0 text-primary">{label}</div>
      <div className="shrink-0 text-right text-muted">{value}</div>
    </div>
  );
}
