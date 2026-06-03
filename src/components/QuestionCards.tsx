"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, CheckCircle2, Hash, Search, Sparkles } from "lucide-react";
import { AuthControls } from "@/components/auth/AuthControls";
import { useUserData } from "@/components/auth/UserDataProvider";
import type { SubjectPyqCard } from "@/lib/pyq";

const SUBJECT_LINKS: Record<string, string> = {
  "GS 1": "/gs1",
  History: "/gs1",
  "GS 2": "/gs2",
  "GS 3": "/gs3",
  "GS 4": "/gs4",
  Essay: "/essay",
  Geography: "/optional/geography",
  Sociology: "/optional/sociology",
  PSIR: "/optional/psir",
  "Public Administration": "/optional/public-administration",
  Anthropology: "/optional/anthropology",
};

interface Props {
  initialQuestions: SubjectPyqCard[];
  totalFiltered: number;
  searchParams: { q: string; category: string; keyword: string };
}

export function QuestionCards({ initialQuestions, totalFiltered, searchParams }: Props) {
  const { trackActivity } = useUserData();
  const [visible, setVisible] = useState(24);
  const displayed = initialQuestions.slice(0, visible);
  const topSubjects = useMemo(() => {
    const counts = new Map<string, number>();
    for (const question of initialQuestions) {
      counts.set(question.category, (counts.get(question.category) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [initialQuestions]);

  return (
    <main className="safe-page min-h-screen">
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <Link href="/" className="quiet-link mb-8 inline-flex items-center gap-2 text-xs uppercase tracking-[0.1em]">
          Back to subjects
        </Link>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-end">
          <div>
            <div className="overline mb-3">PYQ Search</div>
            <h1 className="max-w-3xl text-3xl font-semibold leading-tight sm:text-5xl">
              Search PYQs, then inspect matched answer signals.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-secondary">
              Search by question text, topic, or keyword. Open a subject to inspect matched answer questions, summaries, and source pages.
            </p>
            <div className="mt-5">
              <AuthControls compact />
            </div>
          </div>

          <div className="terminal-frame p-4">
            <div className="flex items-center gap-2 text-muted">
              <CheckCircle2 size={15} />
              <span className="overline">Current result set</span>
            </div>
            <div className="mono-stat mt-3 text-3xl text-accent">{totalFiltered.toLocaleString()}</div>
            <p className="mt-1 text-xs text-muted">PYQs matching the active filters</p>
          </div>
        </div>

        <form
          action="/browse"
          className="mt-8 grid gap-3 terminal-frame p-3 sm:grid-cols-[1fr_180px_auto]"
          onSubmit={() => trackActivity()}
        >
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              name="q"
              defaultValue={searchParams.q}
              placeholder="Search PYQs, themes, syllabus tags..."
              className="input-terminal w-full pl-10 pr-4 py-3 text-sm"
            />
          </div>
          <input
            name="keyword"
            defaultValue={searchParams.keyword}
            placeholder="Keyword"
            className="input-terminal px-4 py-3 text-sm"
          />
          {searchParams.category && <input type="hidden" name="category" value={searchParams.category} />}
          <button className="btn-primary justify-center" type="submit">
            Search <ArrowRight size={15} />
          </button>
        </form>

        {topSubjects.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {topSubjects.map(([subject, count]) => (
              <Link
                key={subject}
                href={SUBJECT_LINKS[subject] || `/browse?category=${encodeURIComponent(subject)}`}
                className="inline-flex items-center gap-2 border border-terminal px-3 py-1.5 text-xs text-secondary"
              >
                <BookOpen size={12} />
                {subject}
                <span className="mono-stat text-muted">{count}</span>
              </Link>
            ))}
          </div>
        )}

        <div className="mt-8 space-y-3">
          {displayed.map((question) => (
            <article key={question.id} className="terminal-frame p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="flex-1 min-w-0">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Badge>{question.category}</Badge>
                    {question.estimatedYear && <Badge muted>{question.estimatedYear}</Badge>}
                    {question.marks && <Badge muted>{question.marks} marks</Badge>}
                    <Badge muted>{question.relevantQuestionCount} relevant questions</Badge>
                    <Badge muted>{question.topperCount} answer signals</Badge>
                    {question.keywords.slice(0, 3).map((keyword) => (
                      <Badge key={keyword} muted>
                        <Hash size={10} /> {keyword}
                      </Badge>
                    ))}
                  </div>
                  <h2 className="text-base font-semibold leading-7 text-primary">{question.question}</h2>
                  {question.syllabusTags[0] && (
                    <p className="mt-3 text-xs leading-6 text-muted">{question.syllabusTags[0]}</p>
                  )}
                </div>
                <Link href={subjectQuestionHref(question)} className="btn-secondary shrink-0 justify-center" onClick={() => trackActivity()}>
                  Open Subject <ArrowRight size={13} />
                </Link>
              </div>
            </article>
          ))}
        </div>

        {visible < initialQuestions.length && (
          <div className="mt-8 text-center">
            <button className="btn-secondary" onClick={() => setVisible((value) => value + 24)}>
              Show More <Sparkles size={13} />
            </button>
          </div>
        )}

        {displayed.length === 0 && (
          <div className="py-20 text-center">
            <BookOpen size={40} className="mx-auto mb-4 text-muted" />
            <p className="text-secondary">No PYQs matched this search.</p>
          </div>
        )}
      </section>
    </main>
  );
}

function subjectQuestionHref(question: SubjectPyqCard) {
  const base = SUBJECT_LINKS[question.category] || "/";
  if (base === "/") return base;
  const query = encodeURIComponent(question.question.replace(/\([^)]*\bmarks?[^)]*\)/gi, "").slice(0, 120));
  return `${base}?q=${query}`;
}

function Badge({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[11px] mono-stat ${muted ? "border-terminal text-muted" : "border-accent text-accent bg-accent-dim"}`}>
      {children}
    </span>
  );
}
