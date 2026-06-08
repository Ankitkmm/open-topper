import { readFileSync } from "fs";
import { join } from "path";
import { PUBLIC_TOPPER_NAME_FALLBACK, normalizePublicTopperName } from "./public-records";
import type { SubjectPyqCard } from "./search-results";
import { bestTokenMatchScore, matchesSearchTerm, normalizeSearchText, searchTerms, searchTokens } from "./search-text";
import { getSubjectDefinition, getSubjectKeyFromValue, type SubjectKey } from "./subject-definitions";

interface OfficialWorkspaceCopy {
  answerId: string;
  topperName: string | null;
  rank: number | null;
  year: number | null;
  institute: string | null;
  marks: string | null;
  pageHint: number | null;
  pageStatus: "valid" | "missing" | "fallback" | "out_of_range" | null;
  sourceAvailable: boolean;
  sourceStatus: string | null;
  summary: string;
  summaryAvailable: boolean;
  summarySource: string | null;
}

interface OfficialWorkspaceQuestion {
  id: string;
  question: string;
  paper: string;
  category: string;
  subjectKey: SubjectKey;
  subjectLabel: string;
  estimatedYear: number | null;
  marks: number | null;
  syllabusNodeId: string;
  syllabusPath: string[];
  linkedInsights: OfficialWorkspaceCopy[];
  topperCount: number;
  searchText?: string;
}

interface WorkspaceSnapshot {
  questions?: OfficialWorkspaceQuestion[];
}

export interface OfficialRow {
  id: string;
  subjectKey: SubjectKey;
  question: string;
  paper: string;
  category: string;
  year: number | null;
  marks: number | null;
  syllabusTags: string[];
  keywords: string[];
  sourceQuestionId?: string;
  sourceKind?: "upsc-official" | "workspace-optional-fallback";
  workspaceQuestion?: OfficialWorkspaceQuestion;
}

let cachedRows: OfficialRow[] | null = null;
let cachedOfficialLinks: OfficialLinkDataset | null = null;
let cachedWorkspaceSnapshot: WorkspaceSnapshot | null = null;

const PYQ_DIR = join(process.cwd(), "PYQS");
const OFFICIAL_LINK_FILE = join(process.cwd(), "data", "app", "public-official-pyq-links.json");
const WORKSPACE_INDEX_FILE = join(process.cwd(), "data", "app", "workspace-index.json");

const OPTIONAL_OFFICIAL_SUBJECTS: SubjectKey[] = [
  "geography",
  "sociology",
  "psir",
  "public-administration",
  "anthropology",
  "history",
];

const ESSAY_PROMPT_MARKER = /\bQ\.?\s*\d{1,2}[A-Za-z]?\b|(?<![A-Za-z0-9])\d{1,2}\s*[.)\]:-]/gi;

interface OfficialAnswerLink {
  officialQuestionId?: string;
  topperAnswerId: string;
  cardId: string;
  matchType: string;
  matchConfidence: number;
  matchReason?: string;
  extractedQuestion: string;
  paper?: string;
  category?: string;
  syllabusTags?: string[];
  keywords?: string[];
  topperName: string;
  nameStatus?: string;
  rank: number | null;
  year: number | null;
  institute: string | null;
  marksObtained?: string | null;
  sourceAvailable: boolean;
  sourceStatus: string;
  pageNormalized: number | null;
  pageStatus: "valid" | "missing" | "fallback" | "out_of_range";
  summary: string;
  summaryStatus?: string;
  valueAdds: string[];
}

interface OfficialLinkDataset {
  links?: Record<string, OfficialAnswerLink[]>;
}

interface OfficialRowSearchRank {
  score: number;
  exactQuestionPhraseHit: boolean;
  allTermsInQuestion: boolean;
  questionTermHits: number;
  syllabusTermHits: number;
  keywordTermHits: number;
}

interface OfficialTopicMatchRank {
  hasFilter: boolean;
  score: number;
  exactPhraseHit: boolean;
  allTermsMatched: boolean;
  matchedTermCount: number;
  meaningfulTermCount: number;
}

interface RelevantQuestionGroup {
  key: string;
  bestLink: OfficialAnswerLink;
  sourceAvailableCount: number;
  topperCopies: NonNullable<SubjectPyqCard["relevantQuestions"]>[number]["topperCopies"];
}

const OFFICIAL_TOPIC_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "upsc",
  "general",
  "studies",
  "paper",
  "optional",
  "topic",
  "topics",
  "section",
  "part",
]);

const OPTIONAL_QUESTION_DIRECTIVES = new Set([
  "account",
  "analyse",
  "analyze",
  "assess",
  "bring",
  "comment",
  "compare",
  "contrast",
  "critically",
  "define",
  "describe",
  "discuss",
  "distinguish",
  "elaborate",
  "elucidate",
  "enumerate",
  "evaluate",
  "examine",
  "explain",
  "highlight",
  "how",
  "illustrate",
  "justify",
  "review",
  "trace",
  "what",
  "why",
  "write",
]);

const ESSAY_PROMPT_NOISE = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "been",
  "being",
  "by",
  "choose",
  "choosing",
  "each",
  "essay",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "of",
  "one",
  "or",
  "section",
  "the",
  "to",
  "topic",
  "two",
  "we",
  "what",
  "with",
  "words",
  "write",
]);

export function getOfficialSubjectPyqs(subjectKey: string, query = "", limit = 120, syllabus = ""): SubjectPyqCard[] {
  return getRankedOfficialSubjectRows(subjectKey, query, limit, syllabus).map((entry) => toOfficialCard(entry.row));
}

export function getOfficialSubjectPyqShells(subjectKey: string, query = "", limit = 120, syllabus = ""): SubjectPyqCard[] {
  return getRankedOfficialSubjectRows(subjectKey, query, limit, syllabus).map((entry) => toOfficialShell(entry.row));
}

function getRankedOfficialSubjectRows(subjectKey: string, query = "", limit = 120, syllabus = "") {
  const terms = searchTerms(query);
  const normalizedSyllabus = cleanText(syllabus);
  const hasTopicFilter = Boolean(normalizedSyllabus);
  return loadOfficialRows()
    .filter((row) => row.subjectKey === subjectKey)
    .map((row) => ({
      row,
      rank: terms.length ? rankOfficialRow(row, terms, query) : defaultOfficialRowRank(),
      topicRank: hasTopicFilter ? rankOfficialTopicMatch(row, normalizedSyllabus) : defaultOfficialTopicMatchRank(),
    }))
    .filter((entry) => !hasTopicFilter || entry.topicRank.score > 0)
    .filter((entry) => entry.rank.score > 0)
    .sort((left, right) => hasTopicFilter
      ? compareOfficialTopicFilteredResults(left, right)
      : compareOfficialRowSearchResults(left, right))
    .slice(0, limit)
}

export function getOfficialQuestionDetail(questionId: string) {
  const row = loadOfficialRows().find((item) => item.id === questionId);
  return row ? toOfficialCard(row) : null;
}

export function getOfficialQuestionShell(questionId: string) {
  const row = loadOfficialRows().find((item) => item.id === questionId);
  return row ? toOfficialShell(row) : null;
}

export function getOfficialBrowsePyqs(
  query = "",
  category = "",
  keyword = "",
  limit = 240,
): SubjectPyqCard[] {
  const terms = searchTerms(query);
  const cat = category.trim().toLowerCase();
  const kw = keyword.trim().toLowerCase();

  return loadOfficialRows()
    .filter((row) => !cat || cat === "all" || row.category.toLowerCase() === cat || row.subjectKey === cat)
    .filter((row) => !kw || row.keywords.some((item) => item.toLowerCase().includes(kw)))
    .map((row) => ({ row, rank: terms.length ? rankOfficialRow(row, terms, query) : defaultOfficialRowRank() }))
    .filter((entry) => entry.rank.score > 0)
    .sort(compareOfficialRowSearchResults)
    .slice(0, limit)
    .map((entry) => toOfficialShell(entry.row));
}

export function getOfficialPyqStats() {
  const rows = loadOfficialRows();
  const cards = rows.map(toOfficialShell);
  const categories = new Map<string, number>();
  let linkedCopies = 0;

  for (const card of cards) {
    categories.set(card.category, (categories.get(card.category) || 0) + 1);
    linkedCopies += card.topperCount;
  }

  return {
    totalQuestions: rows.length,
    linkedCopies,
    categories: [...categories.entries()].map(([name, count]) => ({ name, count })),
  };
}

export function loadOfficialRows(): OfficialRow[] {
  if (cachedRows) return cachedRows;

  cachedRows = [
    ...parseGs123(),
    ...parseGs4(),
    ...parseEssay(),
    ...parseOptionalWorkspaceOfficialRows(),
  ];

  return cachedRows;
}

function toOfficialCard(row: OfficialRow): SubjectPyqCard {
  const links = getPublishableLinksForRow(row);
  const relevantQuestions = groupRelevantQuestions(links);
  const topperCount = relevantQuestions.reduce((sum, relevant) => sum + relevant.topperCopies.length, 0);

  return {
    id: row.id,
    subjectKey: row.subjectKey,
    question: withQuestionMarks(row.question, row.marks),
    paper: row.paper,
    category: row.category,
    estimatedYear: row.year,
    marks: row.marks,
    syllabusTags: row.syllabusTags,
    keywords: row.keywords,
    topperCount,
    relevantQuestionCount: relevantQuestions.length,
    relevantQuestions,
  };
}

function toOfficialShell(row: OfficialRow): SubjectPyqCard {
  const links = getPublishableLinksForRow(row);
  const counts = summarizeRelevantLinks(links);

  return {
    id: row.id,
    subjectKey: row.subjectKey,
    question: withQuestionMarks(row.question, row.marks),
    paper: row.paper,
    category: row.category,
    estimatedYear: row.year,
    marks: row.marks,
    syllabusTags: row.syllabusTags,
    keywords: row.keywords,
    topperCount: counts.topperCount,
    relevantQuestionCount: counts.relevantQuestionCount,
    relevantQuestions: [],
  };
}

function getPublishableLinksForRow(row: OfficialRow) {
  const publicLinks = (loadOfficialLinkDataset().links?.[row.id] || [])
    .map((link) => normalizeOfficialAnswerLink(row, link))
    .filter((link): link is OfficialAnswerLink => Boolean(link))
    .filter((link) => isPublishableLink(row, link));

  const workspaceLinks = workspaceLinksForOptionalRow(row)
    .map((link) => normalizeOfficialAnswerLink(row, link))
    .filter((link): link is OfficialAnswerLink => Boolean(link))
    .filter((link) => isPublishableLink(row, link));

  return dedupeOfficialLinks([...publicLinks, ...workspaceLinks]);
}

function normalizeOfficialAnswerLink(row: OfficialRow, link: OfficialAnswerLink): OfficialAnswerLink | null {
  if (!isLinkSubjectCompatible(row, link)) return null;

  if (row.subjectKey !== "essay") return link;

  const matchedPrompt = extractMatchedEssayPrompt(row.question, link.extractedQuestion);
  if (!matchedPrompt) return null;

  const exact = normalizeEssayPromptForMatch(row.question) === normalizeEssayPromptForMatch(matchedPrompt);
  return {
    ...link,
    extractedQuestion: matchedPrompt,
    matchType: exact ? "direct" : "strong",
    matchConfidence: Math.max(link.matchConfidence, exact ? 1 : 0.86),
    matchReason: exact
      ? "Exact essay prompt match."
      : "Near-exact essay prompt match after prompt extraction.",
  };
}

function dedupeOfficialLinks(links: OfficialAnswerLink[]) {
  const seen = new Set<string>();
  const out: OfficialAnswerLink[] = [];

  for (const link of links.sort(compareOfficialLinksForDedupe)) {
    const key = [
      link.topperAnswerId,
      link.cardId,
      normalizeEssayPromptForMatch(link.extractedQuestion) || normalizeSearchText(link.extractedQuestion),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
  }

  return out;
}

function compareOfficialLinksForDedupe(left: OfficialAnswerLink, right: OfficialAnswerLink) {
  return relevantQuestionMatchTypeWeight(right.matchType) - relevantQuestionMatchTypeWeight(left.matchType)
    || right.matchConfidence - left.matchConfidence
    || Number(hasUsableSource(right)) - Number(hasUsableSource(left));
}

function summarizeRelevantLinks(links: OfficialAnswerLink[]) {
  const groupKeys = new Set<string>();
  for (const link of links) groupKeys.add(`${link.cardId}|${link.extractedQuestion}`);
  return {
    topperCount: links.length,
    relevantQuestionCount: groupKeys.size,
  };
}

function isPublishableLink(row: OfficialRow, link: OfficialAnswerLink) {
  if (!isLinkSubjectCompatible(row, link)) return false;

  if (row.subjectKey === "essay") {
    return Boolean(extractMatchedEssayPrompt(row.question, link.extractedQuestion))
      && ["direct", "exact", "strong", "high-confidence"].includes(link.matchType)
      && link.matchConfidence >= 0.84;
  }

  if (["direct", "exact"].includes(link.matchType)) return true;
  if (["strong", "high-confidence"].includes(link.matchType) && link.matchConfidence >= 0.68) return true;
  if (["topic-match", "loose-topic-match", "reasoned"].includes(link.matchType) && link.matchConfidence >= 0.3) return true;
  return false;
}

function isLinkSubjectCompatible(row: OfficialRow, link: OfficialAnswerLink) {
  const linkSubject = inferLinkSubjectKey(link);

  if (linkSubject) return linkSubject === row.subjectKey;

  // Essay false positives are especially damaging because generic prompt cards
  // often contain many unrelated topic words. If a link cannot prove it is Essay,
  // do not publish it under an Essay prompt.
  if (row.subjectKey === "essay") return false;

  return true;
}

function inferLinkSubjectKey(link: OfficialAnswerLink) {
  for (const value of [link.paper, link.category]) {
    const subjectKey = getSubjectKeyFromValue(value || "");
    if (subjectKey) return subjectKey;
  }
  return null;
}

function workspaceLinksForOptionalRow(row: OfficialRow): OfficialAnswerLink[] {
  const question = row.workspaceQuestion;
  if (!question || !OPTIONAL_OFFICIAL_SUBJECTS.includes(row.subjectKey)) return [];

  return question.linkedInsights.map((copy) => ({
    officialQuestionId: row.id,
    topperAnswerId: copy.answerId,
    cardId: question.id,
    matchType: "direct",
    matchConfidence: 1,
    matchReason: "Direct subject-scoped optional PYQ row from the curated optional workspace.",
    extractedQuestion: row.question,
    paper: row.paper,
    category: row.category,
    syllabusTags: row.syllabusTags,
    keywords: row.keywords,
    topperName: copy.topperName || "Anonymous topper",
    nameStatus: copy.topperName ? "filename" : "anonymous",
    rank: copy.rank,
    year: copy.year,
    institute: copy.institute,
    marksObtained: copy.marks,
    sourceAvailable: copy.sourceAvailable,
    sourceStatus: copy.sourceStatus || (copy.sourceAvailable ? "available" : "not_uploaded"),
    pageNormalized: copy.pageHint,
    pageStatus: copy.pageStatus || (copy.pageHint ? "valid" : "missing"),
    summary: copy.summary || "",
    summaryStatus: copy.summaryAvailable ? "available" : "missing",
    valueAdds: [],
  }));
}

function groupRelevantQuestions(links: OfficialAnswerLink[]): SubjectPyqCard["relevantQuestions"] {
  const groups = new Map<string, OfficialAnswerLink[]>();

  for (const link of links) {
    const key = `${link.cardId}|${link.extractedQuestion}`;
    const bucket = groups.get(key) || [];
    bucket.push(link);
    groups.set(key, bucket);
  }

  return [...groups.entries()]
    .map(([key, group]) => buildRelevantQuestionGroup(key, group))
    .sort(compareRelevantQuestionGroups)
    .map(({ key, bestLink, sourceAvailableCount, topperCopies }) => ({
      id: key.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 160),
      question: bestLink.extractedQuestion,
      paper: bestLink.paper || "",
      category: bestLink.category || "",
      syllabusTags: bestLink.syllabusTags || [],
      keywords: bestLink.keywords || [],
      matchType: bestLink.matchType,
      matchConfidence: bestLink.matchConfidence,
      matchReason: bestLink.matchReason || matchLabel(bestLink.matchType, bestLink.matchConfidence),
      reviewStatus: "published" as const,
      topperCount: topperCopies.length,
      sourceAvailableCount,
      topperCopies,
    }));
}

function buildRelevantQuestionGroup(key: string, group: OfficialAnswerLink[]): RelevantQuestionGroup {
  const bestLink = group.slice().sort(compareRelevantQuestionBestLinks)[0];
  const topperCopies = group
    .slice()
    .sort(compareTopperCopies)
    .map((link) => {
      const resolvedName = normalizePublicTopperName(link.topperName);
      return {
        answerId: link.topperAnswerId,
        sourceAvailable: hasUsableSource(link),
        sourceStatus: link.sourceStatus,
        topperName: resolvedName ?? PUBLIC_TOPPER_NAME_FALLBACK,
        nameStatus: resolvedName ? (link.nameStatus && link.nameStatus !== "anonymous" ? link.nameStatus : "filename") : "anonymous",
        rank: link.rank,
        year: link.year,
        institute: link.institute,
        marks: link.marksObtained || null,
        pageHint: link.pageNormalized || null,
        pageStatus: link.pageStatus,
        interpretation: usefulSummary(link.summary, link.summaryStatus) ? link.summary : "",
        summaryStatus: usefulSummary(link.summary, link.summaryStatus) ? "available" : (link.summaryStatus === "too_thin" ? "too_thin" : "missing"),
        valueAdds: link.valueAdds || [],
        matchType: link.matchType,
        matchConfidence: link.matchConfidence,
        matchedQuestion: link.extractedQuestion,
      };
    });

  return {
    key,
    bestLink,
    sourceAvailableCount: topperCopies.filter((copy) => copy.sourceAvailable).length,
    topperCopies,
  };
}

function compareRelevantQuestionGroups(left: RelevantQuestionGroup, right: RelevantQuestionGroup) {
  return right.sourceAvailableCount - left.sourceAvailableCount
    || compareRelevantQuestionBestLinks(left.bestLink, right.bestLink)
    || right.topperCopies.length - left.topperCopies.length;
}

function compareRelevantQuestionBestLinks(left: OfficialAnswerLink, right: OfficialAnswerLink) {
  return relevantQuestionMatchTypeWeight(right.matchType) - relevantQuestionMatchTypeWeight(left.matchType)
    || right.matchConfidence - left.matchConfidence
    || Number(hasUsableSource(right)) - Number(hasUsableSource(left))
    || Number(right.sourceAvailable) - Number(left.sourceAvailable)
    || compareNullableNumber(left.rank, right.rank, "asc")
    || compareNullableNumber(right.year, left.year, "asc");
}

function compareTopperCopies(left: OfficialAnswerLink, right: OfficialAnswerLink) {
  return Number(hasUsableSource(right)) - Number(hasUsableSource(left))
    || right.matchConfidence - left.matchConfidence
    || relevantQuestionMatchTypeWeight(right.matchType) - relevantQuestionMatchTypeWeight(left.matchType);
}

function hasUsableSource(link: Pick<OfficialAnswerLink, "sourceAvailable" | "pageNormalized" | "pageStatus">) {
  return link.sourceAvailable && Boolean(link.pageNormalized) && ["valid", "fallback"].includes(link.pageStatus);
}

function relevantQuestionMatchTypeWeight(matchType: string) {
  if (["direct", "exact"].includes(matchType)) return 4;
  if (["strong", "high-confidence"].includes(matchType)) return 3;
  if (["topic-match", "reasoned"].includes(matchType)) return 2;
  if (matchType === "loose-topic-match") return 1;
  return 0;
}

function compareNullableNumber(left: number | null, right: number | null, direction: "asc" | "desc") {
  const leftValue = left ?? (direction === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
  const rightValue = right ?? (direction === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
  return direction === "asc" ? leftValue - rightValue : rightValue - leftValue;
}

function matchLabel(matchType: string, confidence: number) {
  if (["direct", "exact"].includes(matchType)) return "Direct extracted question match.";
  if (["strong", "high-confidence"].includes(matchType)) return `Strong text match (${Math.round(confidence * 100)}%).`;
  if (matchType === "topic-match") return `Same syllabus/topic match (${Math.round(confidence * 100)}%).`;
  return `Loose topic match (${Math.round(confidence * 100)}%).`;
}

function usefulSummary(summary: string, status?: string) {
  if ((status || "") !== "available") return false;
  const clean = cleanText(summary);
  if (!clean) return false;
  return clean.split(/\s+/).length >= 22 || clean.length >= 160;
}

function loadOfficialLinkDataset() {
  if (cachedOfficialLinks) return cachedOfficialLinks;
  try {
    cachedOfficialLinks = JSON.parse(readFileSync(OFFICIAL_LINK_FILE, "utf-8")) as OfficialLinkDataset;
  } catch {
    cachedOfficialLinks = {};
  }
  return cachedOfficialLinks;
}

function parseGs123(): OfficialRow[] {
  const rows: OfficialRow[] = [];
  const file = join(PYQ_DIR, "UPSC GS1-GS3 PYQS, topics might be theirs, dont do a 100 match while….md");
  const lines = readFileSync(file, "utf-8").split(/\r?\n/);
  const seenIds = new Map<string, number>();

  for (const [lineIndex, line] of lines.entries()) {
    if (!/^\d{4}\t/.test(line)) continue;
    const [yearRaw, paperRaw, numberRaw, areaRaw, questionRaw, tagsRaw = ""] = line.split("\t");
    const paperNumber = Number(paperRaw);
    if (![1, 2, 3].includes(paperNumber)) continue;

    const number = parseInt(numberRaw, 10);
    const keywords = cleanList(tagsRaw);
    const area = cleanText(areaRaw);
    if (area) keywords.unshift(area);
    const numberSlug = numberRaw && numberRaw !== "undefined" ? slug(numberRaw) : `row_${lineIndex + 1}`;
    const baseId = `official_gs${paperNumber}_${yearRaw}_${numberSlug}`;
    const duplicateCount = seenIds.get(baseId) || 0;
    seenIds.set(baseId, duplicateCount + 1);

    const subjectKey = `gs${paperNumber}` as SubjectKey;

    rows.push({
      id: duplicateCount ? `${baseId}_${duplicateCount + 1}` : baseId,
      subjectKey,
      question: cleanText(questionRaw),
      paper: `GS-${paperNumber}`,
      category: `GS ${paperNumber}`,
      year: toYear(yearRaw),
      marks: Number.isFinite(number) ? (number <= 10 ? 10 : 15) : null,
      syllabusTags: area ? [area] : [],
      keywords: uniqueClean(keywords),
    });
  }

  return rows;
}

function parseGs4(): OfficialRow[] {
  const rows: OfficialRow[] = [];
  const file = join(PYQ_DIR, "UPSC GS4, PYQS,  summaries topics might be theirs, dont do a 100 match….md");
  const lines = readFileSync(file, "utf-8").split(/\r?\n/);

  for (const line of lines) {
    if (!/^\d{4}\t/.test(line)) continue;
    const [yearRaw, sectionRaw, numberRaw, questionRaw, tagsRaw = "", marksRaw = ""] = line.split("\t");
    const question = cleanText(questionRaw);
    if (!question) continue;

    const section = cleanText(sectionRaw);
    const tags = cleanList(tagsRaw);
    if (section) tags.unshift(section);

    rows.push({
      id: `official_gs4_${yearRaw}_${slug(numberRaw)}`,
      subjectKey: "gs4",
      question,
      paper: "GS-4",
      category: "GS 4",
      year: toYear(yearRaw),
      marks: parseInt(marksRaw, 10) || null,
      syllabusTags: section ? [section] : [],
      keywords: uniqueClean(tags),
    });
  }

  return rows;
}

function parseEssay(): OfficialRow[] {
  const rows: OfficialRow[] = [];
  const file = join(PYQ_DIR, "UPSC ESSAYS PYQS.md");
  const lines = readFileSync(file, "utf-8").split(/\r?\n/);
  let currentYear: number | null = null;
  let currentTheme = "";
  let count = 0;

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)/);
    if (heading) {
      currentTheme = cleanText(heading[1]);
      continue;
    }

    const year = line.match(/^\*\*(\d{4})\*\*/);
    if (year) {
      currentYear = toYear(year[1]);
      continue;
    }

    const bullet = line.match(/^\*\s+(.+)/);
    if (!bullet) continue;

    const question = cleanText(bullet[1]);
    if (!question) continue;
    count += 1;

    rows.push({
      id: `official_essay_${currentYear || "unknown"}_${count}`,
      subjectKey: "essay",
      question,
      paper: "Essay",
      category: "Essay",
      year: currentYear,
      marks: null,
      syllabusTags: currentTheme ? [currentTheme] : [],
      keywords: currentTheme ? [currentTheme] : ["Essay"],
    });
  }

  return rows;
}

function parseOptionalWorkspaceOfficialRows(): OfficialRow[] {
  const snapshot = loadWorkspaceSnapshot();
  const rows: OfficialRow[] = [];
  const seen = new Map<string, number>();

  for (const question of snapshot.questions || []) {
    if (!OPTIONAL_OFFICIAL_SUBJECTS.includes(question.subjectKey)) continue;

    const questionText = cleanText(question.question);
    if (!isOptionalOfficialQuestionText(questionText)) continue;

    const subject = getSubjectDefinition(question.subjectKey);
    const fingerprint = normalizeOfficialQuestionFingerprint(questionText);
    if (!fingerprint) continue;

    const baseId = `official_${question.subjectKey}_${shortStableHash(fingerprint)}`;
    const duplicateCount = seen.get(baseId) || 0;
    seen.set(baseId, duplicateCount + 1);

    rows.push({
      id: duplicateCount ? `${baseId}_${duplicateCount + 1}` : baseId,
      subjectKey: question.subjectKey,
      question: questionText,
      paper: cleanText(question.paper) || subject.paperLabel,
      category: subject.label,
      year: question.estimatedYear,
      marks: question.marks,
      syllabusTags: uniqueClean(question.syllabusPath || []),
      keywords: uniqueClean([...(question.syllabusPath || []), subject.label]),
      sourceQuestionId: question.id,
      sourceKind: "workspace-optional-fallback",
      workspaceQuestion: question,
    });
  }

  return rows;
}

function loadWorkspaceSnapshot(): WorkspaceSnapshot {
  if (cachedWorkspaceSnapshot) return cachedWorkspaceSnapshot;

  try {
    cachedWorkspaceSnapshot = JSON.parse(readFileSync(WORKSPACE_INDEX_FILE, "utf-8")) as WorkspaceSnapshot;
  } catch {
    cachedWorkspaceSnapshot = { questions: [] };
  }

  return cachedWorkspaceSnapshot;
}

function searchableText(row: OfficialRow) {
  return [
    row.question,
    row.paper,
    row.category,
    row.year,
    row.syllabusTags.join(" "),
    row.keywords.join(" "),
  ].join(" ").toLowerCase();
}

function searchableTokens(row: OfficialRow) {
  return searchTokens(searchableText(row));
}

function defaultOfficialRowRank(): OfficialRowSearchRank {
  return {
    score: 1,
    exactQuestionPhraseHit: false,
    allTermsInQuestion: false,
    questionTermHits: 0,
    syllabusTermHits: 0,
    keywordTermHits: 0,
  };
}

function defaultOfficialTopicMatchRank(): OfficialTopicMatchRank {
  return {
    hasFilter: false,
    score: 0,
    exactPhraseHit: false,
    allTermsMatched: false,
    matchedTermCount: 0,
    meaningfulTermCount: 0,
  };
}

function rankOfficialRow(row: OfficialRow, terms: string[], query = ""): OfficialRowSearchRank {
  if (terms.length === 0) return defaultOfficialRowRank();

  const haystack = searchableText(row);
  const tokens = searchableTokens(row);
  const questionHaystack = normalizeSearchText(row.question);
  const questionTokens = searchTokens(row.question);
  const syllabusHaystack = row.syllabusTags.join(" ").toLowerCase();
  const syllabusTokens = searchTokens(syllabusHaystack);
  const keywordHaystack = row.keywords.join(" ").toLowerCase();
  const keywordTokens = searchTokens(keywordHaystack);
  let baseScore = 0;
  let questionTermHits = 0;
  let syllabusTermHits = 0;
  let keywordTermHits = 0;

  for (const term of terms) {
    if (!matchesSearchTerm(term, haystack, tokens)) {
      return { ...defaultOfficialRowRank(), score: 0 };
    }

    baseScore += bestTokenMatchScore(term, tokens);
    if (matchesSearchTerm(term, questionHaystack, questionTokens)) questionTermHits += 1;
    if (matchesSearchTerm(term, syllabusHaystack, syllabusTokens)) syllabusTermHits += 1;
    if (matchesSearchTerm(term, keywordHaystack, keywordTokens)) keywordTermHits += 1;
  }

  const normalizedQuery = normalizeSearchText(query);
  const exactQuestionPhraseHit = Boolean(normalizedQuery) && questionHaystack.includes(normalizedQuery);
  const allTermsInQuestion = questionTermHits === terms.length;

  return {
    score: baseScore / terms.length
      + (exactQuestionPhraseHit ? 1.4 : 0)
      + (allTermsInQuestion ? 0.9 : 0)
      + (questionTermHits / terms.length) * 0.75
      + (syllabusTermHits / terms.length) * 0.18
      + (keywordTermHits / terms.length) * 0.08,
    exactQuestionPhraseHit,
    allTermsInQuestion,
    questionTermHits,
    syllabusTermHits,
    keywordTermHits,
  };
}

function rankOfficialTopicMatch(row: OfficialRow, syllabus = ""): OfficialTopicMatchRank {
  const normalizedSyllabus = normalizeSearchText(syllabus);
  const meaningfulTerms = meaningfulTopicTerms(syllabus);
  if (!normalizedSyllabus && meaningfulTerms.length === 0) return defaultOfficialTopicMatchRank();

  const topicFields = [...row.syllabusTags, ...row.keywords]
    .map((value) => normalizeSearchText(value))
    .filter(Boolean);
  const topicFieldTermSet = new Set(
    [...row.syllabusTags, ...row.keywords]
      .flatMap((value) => meaningfulTopicTerms(value)),
  );

  if (!topicFields.length) {
    return {
      hasFilter: true,
      score: 0,
      exactPhraseHit: false,
      allTermsMatched: false,
      matchedTermCount: 0,
      meaningfulTermCount: meaningfulTerms.length,
    };
  }

  const exactPhraseHit = Boolean(normalizedSyllabus) && topicFields.some((value) => value.includes(normalizedSyllabus));
  const matchedTerms = meaningfulTerms.filter((term) => topicFieldTermSet.has(term));
  const matchedTermCount = matchedTerms.length;
  const allTermsMatched = meaningfulTerms.length > 0 && matchedTermCount === meaningfulTerms.length;
  const coverage = meaningfulTerms.length > 0 ? matchedTermCount / meaningfulTerms.length : 0;

  return {
    hasFilter: true,
    score: exactPhraseHit
      ? 4 + coverage
      : allTermsMatched
        ? 2 + coverage
        : matchedTermCount > 0
          ? 0.5 + coverage
          : 0,
    exactPhraseHit,
    allTermsMatched,
    matchedTermCount,
    meaningfulTermCount: meaningfulTerms.length,
  };
}

function compareOfficialRowSearchResults(
  left: { row: OfficialRow; rank: OfficialRowSearchRank },
  right: { row: OfficialRow; rank: OfficialRowSearchRank },
) {
  return compareOfficialRowSearchPriority(left, right)
    || (right.row.year || 0) - (left.row.year || 0);
}

function compareOfficialRowSearchPriority(
  left: { row: OfficialRow; rank: OfficialRowSearchRank },
  right: { row: OfficialRow; rank: OfficialRowSearchRank },
) {
  return Number(right.rank.exactQuestionPhraseHit) - Number(left.rank.exactQuestionPhraseHit)
    || Number(right.rank.allTermsInQuestion) - Number(left.rank.allTermsInQuestion)
    || right.rank.questionTermHits - left.rank.questionTermHits
    || right.rank.score - left.rank.score;
}

function compareOfficialTopicFilteredResults(
  left: { row: OfficialRow; rank: OfficialRowSearchRank; topicRank: OfficialTopicMatchRank },
  right: { row: OfficialRow; rank: OfficialRowSearchRank; topicRank: OfficialTopicMatchRank },
) {
  return compareOfficialRowSearchPriority(left, right)
    || Number(right.topicRank.exactPhraseHit) - Number(left.topicRank.exactPhraseHit)
    || Number(right.topicRank.allTermsMatched) - Number(left.topicRank.allTermsMatched)
    || right.topicRank.matchedTermCount - left.topicRank.matchedTermCount
    || right.topicRank.score - left.topicRank.score
    || (right.row.year || 0) - (left.row.year || 0);
}

function meaningfulTopicTerms(value: string) {
  const normalized = normalizeSearchText(value);
  if (!normalized) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const term of searchTokens(normalized)) {
    if (term.length <= 2) continue;
    if (OFFICIAL_TOPIC_STOP_WORDS.has(term)) continue;
    if (seen.has(term)) continue;
    seen.add(term);
    out.push(term);
  }

  return out;
}

function isOptionalOfficialQuestionText(value: string) {
  const clean = cleanText(value);
  if (!clean) return false;
  if (clean.length < 28 || clean.length > 700) return false;
  if (/^(?:na|not mentioned|no diagram|none|null|page\s*\d+|\d+)$/i.test(clean)) return false;

  const alphaCount = (clean.match(/[a-z]/gi) || []).length;
  if (alphaCount < 20) return false;

  const normalized = normalizeSearchText(clean);
  const tokenList = searchTokens(normalized);
  if (tokenList.length < 4) return false;

  const hasQuestionMarker = /^\s*["'“”]?\s*(?:q(?:uestion)?\.?\s*)?\d{1,2}\s*[a-e]?\s*[.)\]:-]/i.test(clean)
    || /^\s*["'“”]?\s*q(?:uestion)?\.?\s*\d{1,2}/i.test(clean);
  const hasMarks = /\b(?:10|15|20|25|30|60)\s*marks?\b/i.test(clean) || /\((?:10|15|20|25|30|60)\s*m(?:arks?)?\)/i.test(clean);
  const hasDirective = tokenList.some((token) => OPTIONAL_QUESTION_DIRECTIVES.has(token));

  if (!hasQuestionMarker && !hasMarks && !hasDirective) return false;

  // Reject answer-note fragments that happen to contain a directive word but are
  // not framed as a PYQ demand.
  if (!hasQuestionMarker && !hasMarks && /^[a-z][a-z\s]{0,60}(?:->|:)/i.test(clean)) return false;

  return true;
}

function normalizeOfficialQuestionFingerprint(value: string) {
  return cleanText(value)
    .toLowerCase()
    .replace(/^\s*["'“”]?\s*q(?:uestion)?\.?\s*\d{0,2}\s*[a-e]?\s*[.)\]:-]?\s*/i, "")
    .replace(/^\s*["'“”]?\s*\d{1,2}\s*[a-e]?\s*[.)\]:-]\s*/i, "")
    .replace(/\([^)]*\b\d{1,3}\s*marks?[^)]*\)/gi, "")
    .replace(/\b\d{1,3}\s*marks?\b/gi, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shortStableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function extractMatchedEssayPrompt(officialPrompt: string, extractedQuestion: string) {
  const officialNormalized = normalizeEssayPromptForMatch(officialPrompt);
  if (!officialNormalized) return "";

  const prompts = extractEssayPromptSegments(extractedQuestion);
  for (const prompt of prompts) {
    if (isNearExactEssayPrompt(officialNormalized, normalizeEssayPromptForMatch(prompt))) {
      return cleanEssayPromptSegment(prompt);
    }
  }

  const whole = cleanEssayPromptSegment(extractedQuestion);
  const wholeNormalized = normalizeEssayPromptForMatch(whole);
  if (isNearExactEssayPrompt(officialNormalized, wholeNormalized)) return whole;

  return "";
}

function extractEssayPromptSegments(value: string) {
  const clean = cleanEssayPromptSegment(value);
  const matches = [...clean.matchAll(ESSAY_PROMPT_MARKER)];
  const prompts: string[] = [];

  if (matches.length > 0) {
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      let start = (match.index || 0) + match[0].length;
      while (start < clean.length && /[\s.):-]/.test(clean[start])) start += 1;
      const end = index + 1 < matches.length ? (matches[index + 1].index || clean.length) : clean.length;
      const prompt = cleanEssayPromptSegment(clean.slice(start, end));
      if (isEssayInstructionSegment(prompt)) continue;
      if (prompt) prompts.push(prompt);
    }
  }

  if (prompts.length === 0 && clean) prompts.push(clean);
  return uniqueClean(prompts);
}

function isNearExactEssayPrompt(officialNormalized: string, candidateNormalized: string) {
  if (!officialNormalized || !candidateNormalized) return false;
  if (officialNormalized === candidateNormalized) return true;

  const officialTokens = essayPromptTokensForMatch(officialNormalized);
  const candidateTokens = essayPromptTokensForMatch(candidateNormalized);
  if (!officialTokens.length || !candidateTokens.length) return false;

  const shared = officialTokens.filter((token) => candidateTokens.includes(token));
  const coverage = shared.length / Math.max(1, officialTokens.length);
  const jaccard = shared.length / Math.max(1, new Set([...officialTokens, ...candidateTokens]).size);
  const lengthRatio = Math.min(officialNormalized.length, candidateNormalized.length)
    / Math.max(officialNormalized.length, candidateNormalized.length);

  if (officialTokens.length <= 2) {
    return coverage === 1 && jaccard >= 0.8 && lengthRatio >= 0.72;
  }

  return coverage >= 0.86 && jaccard >= 0.76 && lengthRatio >= 0.74;
}

function normalizeEssayPromptForMatch(value: string) {
  return cleanEssayPromptSegment(value)
    .toLowerCase()
    .replace(/^\s*(?:section\s+[ab]\s+)?q(?:uestion)?\.?\s*\d+[a-z]?\)?\s*/i, "")
    .replace(/^\s*\d+[a-z]?[.)\]:-]\s*/, "")
    .replace(/\b(?:1000|1200|1500)\s*words?\b/gi, "")
    .replace(/&/g, " and ")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function essayPromptTokensForMatch(normalizedPrompt: string) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const token of normalizedPrompt.split(/\s+/)) {
    if (!token || ESSAY_PROMPT_NOISE.has(token)) continue;
    const normalized = normalizeEssayPromptToken(token);
    if (normalized.length < 2 || ESSAY_PROMPT_NOISE.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

function normalizeEssayPromptToken(token: string) {
  if (["civilisation", "civilization", "civilized", "civilised"].includes(token)) return "civil";
  if (["culture", "cultural"].includes(token)) return "cultur";
  if (["education", "educational"].includes(token)) return "educat";
  if (["equality", "equal", "equity"].includes(token)) return "equal";
  if (["science", "scientific"].includes(token)) return "science";
  if (["society", "social"].includes(token)) return "societ";
  if (token.length > 6 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 7 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 6 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 5 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

function cleanEssayPromptSegment(value: string) {
  return cleanText(value)
    .replace(/^section\s*[-:]\s*[a-z]\s*/i, "")
    .replace(/^\s*(?:write\s+)?(?:one|two)\s+essays?.*?:\s*/i, "")
    .trim();
}

function isEssayInstructionSegment(value: string) {
  return /^(?:to\s+q\b|to\s+\d\b|write\b|choose\b|choosing\b|essay\b|one essay\b|two essays\b)/i.test(value.trim());
}

function withQuestionMarks(question: string, marks: number | null) {
  if (!marks || /\bmarks?\b/i.test(question)) return question;
  return `${question} (${marks} marks)`;
}

function cleanList(value: string) {
  return String(value || "")
    .split(",")
    .map(cleanText)
    .filter(Boolean);
}

function uniqueClean(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const clean = cleanText(value);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }

  return out;
}

function cleanText(value: string) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function toYear(value: string) {
  const year = parseInt(value, 10);
  return Number.isFinite(year) ? year : null;
}

function slug(value: string) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "q";
}

export const __testUtils = {
  groupRelevantQuestions,
  getPublishableLinksForRow,
  filterPublishableLinksForRow(row: OfficialRow, links: OfficialAnswerLink[]) {
    return links
      .map((link) => normalizeOfficialAnswerLink(row, link))
      .filter((link): link is OfficialAnswerLink => Boolean(link))
      .filter((link) => isPublishableLink(row, link));
  },
  extractMatchedEssayPrompt,
  isOptionalOfficialQuestionText,
  rankOfficialRow,
  rankOfficialTopicMatch,
  meaningfulTopicTerms,
  compareOfficialRowSearchResults,
  compareOfficialTopicFilteredResults,
};
