import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  ESSAY_PROMPT_MARKER,
  cleanEssayPromptSegment,
  essayPromptTokensForMatch,
  isEssayInstructionSegment,
  normalizeEssayPromptForMatch,
} from "./essay-normalization";
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
  sourceKind?: "upsc-official" | "optional-official" | "workspace-optional-fallback";
  source?: string;
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

const OPTIONAL_OFFICIAL_SOURCE_FILES: Partial<Record<SubjectKey, string>> = {
  anthropology: "anthropology.md",
  geography: "geography.md",
  history: "history.md",
  psir: "psir.md",
  "public-administration": "public-administration.md",
  sociology: "sociology.md",
};

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

  const optionalRows = parseOptionalOfficialRows();
  const subjectsWithCanonicalOptional = new Set(optionalRows.map((row) => row.subjectKey));

  cachedRows = [
    ...parseGs123(),
    ...parseGs4(),
    ...parseEssay(),
    ...optionalRows,
    ...parseOptionalWorkspaceOfficialRows(subjectsWithCanonicalOptional),
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

function parseOptionalOfficialRows(): OfficialRow[] {
  const rows: OfficialRow[] = [];
  const idCounts = new Map<string, number>();
  const optionalDir = join(PYQ_DIR, "optional");
  // Fingerprint → earliest row index for deduplication (earliest year wins, same year = first occurrence)
  const fingerprintMap = new Map<string, number>();

  for (const subjectKey of OPTIONAL_OFFICIAL_SUBJECTS) {
    const fileName = OPTIONAL_OFFICIAL_SOURCE_FILES[subjectKey];
    if (!fileName) continue;
    const file = join(optionalDir, fileName);
    if (!existsSync(file)) continue;

    const subject = getSubjectDefinition(subjectKey);
    const lines = readFileSync(file, "utf-8").split(/\r?\n/);

    for (const [lineIndex, line] of lines.entries()) {
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      const columns = line.split("\t");
      if (columns.length < 5) continue;

      try {
        const [
          yearRaw,
          paperRaw,
          questionNoRaw,
          topicRaw,
          questionRaw,
          tagsRaw = "",
          marksRaw = "",
          sourceRaw = "",
        ] = columns;

        const year = toYear(yearRaw);
        const paperNumber = parseOptionalPaperNumber(paperRaw);
        const questionNo = cleanText(questionNoRaw);
        const question = cleanOptionalFallbackQuestionText(questionRaw);
        if (!year || !paperNumber || !questionNo || !isOptionalOfficialQuestionText(question)) continue;

        // Deduplicate by fingerprint within the same subject — earliest year wins
        const fingerprint = normalizeOfficialQuestionFingerprint(question);
        if (fingerprint) {
          const fpKey = `${subjectKey}::${fingerprint}`;
          const existingIdx = fingerprintMap.get(fpKey);
          if (existingIdx !== undefined) {
            const existing = rows[existingIdx];
            // Keep the existing row if it has the earlier or same year
            if (existing.year !== null && (year === null || existing.year <= year)) {
              continue;
            }
            // Replace existing row with the earlier-year row
            rows.splice(existingIdx, 1);
            // Adjust indices in fingerprint map for rows after the removed one
            for (const [key, idx] of fingerprintMap.entries()) {
              if (idx > existingIdx) fingerprintMap.set(key, idx - 1);
            }
          }
          fingerprintMap.set(fpKey, rows.length);
        }

        const baseId = `official_${subjectKey}_${year}_p${paperNumber}_${slug(questionNo) || `row_${lineIndex + 1}`}`;
        const duplicateCount = idCounts.get(baseId) || 0;
        idCounts.set(baseId, duplicateCount + 1);

        const topic = cleanText(topicRaw);
        const tags = uniqueClean([
          topic,
          ...cleanList(tagsRaw),
          subject.label,
        ]);
        const marks = parseInt(marksRaw, 10);

        rows.push({
          id: duplicateCount ? `${baseId}_${duplicateCount + 1}` : baseId,
          subjectKey,
          question,
          paper: `Paper ${paperNumber}`,
          category: subject.label,
          year,
          marks: Number.isFinite(marks) ? marks : null,
          syllabusTags: topic ? [topic] : [],
          keywords: tags,
          sourceKind: "optional-official",
          source: cleanText(sourceRaw) || fileName,
        });
      } catch (err) {
        console.warn(`[parseOptionalOfficialRows] Skipping malformed row at ${fileName}:${lineIndex + 1}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
    }
  }

  return rows;
}

function parseOptionalWorkspaceOfficialRows(subjectsWithCanonicalOptional = new Set<SubjectKey>()): OfficialRow[] {
  const snapshot = loadWorkspaceSnapshot();
  const rows: OfficialRow[] = [];
  const seen = new Map<string, number>();

  for (const question of snapshot.questions || []) {
    if (!OPTIONAL_OFFICIAL_SUBJECTS.includes(question.subjectKey)) continue;
    if (subjectsWithCanonicalOptional.has(question.subjectKey)) continue;

    const questionText = cleanOptionalFallbackQuestionText(question.question);
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

function parseOptionalPaperNumber(value: string) {
  const normalized = String(value || "")
    .replace(/\b(?:one|i)\b/gi, "1")
    .replace(/\b(?:two|ii)\b/gi, "2");
  const match = normalized.match(/\b(?:paper|p)?\s*[-:]?\s*([12])\b/i);
  return match ? Number(match[1]) : null;
}

function cleanOptionalFallbackQuestionText(value: string) {
  return cleanOptionalOcrArtifacts(cleanText(value))
    .replace(/^["'“”]+/, "")
    .replace(/["'“”]+$/, "")
    .replace(/^\s*Q\s*Que\b[\s:.)-]*/i, "")
    .replace(/^\s*QQue\b[\s:.)-]*/i, "")
    .replace(/^\s*Q\s+Q(?=\d|\s)/i, "Q")
    .replace(/^\s*Q{2,}(?=\d|\s)/i, "Q")
    .replace(/\s*\(\s*\)\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanOptionalOcrArtifacts(value: string) {
  let clean = value
    .replace(/\b(?:SLPM|PHKM|QP|CSM)[A-Z0-9\-/ ]{0,36}\b/gi, " ")
    .replace(/\[?\s*P\.?\s*T\.?\s*O\.?\s*\]?/gi, " ")
    .replace(/\b(?:SECTION|Gis|wus|ware|wave)\s*[-/]?\s*[AB]\b/gi, " ")
    .replace(/\b(?:10|15|20)\s*[xX]\s*5\s*=\s*50\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const directive = clean.match(
    /\b(?:What|Why|How|Where|Which|Can|Does|Do|Is|Are|Were|Was|Has|Have|Discuss|Explain|Examine|Analyse|Analyze|Comment|Elucidate|Evaluate|Assess|Review|Distinguish|Compare|Contrast|Define|Delineate|Highlight|Identify|Illustrate|Account|Trace|Outline|Justify|Describe|Write|Mention|Give|Support|Clarify|Expand)\b/,
  );
  if (directive?.index && directive.index > 8) {
    const prefix = clean.slice(0, directive.index);
    const suffix = clean.slice(directive.index).trim();
    // Official optional PDFs are bilingual scans. Tesseract often emits a
    // romanized Hindi prefix before the English question. Strip that prefix
    // only when the suffix is a substantial English demand; keep prefixes
    // that contain a real English question mark (letter sequences followed by ?)
    // because they may be part of a translated demand whose English verb appears later.
    // Scattered `?` from Hindi OCR noise (e.g. "28?" or "F?") is not a real question mark.
    const hasRealQuestionInPrefix = /[a-z]{3,}\s*\?/i.test(prefix);
    if (suffix.length >= 28 && !hasRealQuestionInPrefix) {
      clean = suffix;
    }
  }

  // Second pass: detect quoted English phrases preceded by Hindi OCR noise.
  // History papers often have: `Hindi noise "English quoted assertion" English directive.`
  // If a quoted phrase (10+ chars starting with a capital letter) exists and is preceded
  // by gibberish, start from the quote. We require the quote to be followed by a capital
  // letter to avoid anchoring on stray quote marks in Hindi OCR noise.
  // This runs unconditionally because the directive pass may fail when the directive verb
  // is at the very end (suffix too short) or the quote precedes the directive.
  const quoteMatch = clean.match(/[""\u201c]([A-Z][^"""\u201d]{9,})/);
  if (quoteMatch?.index && quoteMatch.index > 5) {
    const prefixBeforeQuote = clean.slice(0, quoteMatch.index).trim();
    // Only strip if the prefix looks like Hindi noise (high proportion of short/gibberish words)
    const prefixWords = prefixBeforeQuote.split(/\s+/);
    const noiseWords = prefixWords.filter((w) => {
      const lower = w.toLowerCase().replace(/[^a-z]/g, "");
      if (!lower || lower.length <= 1) return true;
      // Common short English words that appear in valid prefixes
      if (/^(?:the|and|for|are|but|not|was|has|had|its|can|how|did|who|his|her|our|this|that|with|from|been|have|were|does|what|also|into|such|more|most|than|very|only|just|each|both|some|much|many|they|will)$/i.test(lower)) return false;
      // Short (2-4 char) unknown words are likely noise
      if (lower.length <= 4) return true;
      // No vowels = noise
      if (!/[aeiou]/.test(lower)) return true;
      return false;
    });
    const noiseRatio = prefixWords.length > 0 ? noiseWords.length / prefixWords.length : 0;
    if (noiseRatio > 0.5) {
      const afterQuote = clean.slice(quoteMatch.index);
      if (afterQuote.length >= 28) {
        clean = afterQuote;
      }
    }
  }

  // Third pass: strip remaining romanized Hindi OCR noise.
  // Bilingual UPSC papers produce romanized Hindi fragments (short nonsense words)
  // interspersed with the English question. Remove them.
  clean = stripRomanizedHindiNoise(clean);

  return clean
    .replace(/\s+(?:10|15|20|25|30|50|1s|IS)\s*$/i, "")
    .replace(/\s+([,.;:?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strips romanized Hindi OCR noise from bilingual question text.
 * Tesseract on Hindi+English question papers produces romanized garbage like:
 * "ssa hud ate ot arr veda darite sate FI sts ya aa A pfe-srrenfte aferat"
 * These are short, consonant-heavy, non-English fragments that dilute token scoring.
 *
 * Strategy: find the noise prefix and strip it. We look for the first run of 3+
 * consecutive English-like words — that marks the start of the real question.
 */
function stripRomanizedHindiNoise(value: string): string {
  const words = value.split(/\s+/);
  if (words.length < 4) return value;

  // Known short English words that should never be classified as noise
  const KEEP_SHORT = new Set([
    // 2-char
    "do", "go", "if", "in", "is", "it", "no", "of", "on", "or", "so", "to", "up", "us", "we",
    "an", "as", "at", "be", "by", "he", "me", "my", "ok",
    // 3-char
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "had", "her", "was", "one",
    "our", "out", "has", "his", "how", "its", "may", "new", "now", "old", "see", "way", "who",
    "did", "get", "let", "say", "she", "too", "use", "war", "act", "age", "ago", "aid", "aim",
    "air", "art", "ask", "bad", "ban", "bar", "big", "bit", "box", "bus", "buy", "car", "cut",
    "day", "due", "ear", "eat", "end", "era", "eye", "far", "few", "fit", "fly", "got", "gun",
    "hit", "hot", "ill", "job", "key", "law", "lay", "led", "lie", "lot", "low", "map", "met",
    "mix", "nor", "odd", "oil", "own", "pay", "per", "put", "ran", "raw", "red", "rid", "run",
    "sat", "set", "sir", "sit", "six", "tax", "ten", "top", "try", "two", "van", "via", "won",
    "yet", "yes",
    // 4-char common English
    "also", "army", "back", "been", "best", "body", "both", "came", "case", "city", "come",
    "cold", "coup", "cult", "dark", "deal", "deep", "does", "done", "down", "draw", "each",
    "east", "even", "ever", "face", "fact", "fall", "felt", "find", "fire", "form", "free",
    "from", "full", "fund", "gave", "give", "goal", "gold", "gone", "good", "grew", "grow",
    "gulf", "half", "hall", "hand", "hard", "have", "head", "held", "help", "here", "high",
    "hold", "holy", "home", "hope", "idea", "into", "iron", "just", "keen", "keep", "kept",
    "kill", "kind", "king", "knew", "know", "lack", "laid", "land", "last", "late", "lead",
    "left", "less", "life", "like", "line", "link", "list", "live", "long", "look", "lord",
    "lose", "loss", "lost", "love", "made", "make", "many", "mark", "mass", "mean", "meet",
    "mind", "miss", "mode", "more", "most", "much", "must", "name", "near", "need", "next",
    "nine", "none", "note", "once", "only", "open", "over", "paid", "part", "pass", "past",
    "path", "plan", "play", "plot", "plus", "poet", "poll", "pool", "poor", "port", "post",
    "pull", "push", "race", "rain", "rank", "rare", "rate", "real", "rest", "rice", "rich",
    "rise", "risk", "road", "role", "root", "rose", "rule", "rush", "safe", "said", "salt",
    "same", "sang", "save", "seat", "self", "sell", "send", "sent", "shot", "show", "shut",
    "side", "sign", "site", "size", "sold", "sole", "some", "song", "soon", "sort", "soul",
    "step", "stop", "such", "sure", "take", "talk", "tall", "tell", "term", "test", "text",
    "that", "them", "then", "they", "this", "thus", "till", "time", "tiny", "told", "tone",
    "took", "tool", "town", "tree", "true", "turn", "type", "unit", "upon", "used", "user",
    "vast", "very", "view", "vote", "wage", "wait", "wake", "walk", "wall", "want", "wars",
    "weak", "week", "well", "went", "west", "what", "when", "whom", "wide", "wife", "wild",
    "will", "wind", "wine", "wise", "wish", "with", "wood", "word", "wore", "work", "writ",
    "year", "zero", "zone",
    // Common abbreviations
    "gdp", "usa", "ussr", "wto", "imf", "ngo", "ilo", "uno",
  ]);

  function isEnglishWord(word: string): boolean {
    const lower = word.toLowerCase().replace(/[^a-z]/g, "");
    if (!lower) return false;
    // Question markers like Q5, Q3b, etc. are valid English tokens
    if (/^[Qq]\d{1,2}[a-e]?$/i.test(word)) return true;
    // Numeric or alphanumeric tokens (years, marks) are valid
    if (/^\d+$/.test(word)) return true;
    // Punctuation-bearing words with quotes are likely English context
    if (/[""\u201c\u201d]/.test(word)) return true;
    // Words 5+ chars with common English suffix patterns
    if (lower.length >= 5 && /[aeiou]/.test(lower) && /(?:tion|ment|ness|ence|ance|ical|ious|ated|ting|ally|ible|able|ture|logy|ward|ship|ised|ized|ular|eous|ling|less|like|ful|dom|ist|ism|ive|ory|ary|ery|ant|ent|ous|ing|ity|ble|ize|ise|ess|eth|ern|ial|age|ure|ple)$/.test(lower)) {
      return true;
    }
    // Known short English words
    if (KEEP_SHORT.has(lower)) return true;
    // Words with 5+ chars and reasonable vowel ratio
    if (lower.length >= 5) {
      const vowels = (lower.match(/[aeiou]/g) || []).length;
      const ratio = vowels / lower.length;
      if (ratio >= 0.25 && ratio <= 0.55) return true;
      if (ratio < 0.2 && lower.length <= 8) return false;
    }
    // Short words (2-4 chars) not in English set — likely noise
    if (lower.length <= 4 && !KEEP_SHORT.has(lower)) {
      if (/^[A-Z]{2,5}$/.test(word) && /^(?:CE|AD|BC|EU|UN|US|UK|EIC|INC|VOC|RBI|NDA|UPA|BJP|RSS|INA)$/i.test(word)) {
        return true;
      }
      return false;
    }
    return true;
  }

  // Score each word
  const scored = words.map((word) => ({ word, english: isEnglishWord(word) }));

  // Strategy 1: Find the noise prefix. Look for the first run of 3+ consecutive
  // English words — that marks the start of the real English text.
  let englishRunStart = -1;
  let consecutiveEnglish = 0;
  for (let i = 0; i < scored.length; i++) {
    if (scored[i].english) {
      if (consecutiveEnglish === 0) englishRunStart = i;
      consecutiveEnglish++;
      if (consecutiveEnglish >= 3) {
        // Found a run of 3+ English words. If it starts after some noise, strip the prefix.
        // Require at least 3 noise-prefix words to avoid stripping legitimate short prefixes
        // like "Q5" or "1." from question numbers.
        if (englishRunStart >= 3) {
          const prefixNoise = scored.slice(0, englishRunStart).filter((s) => !s.english).length;
          const prefixTotal = englishRunStart;
          // If the prefix is mostly noise (> 50%), strip it
          if (prefixNoise / prefixTotal > 0.5) {
            const cleaned = words.slice(englishRunStart).join(" ").replace(/\s+/g, " ").trim();
            if (cleaned.length >= 20) return cleaned;
          }
        }
        break;
      }
    } else {
      consecutiveEnglish = 0;
      englishRunStart = -1;
    }
  }

  // Strategy 2: If the overall text has > 30% noise words, filter them out entirely.
  const noiseCount = scored.filter((s) => !s.english).length;
  const englishCount = scored.filter((s) => s.english).length;

  if (noiseCount >= words.length * 0.3 && englishCount > 0) {
    const cleaned = scored
      .filter((s) => s.english)
      .map((s) => s.word)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length >= 20) return cleaned;
  }

  return value;
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
  cleanOptionalFallbackQuestionText,
  isOptionalOfficialQuestionText,
  loadOfficialRows,
  parseOptionalPaperNumber,
  rankOfficialRow,
  rankOfficialTopicMatch,
  meaningfulTopicTerms,
  compareOfficialRowSearchResults,
  compareOfficialTopicFilteredResults,
};
