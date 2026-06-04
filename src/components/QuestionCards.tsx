"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, CheckCircle2, Search } from "lucide-react";
import { AuthControls } from "@/components/auth/AuthControls";
import { getSubjectDefinition, getSubjectDefinitions } from "@/lib/subject-definitions";
import type { WorkspaceQuestion } from "@/lib/question-bank";

interface Props {
  initialQuestions: WorkspaceQuestion[];
  totalFiltered: number;
  searchParams: { q: string; category: string };
}

export function QuestionCards({ initialQuestions, totalFiltered, searchParams }: Props) {
  const topSubjects = subjectSummary(initialQuestions);

  return (
    <main className="safe-page min-h-screen">
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <Link href="/" className="quiet-link mb-8 inline-flex items-center gap-2 text-xs uppercase tracking-[0.1em]">
          Back to subjects
        </Link>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-end">
          <div>
            <div className="overline mb-3">Global PYQ search</div>
            <h1 className="max-w-3xl text-3xl font-semibold leading-tight sm:text-5xl">
              Search PYQs first. Open the right subject workspace second.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-secondary">
              This search now blends lexical and semantic retrieval so you can find the right PYQ
              faster, then open the subject workspace for syllabus placement, topper copies, and inline PDFs.
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
            <p className="mt-1 text-xs text-muted">PYQs matching the active query</p>
          </div>
        </div>

        <form action="/browse" className="mt-8 grid gap-3 terminal-frame p-3 sm:grid-cols-[1fr_220px_auto]">
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              name="q"
              defaultValue={searchParams.q}
              placeholder="Search PYQs by question text or syllabus words"
              className="input-terminal w-full pl-10 pr-4 py-3 text-sm"
            />
          </div>
          <input
            name="category"
            defaultValue={searchParams.category}
            placeholder="Subject filter (optional)"
            className="input-terminal px-4 py-3 text-sm"
          />
          <button className="btn-primary justify-center" type="submit">
            Search <ArrowRight size={15} />
          </button>
        </form>

        {topSubjects.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {topSubjects.map(([subject, count]) => {
              const route = getSubjectDefinitions().find((item) => item.shortLabel === subject || item.label === subject);
              return (
                <Link
                  key={subject}
                  href={route?.href || "/browse"}
                  className="inline-flex items-center gap-2 border border-terminal px-3 py-1.5 text-xs text-secondary"
                >
                  <BookOpen size={12} />
                  {subject}
                  <span className="mono-stat text-muted">{count}</span>
                </Link>
              );
            })}
          </div>
        )}

        <div className="mt-8 space-y-3">
          {initialQuestions.map((question) => (
            <article key={question.id} className="terminal-frame p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Badge>{question.subjectLabel}</Badge>
                    {question.estimatedYear && <Badge muted>{question.estimatedYear}</Badge>}
                    {question.marks && <Badge muted>{question.marks} marks</Badge>}
                    <Badge muted>{question.linkedInsights.length} topper copies</Badge>
                  </div>
                  <h2 className="text-base font-semibold leading-7 text-primary">{question.question}</h2>
                  {question.syllabusPath.at(-1) && (
                    <p className="mt-3 text-sm leading-6 text-secondary">{question.syllabusPath.at(-1)}</p>
                  )}
                </div>
                <Link href={subjectQuestionHref(question)} className="btn-secondary shrink-0 justify-center">
                  Open Subject <ArrowRight size={13} />
                </Link>
              </div>
            </article>
          ))}
        </div>

        {initialQuestions.length === 0 && (
          <div className="py-20 text-center">
            <BookOpen size={40} className="mx-auto mb-4 text-muted" />
            <p className="text-secondary">No PYQs matched this search.</p>
          </div>
        )}
      </section>
    </main>
  );
}

function subjectQuestionHref(question: WorkspaceQuestion) {
  const route = getSubjectDefinition(question.subjectKey);
  const params = new URLSearchParams();
  if (question.syllabusNodeId) params.set("syllabus", question.syllabusNodeId);
  return params.toString() ? `${route.href}?${params.toString()}` : route.href;
}

function subjectSummary(questions: WorkspaceQuestion[]) {
  const counts = new Map<string, number>();
  for (const question of questions) {
    counts.set(question.subjectLabel, (counts.get(question.subjectLabel) || 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 8);
}

function Badge({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[11px] mono-stat ${muted ? "border-terminal text-muted" : "border-accent text-accent bg-accent-dim"}`}>
      {children}
    </span>
  );
}
