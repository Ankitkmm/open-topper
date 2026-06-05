"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, Search } from "lucide-react";
import { StudyNav } from "@/components/StudyNav";
import { getSubjectDefinition, getSubjectDefinitions } from "@/lib/subject-definitions";
import type { WorkspaceQuestion } from "@/lib/question-bank";

interface Props {
  initialQuestions: WorkspaceQuestion[];
  totalFiltered: number;
  searchParams: { q: string; category: string };
}

export function QuestionCards({ initialQuestions, totalFiltered, searchParams }: Props) {
  const topSubjects = subjectSummary(initialQuestions);
  const activeQuery = searchParams.q.trim();

  return (
    <main className="library-page min-h-screen">
      <StudyNav />

      <section className="mx-auto max-w-5xl px-5 py-8 sm:px-8 lg:px-10">
        <div className="overline mb-3">Search all questions</div>
        <h1 className="max-w-3xl text-3xl leading-tight tracking-[-0.02em] sm:text-4xl">
          Find the right past question, then open it in context.
        </h1>

        <form action="/browse" className="mt-7 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              name="q"
              defaultValue={searchParams.q}
              placeholder="Search by question text, topic, or syllabus words"
              className="soft-input h-13 w-full py-3 pl-12 pr-4 text-base"
            />
          </div>
          <input
            name="category"
            defaultValue={searchParams.category}
            placeholder="Subject (optional)"
            className="soft-input h-13 px-4 text-sm sm:w-48"
          />
          <button className="btn-primary h-13 justify-center px-5" type="submit">
            Search <ArrowRight size={15} aria-hidden="true" />
          </button>
        </form>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted">
          <span>
            <span className="mono-stat text-secondary">{totalFiltered.toLocaleString()}</span>{" "}
            {activeQuery ? <>results for “{activeQuery}”</> : "questions"}
          </span>
          {topSubjects.length > 0 && <span className="hidden h-1 w-1 rounded-full bg-[var(--border-strong)] sm:block" />}
          {topSubjects.map(([subject, count]) => {
            const route = getSubjectDefinitions().find(
              (item) => item.shortLabel === subject || item.label === subject,
            );
            return (
              <Link
                key={subject}
                href={route?.href || "/browse"}
                className="study-badge transition hover:border-[var(--accent-border)] hover:text-accent"
              >
                {subject}
                <span className="mono-stat text-muted">{count}</span>
              </Link>
            );
          })}
        </div>

        <div className="mt-7 grid gap-3">
          {initialQuestions.map((question) => (
            <article key={question.id} className="pyq-card p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="study-badge study-badge-accent">{question.subjectLabel}</span>
                    {question.estimatedYear && <span className="study-badge">{question.estimatedYear}</span>}
                    {question.marks && <span className="study-badge">{question.marks} marks</span>}
                    <span className="study-badge">
                      {question.linkedInsights.length} topper {question.linkedInsights.length === 1 ? "copy" : "copies"}
                    </span>
                  </div>
                  <h2 className="question-title text-lg leading-8 sm:text-xl">{question.question}</h2>
                  {question.syllabusPath.at(-1) && (
                    <p className="mt-3 text-sm leading-7 text-secondary">{question.syllabusPath.at(-1)}</p>
                  )}
                </div>
                <Link
                  href={subjectQuestionHref(question)}
                  className="btn-secondary shrink-0 justify-center sm:self-center"
                >
                  Open <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>
            </article>
          ))}
        </div>

        {initialQuestions.length === 0 && (
          <div className="soft-panel-muted mt-7 px-6 py-20 text-center">
            <BookOpen size={34} className="mx-auto mb-4 text-muted" aria-hidden="true" />
            <p className="text-secondary">No questions matched this search. Try a broader topic word.</p>
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
  return [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 6);
}
