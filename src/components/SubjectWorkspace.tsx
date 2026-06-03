"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  FileText,
  Library,
  Loader2,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { AuthControls } from "@/components/auth/AuthControls";
import { useUserData } from "@/components/auth/UserDataProvider";
import { ProgressToggle } from "./ProgressToggle";
import { SubjectProgress } from "./SubjectProgress";
import { ThemeSwitcher } from "./ThemeProvider";
import type { SubjectPyqCard } from "@/lib/pyq";

interface SubjectWorkspaceProps {
  subjectKey: string;
  title: string;
  description: string;
  cards: SubjectPyqCard[];
  query?: string;
}

interface PdfState {
  url: string;
  page: number;
  title: string;
}

type WorkspaceTab = "pyqs" | "topper" | "search";

const PAGE_SIZE = 18;
const SUBJECT_TABS = [
  { key: "gs1", label: "GS I", href: "/gs1" },
  { key: "gs2", label: "GS II", href: "/gs2" },
  { key: "gs3", label: "GS III", href: "/gs3" },
  { key: "gs4", label: "GS IV", href: "/gs4" },
  { key: "essay", label: "Essay", href: "/essay" },
];

export function SubjectWorkspace({ subjectKey, title, description, cards, query = "" }: SubjectWorkspaceProps) {
  const { trackActivity } = useUserData();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(query ? "search" : "pyqs");
  const [workspaceQuery, setWorkspaceQuery] = useState(query);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [revealedQuestions, setRevealedQuestions] = useState<Set<string>>(new Set());
  const [openRelevantQuestions, setOpenRelevantQuestions] = useState<Set<string>>(new Set());
  const [openSummaries, setOpenSummaries] = useState<Set<string>>(new Set());
  const [pdf, setPdf] = useState<PdfState | null>(null);
  const [loadingAnswer, setLoadingAnswer] = useState<string | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);

  const topicIndex = useMemo(() => buildTopicIndex(cards.filter((card) => matchesWorkspaceFilters(card, workspaceQuery, null))), [cards, workspaceQuery]);
  const filteredCards = useMemo(
    () => cards.filter((card) => matchesWorkspaceFilters(card, workspaceQuery, selectedTopic)),
    [cards, selectedTopic, workspaceQuery],
  );
  const visibleCards = filteredCards.slice(0, visibleCount);
  const yearGroups = useMemo(() => groupCardsByYear(visibleCards), [visibleCards]);
  const topperQuestions = useMemo(() => flattenRelevantQuestions(filteredCards).slice(0, visibleCount * 2), [filteredCards, visibleCount]);
  const relevantCount = useMemo(() => filteredCards.reduce((sum, card) => sum + card.relevantQuestionCount, 0), [filteredCards]);
  const linkedCount = useMemo(() => filteredCards.reduce((sum, card) => sum + card.topperCount, 0), [filteredCards]);

  function toggleSet(setter: (next: Set<string>) => void, current: Set<string>, id: string) {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  function chooseTopic(topic: string | null) {
    setSelectedTopic(topic);
    setVisibleCount(PAGE_SIZE);
    if (topic) trackActivity();
  }

  async function openPdf(answerId: string, titleText: string) {
    setLoadingAnswer(answerId);
    setViewerError(null);
    try {
      const response = await fetch("/api/answer-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answerId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "PDF could not be opened.");
      setPdf({ url: payload.embedUrl, page: payload.page, title: titleText });
      trackActivity(2);
    } catch (error) {
      setViewerError(error instanceof Error ? error.message : "PDF could not be opened.");
    } finally {
      setLoadingAnswer(null);
    }
  }

  return (
    <main className="library-page min-h-screen">
      <section className="mx-auto max-w-7xl px-5 py-5 sm:px-8 lg:px-10">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-terminal pb-5">
          <Link href="/" className="quiet-link inline-flex items-center gap-2 text-sm font-semibold">
            <ArrowLeft size={16} aria-hidden="true" />
            Subjects
          </Link>
          <nav className="flex flex-wrap items-center gap-2" aria-label="Subjects">
            {SUBJECT_TABS.map((item) => (
              <Link key={item.key} href={item.href} className={item.key === subjectKey ? "btn-primary" : "btn-secondary"}>
                {item.label}
              </Link>
            ))}
            <ThemeSwitcher compact />
            <AuthControls compact />
            <Link href="/browse" className="btn-secondary">
              <Search size={15} aria-hidden="true" />
              Search all
            </Link>
          </nav>
        </header>

        <section className="grid gap-8 py-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
          <div>
            <div className="overline mb-3">Subject workspace / {subjectKey.replace("-", " ")}</div>
            <h1 className="text-4xl font-semibold leading-tight sm:text-6xl">{title}</h1>
            <p className="mt-4 max-w-2xl text-base leading-8 text-secondary">{description}</p>
          </div>
          <SubjectProgress questionIds={cards.map((card) => card.id)} />
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="PYQs" value={filteredCards.length.toLocaleString()} />
          <Metric label="Relevant questions" value={relevantCount.toLocaleString()} />
          <Metric label="Answer signals" value={linkedCount.toLocaleString()} />
          <Metric label="Progress" value="Local" />
        </section>

        <section className="mt-6 grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="soft-panel h-fit p-3 lg:sticky lg:top-4">
            <div className="overline px-2 pb-2">Syllabus topics</div>
            <button
              type="button"
              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${selectedTopic ? "text-secondary hover:bg-[var(--accent-soft)]" : "bg-[var(--accent-soft)] text-accent"}`}
              onClick={() => chooseTopic(null)}
            >
              <span>All topics</span>
              <span className="mono-stat text-xs">{cards.filter((card) => matchesWorkspaceFilters(card, workspaceQuery, null)).length}</span>
            </button>
            <div className="mt-2 grid max-h-[58vh] gap-1 overflow-auto pr-1">
              {topicIndex.slice(0, 80).map((topic) => (
                <button
                  key={topic.name}
                  type="button"
                  className={`rounded-md px-3 py-2 text-left text-sm leading-5 ${selectedTopic === topic.name ? "bg-[var(--accent-soft)] text-accent" : "text-secondary hover:bg-[var(--accent-soft)]"}`}
                  onClick={() => chooseTopic(topic.name)}
                >
                  <span className="block font-semibold">{topic.name}</span>
                  <span className="mt-1 block text-xs text-muted">{topic.pyqs} PYQs · {topic.copies} signals</span>
                </button>
              ))}
            </div>
          </aside>

          <div className="min-w-0">
            <div className="soft-panel p-3 sm:p-4">
              <div className="flex flex-wrap gap-2">
                <TabButton active={activeTab === "pyqs"} onClick={() => setActiveTab("pyqs")}>PYQs</TabButton>
                <TabButton active={activeTab === "topper"} onClick={() => setActiveTab("topper")}>Answer Paths</TabButton>
                <TabButton active={activeTab === "search"} onClick={() => setActiveTab("search")}>Search</TabButton>
              </div>
              <div className="relative mt-4">
                <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
                <input
                  value={workspaceQuery}
                  onChange={(event) => {
                    setWorkspaceQuery(event.target.value);
                    setVisibleCount(PAGE_SIZE);
                    if (activeTab !== "search" && event.target.value.trim()) setActiveTab("search");
                  }}
                  placeholder="Search official PYQs, matched questions, names, institutes, marks, topics..."
                  className="soft-input h-12 w-full pl-11 pr-4 text-sm"
                />
              </div>
              {(selectedTopic || workspaceQuery.trim()) && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-secondary">
                  {workspaceQuery.trim() && <span className="study-badge">Search: {workspaceQuery.trim()}</span>}
                  {selectedTopic && <span className="study-badge study-badge-accent">{selectedTopic}</span>}
                  {selectedTopic && <button type="button" className="quiet-link text-xs font-semibold" onClick={() => chooseTopic(null)}>Clear topic</button>}
                </div>
              )}
            </div>

            {viewerError && (
              <div className="mt-4 soft-panel-muted p-4 text-sm text-secondary">
                {viewerError}
              </div>
            )}

            {activeTab === "topper" ? (
              <TopperQuestionTab
                questions={topperQuestions}
                openRelevantQuestions={openRelevantQuestions}
                openSummaries={openSummaries}
                loadingAnswer={loadingAnswer}
                onToggleCopies={(id) => {
                  toggleSet(setOpenRelevantQuestions, openRelevantQuestions, id);
                  trackActivity();
                }}
                onToggleSummary={(answerId) => {
                  toggleSet(setOpenSummaries, openSummaries, answerId);
                  trackActivity();
                }}
                onOpenPdf={openPdf}
              />
            ) : (
              <section className="mt-7 grid gap-5">
                {yearGroups.map((group) => (
                  <div key={group.label} className="grid gap-4">
                    <div className="overline sticky top-0 z-10 w-fit rounded-full border border-terminal bg-[var(--bg-surface)] px-3 py-1">
                      {group.label}
                    </div>
                    {group.cards.map((card, index) => {
                      const questionsOpen = revealedQuestions.has(card.id);
                      const hasRelevantQuestions = card.relevantQuestions.length > 0;
                      return (
                        <PyqCard
                          key={card.id}
                          card={card}
                          index={index}
                          questionsOpen={questionsOpen}
                          hasRelevantQuestions={hasRelevantQuestions}
                          openRelevantQuestions={openRelevantQuestions}
                          openSummaries={openSummaries}
                          loadingAnswer={loadingAnswer}
                          onToggleQuestions={() => {
                            toggleSet(setRevealedQuestions, revealedQuestions, card.id);
                            trackActivity();
                          }}
                          onToggleCopies={(id) => {
                            toggleSet(setOpenRelevantQuestions, openRelevantQuestions, id);
                            trackActivity();
                          }}
                          onToggleSummary={(answerId) => {
                            toggleSet(setOpenSummaries, openSummaries, answerId);
                            trackActivity();
                          }}
                          onOpenPdf={openPdf}
                        />
                      );
                    })}
                  </div>
                ))}
              </section>
            )}

            {filteredCards.length === 0 && (
              <div className="py-20 text-center">
                <Library size={42} className="mx-auto mb-4 text-muted" aria-hidden="true" />
                <p className="text-secondary">No PYQs matched this filter.</p>
              </div>
            )}

            {visibleCount < filteredCards.length && (
              <div className="flex justify-center py-10">
                <button type="button" className="btn-primary" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
                  Load more
                  <ChevronDown size={15} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        </section>
      </section>

      {pdf && (
        <div className="pdf-modal-backdrop" role="dialog" aria-modal="true" aria-label="PDF viewer">
          <div className="pdf-modal">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-terminal p-4">
              <div>
                <div className="text-sm font-semibold">{pdf.title}</div>
                <div className="mt-1 text-xs text-muted">Source page: {pdf.page}</div>
              </div>
              <button type="button" className="btn-secondary" onClick={() => setPdf(null)}>
                <X size={15} aria-hidden="true" />
                Close
              </button>
            </div>
            <iframe title={pdf.title} src={pdf.url} className="h-full w-full bg-white" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
          </div>
        </div>
      )}
    </main>
  );
}

function PyqCard({
  card,
  index,
  questionsOpen,
  hasRelevantQuestions,
  openRelevantQuestions,
  openSummaries,
  loadingAnswer,
  onToggleQuestions,
  onToggleCopies,
  onToggleSummary,
  onOpenPdf,
}: {
  card: SubjectPyqCard;
  index: number;
  questionsOpen: boolean;
  hasRelevantQuestions: boolean;
  openRelevantQuestions: Set<string>;
  openSummaries: Set<string>;
  loadingAnswer: string | null;
  onToggleQuestions: () => void;
  onToggleCopies: (id: string) => void;
  onToggleSummary: (answerId: string) => void;
  onOpenPdf: (answerId: string, titleText: string) => void;
}) {
  return (
    <article className="pyq-card overflow-hidden">
      <div className="grid gap-4 p-4 sm:grid-cols-[48px_1fr_auto] sm:p-5">
        <div className="mono-stat hidden h-11 w-11 place-items-center rounded-full bg-[var(--accent-soft)] text-xs text-accent sm:grid">
          {String(index + 1).padStart(2, "0")}
        </div>

        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="study-badge">{card.paper}</span>
            {card.estimatedYear && <span className="study-badge">{card.estimatedYear}</span>}
            {card.marks && <span className="study-badge">{card.marks} marks</span>}
            <span className={hasRelevantQuestions ? "study-badge study-badge-accent" : "study-badge"}>
              {card.relevantQuestionCount} relevant {card.relevantQuestionCount === 1 ? "question" : "questions"}
            </span>
            <span className="study-badge">{card.topperCount} {card.topperCount === 1 ? "answer" : "answers"}</span>
            {yearBuckets(card).map((bucket) => (
              <span key={bucket.label} className="study-badge">{bucket.label} · {bucket.count}</span>
            ))}
          </div>

          <h2 className="question-title text-lg font-semibold leading-8 sm:text-xl">
            {highlightQuestion(card.question, card.keywords)}
          </h2>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {uniqueTopics([...card.syllabusTags, ...card.keywords]).slice(0, 8).map((keyword) => (
              <span key={keyword} className="study-badge">{keyword}</span>
            ))}
          </div>
        </div>

        <div className="flex flex-col items-start gap-2 sm:items-end">
          <ProgressToggle questionId={card.id} />
          <button type="button" className={hasRelevantQuestions ? "btn-primary" : "btn-secondary"} onClick={onToggleQuestions}>
            <BookOpen size={15} aria-hidden="true" />
            {questionsOpen ? "Hide questions" : "Relevant questions"}
          </button>
        </div>
      </div>

      {questionsOpen && (
        <div className="animate-fade-in border-t border-terminal p-4 sm:p-5">
          <div className="grid gap-4">
            {card.relevantQuestions.length > 0 ? (
              card.relevantQuestions.map((relevant) => (
                <RelevantQuestion
                  key={`${card.id}-${relevant.id}`}
                  relevant={relevant}
                  officialQuestion={card.question}
                  copiesOpen={openRelevantQuestions.has(relevant.id)}
                  openSummaries={openSummaries}
                  loadingAnswer={loadingAnswer}
                  onToggleCopies={() => onToggleCopies(relevant.id)}
                  onToggleSummary={onToggleSummary}
                  onOpenPdf={(answerId, titleText) => onOpenPdf(answerId, titleText)}
                />
              ))
            ) : (
              <div className="soft-panel-muted p-4 text-sm leading-7 text-secondary">
                No same-topic answered question is ready for this PYQ yet.
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function TopperQuestionTab({
  questions,
  openRelevantQuestions,
  openSummaries,
  loadingAnswer,
  onToggleCopies,
  onToggleSummary,
  onOpenPdf,
}: {
  questions: { card: SubjectPyqCard; relevant: SubjectPyqCard["relevantQuestions"][number] }[];
  openRelevantQuestions: Set<string>;
  openSummaries: Set<string>;
  loadingAnswer: string | null;
  onToggleCopies: (id: string) => void;
  onToggleSummary: (answerId: string) => void;
  onOpenPdf: (answerId: string, titleText: string) => void;
}) {
  return (
    <section className="mt-7 grid gap-4">
      {questions.map(({ card, relevant }) => (
        <div key={`${card.id}-${relevant.id}`} className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="study-badge">{card.paper}</span>
            {card.estimatedYear && <span className="study-badge">{card.estimatedYear}</span>}
            <span className="line-clamp-1">{card.question}</span>
          </div>
          <RelevantQuestion
            relevant={relevant}
            officialQuestion={card.question}
            copiesOpen={openRelevantQuestions.has(relevant.id)}
            openSummaries={openSummaries}
            loadingAnswer={loadingAnswer}
            onToggleCopies={() => onToggleCopies(relevant.id)}
            onToggleSummary={onToggleSummary}
            onOpenPdf={onOpenPdf}
          />
        </div>
      ))}
      {questions.length === 0 && (
        <div className="soft-panel-muted p-6 text-sm text-secondary">No matched answer questions found for this filter.</div>
      )}
    </section>
  );
}

function RelevantQuestion({
  relevant,
  officialQuestion,
  copiesOpen,
  openSummaries,
  loadingAnswer,
  onToggleCopies,
  onToggleSummary,
  onOpenPdf,
}: {
  relevant: SubjectPyqCard["relevantQuestions"][number];
  officialQuestion: string;
  copiesOpen: boolean;
  openSummaries: Set<string>;
  loadingAnswer: string | null;
  onToggleCopies: () => void;
  onToggleSummary: (answerId: string) => void;
  onOpenPdf: (answerId: string, titleText: string) => void;
}) {
  const topics = [...relevant.syllabusTags, ...relevant.keywords]
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, values) => values.indexOf(item) === index)
    .slice(0, 8);
  const copyGroups = groupTopperCopies(relevant.topperCopies);

  return (
    <article className="soft-panel-muted overflow-hidden">
      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_auto] lg:items-start">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="study-badge study-badge-accent">{matchStatusLabel(relevant.matchType, relevant.matchConfidence)}</span>
            <span className="study-badge">{relevant.topperCount} {relevant.topperCount === 1 ? "answer" : "answers"}</span>
            {relevant.sourceAvailableCount > 0 && <span className="study-badge">{relevant.sourceAvailableCount} PDFs</span>}
            {relevant.topperCopies[0]?.institute && <span className="study-badge">{relevant.topperCopies[0].institute}</span>}
          </div>
          <h3 className="question-title text-base font-semibold leading-7">{relevant.question}</h3>
          <p className="mt-2 text-xs leading-6 text-muted">Mapped from PYQ: {officialQuestion}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {topics.map((topic) => (
              <span key={topic} className="study-badge">{topic}</span>
            ))}
          </div>
          {relevant.matchReason && <p className="mt-3 text-xs leading-6 text-muted">{relevant.matchReason}</p>}
        </div>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          <button type="button" className="btn-secondary" onClick={onToggleCopies}>
            <ChevronDown size={15} aria-hidden="true" />
            {copiesOpen ? "Hide answers" : "Answer signals"}
          </button>
        </div>
      </div>

      {copiesOpen && (
        <div className="grid gap-3 border-t border-terminal p-4">
          {copyGroups.map((group) => (
            <section key={group.key} className="grid gap-2">
              {copyGroups.length > 1 && (
                <div className="overline px-1">{group.label} · {group.copies.length}</div>
              )}
              {group.copies.map((copy) => (
                <TopperCopy
                  key={copy.answerId}
                  copy={copy}
                  relevantQuestion={relevant.question}
                  summaryOpen={openSummaries.has(copy.answerId)}
                  loading={loadingAnswer === copy.answerId}
                  onToggleSummary={() => onToggleSummary(copy.answerId)}
                  onOpenPdf={() => onOpenPdf(copy.answerId, `${copy.topperName} - ${relevant.paper || relevant.category || "Answer source"}`)}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </article>
  );
}

function TopperCopy({
  copy,
  relevantQuestion,
  summaryOpen,
  loading,
  onToggleSummary,
  onOpenPdf,
}: {
  copy: SubjectPyqCard["relevantQuestions"][number]["topperCopies"][number];
  relevantQuestion: string;
  summaryOpen: boolean;
  loading: boolean;
  onToggleSummary: () => void;
  onOpenPdf: () => void;
}) {
  const credit = [
    copy.rank ? `AIR ${copy.rank}` : null,
    copy.year ? `${copy.year}` : null,
    copy.institute,
    copy.marks ? `marks ${copy.marks}` : null,
    copy.pageHint ? `page ${copy.pageHint}` : null,
  ].filter(Boolean);
  const hasSummary = copy.summaryStatus === "available" && Boolean(copy.interpretation || copy.valueAdds.length);
  const topicValues = copy.valueAdds.filter(Boolean);

  return (
    <article className="soft-panel p-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{copy.topperName}</span>
            {credit.map((item) => (
              <span key={item} className="study-badge">{item}</span>
            ))}
          </div>
          <p className="mt-2 text-xs leading-6 text-muted">{relevantQuestion}</p>
        </div>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          <button type="button" className="btn-secondary" onClick={onToggleSummary}>
            <Sparkles size={15} aria-hidden="true" />
            {summaryOpen ? "Hide summary" : hasSummary ? "Summary" : "Summary unavailable"}
          </button>
          {topicValues.length > 0 && (
            <button type="button" className="btn-secondary" onClick={onToggleSummary}>
              <Search size={15} aria-hidden="true" />
              Topics
            </button>
          )}
          {copy.sourceAvailable && copy.pageHint ? (
            <button type="button" className="btn-primary" onClick={onOpenPdf} disabled={loading}>
              {loading ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <FileText size={15} aria-hidden="true" />}
              Open source page
            </button>
          ) : (
            <span className="study-badge">{pdfStatusLabel()}</span>
          )}
        </div>
      </div>

      {summaryOpen && (
        <div className="summary-box mt-4 p-4">
          {hasSummary ? (
            <div className="space-y-4">
              {copy.interpretation && (
                <div className="space-y-2 text-sm leading-7 text-secondary">
                  {copy.interpretation.split(/\n+/).map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              )}
              {topicValues.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {topicValues.map((value) => (
                    <span key={value} className="study-badge">{value}</span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm leading-7 text-secondary">
              Summary unavailable for this answer source.
            </p>
          )}
        </div>
      )}
    </article>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={active ? "btn-primary" : "btn-secondary"} onClick={onClick}>
      {children}
    </button>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="soft-panel p-4">
      <div className="overline">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-accent">{value}</div>
    </div>
  );
}

function buildTopicIndex(cards: SubjectPyqCard[]) {
  const topics = new Map<string, { name: string; pyqs: number; copies: number }>();
  for (const card of cards) {
    const cardTopics = new Set([...card.syllabusTags, ...card.keywords].map(cleanTopic).filter(Boolean).slice(0, 12));
    for (const topic of cardTopics) {
      const existing = topics.get(topic) || { name: topic, pyqs: 0, copies: 0 };
      existing.pyqs += 1;
      existing.copies += card.topperCount;
      topics.set(topic, existing);
    }
  }
  return [...topics.values()].sort((a, b) => b.copies - a.copies || b.pyqs - a.pyqs || a.name.localeCompare(b.name));
}

function matchesWorkspaceFilters(card: SubjectPyqCard, query: string, selectedTopic: string | null) {
  if (selectedTopic) {
    const topics = [...card.syllabusTags, ...card.keywords].map(cleanTopic);
    if (!topics.includes(cleanTopic(selectedTopic))) return false;
  }

  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 1);
  if (terms.length === 0) return true;
  const haystack = [
    card.question,
    card.paper,
    card.category,
    card.estimatedYear,
    card.marks,
    card.syllabusTags.join(" "),
    card.keywords.join(" "),
    ...card.relevantQuestions.flatMap((relevant) => [
      relevant.question,
      relevant.matchType,
      relevant.matchReason,
      relevant.syllabusTags.join(" "),
      relevant.keywords.join(" "),
      ...relevant.topperCopies.flatMap((copy) => [
        copy.topperName,
        copy.rank ? `AIR ${copy.rank}` : "",
        copy.year,
        copy.institute,
        copy.marks,
        copy.pageHint ? `page ${copy.pageHint}` : "",
        copy.valueAdds.join(" "),
      ]),
    ]),
  ].join(" ").toLowerCase();

  return terms.every((term) => haystack.includes(term));
}

function groupCardsByYear(cards: SubjectPyqCard[]) {
  const groups = new Map<string, SubjectPyqCard[]>();
  for (const card of cards) {
    const label = card.estimatedYear ? String(card.estimatedYear) : "Year not tagged";
    const bucket = groups.get(label) || [];
    bucket.push(card);
    groups.set(label, bucket);
  }
  return [...groups.entries()].map(([label, groupCards]) => ({ label, cards: groupCards }));
}

function flattenRelevantQuestions(cards: SubjectPyqCard[]) {
  return cards
    .flatMap((card) => card.relevantQuestions.map((relevant) => ({ card, relevant })))
    .sort((a, b) => b.relevant.topperCount - a.relevant.topperCount || b.relevant.matchConfidence - a.relevant.matchConfidence);
}

function groupTopperCopies(copies: SubjectPyqCard["relevantQuestions"][number]["topperCopies"]) {
  const groups = new Map<string, typeof copies>();
  for (const copy of copies) {
    const key = [copy.topperName || "Anonymous topper", copy.institute || "No coaching", copy.year || "No year"].join("|");
    const bucket = groups.get(key) || [];
    bucket.push(copy);
    groups.set(key, bucket);
  }
  return [...groups.entries()].map(([key, groupCopies]) => ({
    key,
    label: key.split("|").filter((part) => !part.startsWith("No ")).join(" · ") || "Anonymous topper",
    copies: groupCopies,
  }));
}

function yearBuckets(card: SubjectPyqCard) {
  const counts = new Map<string, number>();
  for (const relevant of card.relevantQuestions) {
    for (const copy of relevant.topperCopies) {
      const label = copy.year ? String(copy.year) : "N/A";
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);
}

function cleanTopic(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function uniqueTopics(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = cleanTopic(value);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function pdfStatusLabel() {
  return "Source page pending";
}

function matchStatusLabel(matchType: string, confidence: number) {
  if (["direct", "exact"].includes(matchType)) return "Direct";
  if (["strong", "high-confidence"].includes(matchType)) return "Strong";
  if (matchType === "topic-match") return `Topic match ${Math.round(confidence * 100)}%`;
  if (matchType === "loose-topic-match") return `Loose topic ${Math.round(confidence * 100)}%`;
  return `Topic match ${Math.round(confidence * 100)}%`;
}

function highlightQuestion(question: string, keywords: string[]) {
  const usable = keywords
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length >= 4)
    .sort((a, b) => b.length - a.length)
    .slice(0, 6);

  if (usable.length === 0) return question;

  const pattern = new RegExp(`(${usable.map(escapeRegex).join("|")})`, "gi");
  return question.split(pattern).map((part, index) => {
    const matched = usable.some((keyword) => keyword.toLowerCase() === part.toLowerCase());
    return matched ? <mark key={`${part}-${index}`} className="keyword-mark">{part}</mark> : <span key={`${part}-${index}`}>{part}</span>;
  });
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
