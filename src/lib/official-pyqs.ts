import { readFileSync } from "fs";
import { join } from "path";
import type { SubjectPyqCard } from "./search-results";
import { bestTokenMatchScore, matchesSearchTerm, normalizeSearchText, searchTerms, searchTokens } from "./search-text";

interface OfficialRow {
  id: string;
  subjectKey: string;
  question: string;
  paper: string;
  category: string;
  year: number | null;
  marks: number | null;
  syllabusTags: string[];
  keywords: string[];
}

let cachedRows: OfficialRow[] | null = null;
let cachedOfficialLinks: OfficialLinkDataset | null = null;

const PYQ_DIR = join(process.cwd(), "PYQS");
const OFFICIAL_LINK_FILE = join(process.cwd(), "data", "app", "public-official-pyq-links.json");

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

interface RelevantQuestionGroup {
  key: string;
  bestLink: OfficialAnswerLink;
  sourceAvailableCount: number;
  topperCopies: NonNullable<SubjectPyqCard["relevantQuestions"]>[number]["topperCopies"];
}

export function getOfficialSubjectPyqs(subjectKey: string, query = "", limit = 120, syllabus = ""): SubjectPyqCard[] {
  const terms = searchTerms(query);
  const syllabusTerms = searchTerms(syllabus);
  return loadOfficialRows()
    .filter((row) => row.subjectKey === subjectKey)
    .filter((row) => matchesSyllabus(row, syllabusTerms))
    .map((row) => ({ row, rank: terms.length ? rankOfficialRow(row, terms, query) : defaultOfficialRowRank() }))
    .filter((entry) => entry.rank.score > 0)
    .sort(compareOfficialRowSearchResults)
    .slice(0, limit)
    .map((entry) => toOfficialCard(entry.row));
}

export function getOfficialSubjectPyqShells(subjectKey: string, query = "", limit = 120, syllabus = ""): SubjectPyqCard[] {
  const terms = searchTerms(query);
  const syllabusTerms = searchTerms(syllabus);
  return loadOfficialRows()
    .filter((row) => row.subjectKey === subjectKey)
    .filter((row) => matchesSyllabus(row, syllabusTerms))
    .map((row) => ({ row, rank: terms.length ? rankOfficialRow(row, terms, query) : defaultOfficialRowRank() }))
    .filter((entry) => entry.rank.score > 0)
    .sort(compareOfficialRowSearchResults)
    .slice(0, limit)
    .map((entry) => toOfficialShell(entry.row));
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
  ];

  return cachedRows;
}

function toOfficialCard(row: OfficialRow): SubjectPyqCard {
  const links = (loadOfficialLinkDataset().links?.[row.id] || [])
    .filter(isPublishableLink);
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
  const links = (loadOfficialLinkDataset().links?.[row.id] || []).filter(isPublishableLink);
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

function summarizeRelevantLinks(links: OfficialAnswerLink[]) {
  const groupKeys = new Set<string>();
  for (const link of links) groupKeys.add(`${link.cardId}|${link.extractedQuestion}`);
  return {
    topperCount: links.length,
    relevantQuestionCount: groupKeys.size,
  };
}

function isPublishableLink(link: OfficialAnswerLink) {
  if (["direct", "exact"].includes(link.matchType)) return true;
  if (["strong", "high-confidence"].includes(link.matchType) && link.matchConfidence >= 0.68) return true;
  if (["topic-match", "loose-topic-match", "reasoned"].includes(link.matchType) && link.matchConfidence >= 0.3) return true;
  return false;
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
    .map((link) => ({
      answerId: link.topperAnswerId,
      sourceAvailable: hasUsableSource(link),
      sourceStatus: link.sourceStatus,
      topperName: displayTopperName(link.topperName),
      nameStatus: link.nameStatus || (link.topperName === "Anonymous topper" ? "anonymous" : "filename"),
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
    }));

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

function displayTopperName(value: string) {
  const legacyPlaceholder = ["Mapped", "topper"].join(" ");
  return value && value !== legacyPlaceholder && value !== "Unknown topper" ? value : "Anonymous topper";
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

    rows.push({
      id: duplicateCount ? `${baseId}_${duplicateCount + 1}` : baseId,
      subjectKey: `gs${paperNumber}`,
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

function compareOfficialRowSearchResults(
  left: { row: OfficialRow; rank: OfficialRowSearchRank },
  right: { row: OfficialRow; rank: OfficialRowSearchRank },
) {
  return Number(right.rank.exactQuestionPhraseHit) - Number(left.rank.exactQuestionPhraseHit)
    || Number(right.rank.allTermsInQuestion) - Number(left.rank.allTermsInQuestion)
    || right.rank.questionTermHits - left.rank.questionTermHits
    || right.rank.score - left.rank.score
    || (right.row.year || 0) - (left.row.year || 0);
}

function matchesSyllabus(row: OfficialRow, terms: string[]) {
  if (terms.length === 0) return true;
  const haystack = [row.syllabusTags.join(" "), row.keywords.join(" ")].join(" ").toLowerCase();
  const tokens = searchTokens(haystack);
  return terms.some((term) => matchesSearchTerm(term, haystack, tokens));
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
  rankOfficialRow,
  compareOfficialRowSearchResults,
};
