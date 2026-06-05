import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  loadCanonicalSyllabusIndex,
  normalizeSyllabusText,
  syllabusTokens,
  type SyllabusNode,
} from "./canonical-syllabus";
import {
  SUBJECT_DEFINITIONS,
  type SubjectKey,
  getSubjectDefinition,
  getSubjectDefinitions,
  getSubjectKeyFromValue,
} from "./subject-definitions";
import {
  cleanPublicText,
  isPublishableQuestionText,
  normalizePublicTopperName,
} from "./public-records";
import { bestTokenMatchScore, matchesSearchTerm, searchTerms, searchTokens } from "./search-text";

interface RawInsight {
  answerId: string;
  sourceAvailable?: boolean;
  sourceStatus?: string | null;
  topperName?: string | null;
  nameStatus?: string | null;
  rank?: number | null;
  year?: number | null;
  institute?: string | null;
  marks?: string | number | null;
  pageHint?: number | null;
  pageStatus?: "valid" | "missing" | "fallback" | "out_of_range" | null;
  interpretation?: string | null;
  summaryStatus?: string | null;
  summarySource?: string | null;
  valueAdds?: string[];
}

interface RawCard {
  id: string;
  question: string;
  paper: string;
  category: string;
  estimatedYear: number | null;
  syllabusTags: string[];
  keywords: string[];
  topperCount: number;
  linkedInsights?: RawInsight[];
}

interface RawQuestionFile {
  generatedAt: string;
  count: number;
  cards: RawCard[];
}

interface CanonicalAnswerRecord {
  answerId: string;
  sourceDriveId?: string | null;
  summarySource?: string | null;
  sourceAvailable?: boolean;
  sourceStatus?: string | null;
  pageNormalized?: number | null;
  pageStatus?: "valid" | "missing" | "fallback" | "out_of_range" | null;
  topperName?: string | null;
  rank?: number | null;
  year?: number | null;
  institute?: string | null;
  marksObtained?: string | null;
}

interface OcrSummaryEntry {
  summary?: string;
  driveId?: string;
  source?: string;
}

interface CanonicalAnswerFile {
  records: CanonicalAnswerRecord[];
}

export interface WorkspaceCopy {
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

export interface WorkspaceQuestion {
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
  linkedInsights: WorkspaceCopy[];
  topperCount: number;
  searchText: string;
}

export interface WorkspaceSyllabusNode extends SyllabusNode {
  questionCount: number;
}

interface WorkspaceIndex {
  generatedAt: string;
  questions: WorkspaceQuestion[];
  questionsBySubject: Map<SubjectKey, WorkspaceQuestion[]>;
  syllabusNodesBySubject: Map<SubjectKey, WorkspaceSyllabusNode[]>;
  nodeById: Map<string, WorkspaceSyllabusNode>;
}

interface WorkspaceSnapshot {
  generatedAt: string;
  questions: WorkspaceQuestion[];
  syllabusNodes: WorkspaceSyllabusNode[];
}

const ROOT = process.cwd();
const APP_DATA_DIR = join(ROOT, "data", "app");
const PYQ_FILE = join(APP_DATA_DIR, "public-pyqs.json");
const CANONICAL_ANSWERS_FILE = join(APP_DATA_DIR, "topper-answer-canonical.json");
const OCR_SUMMARY_FILE = join(APP_DATA_DIR, "ocr-summaries.json");
const WORKSPACE_INDEX_FILE = join(APP_DATA_DIR, "workspace-index.json");

const QUESTION_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "into",
  "from",
  "that",
  "this",
  "their",
  "there",
  "have",
  "been",
  "what",
  "which",
  "when",
  "where",
  "would",
  "could",
  "should",
  "discuss",
  "examine",
  "explain",
  "comment",
  "analyse",
  "analyze",
  "critically",
  "evaluate",
  "marks",
  "mark",
  "paper",
  "page",
]);

const SUBJECT_HINT_PATTERNS: Array<{ subjectKey: SubjectKey; patterns: RegExp[] }> = [
  {
    subjectKey: "gs1",
    patterns: [
      /\bfreedom struggle\b/i,
      /\bpost-independence\b/i,
      /\bindian culture\b/i,
      /\bworld physical geography\b/i,
      /\bsalient features of indian society\b/i,
    ],
  },
  {
    subjectKey: "gs2",
    patterns: [
      /\bindian constitution\b/i,
      /\bfederal structure\b/i,
      /\bparliament\b/i,
      /\bjudiciary\b/i,
      /\bgovernment policies\b/i,
      /\bindia and its neighborhood\b/i,
      /\binternational institutions\b/i,
    ],
  },
  {
    subjectKey: "gs3",
    patterns: [
      /\bindian economy\b/i,
      /\bgovernment budgeting\b/i,
      /\binclusive growth\b/i,
      /\bdisaster management\b/i,
      /\binternal security\b/i,
      /\bscience and technology\b/i,
      /\bagriculture\b/i,
    ],
  },
  {
    subjectKey: "gs4",
    patterns: [
      /\bethics\b/i,
      /\bprobity\b/i,
      /\bemotional intelligence\b/i,
      /\bhuman values\b/i,
      /\battitude\b/i,
    ],
  },
  {
    subjectKey: "history",
    patterns: [
      /\benlightenment\b/i,
      /\breformation\b/i,
      /\brenaissance\b/i,
      /\bnapoleon\b/i,
      /\bchartist\b/i,
      /\bwestphalia\b/i,
      /\bmandela\b/i,
      /\bapartheid\b/i,
      /\bbolivar\b/i,
      /\bcrimean\b/i,
      /\botto?man\b/i,
      /\bsoviet\b/i,
      /\bamerican civil war\b/i,
    ],
  },
  {
    subjectKey: "anthropology",
    patterns: [
      /\banthropolog/i,
      /\btribal\b/i,
      /\bcaste studies\b/i,
      /\bdemographic profile\b/i,
      /\bhuman genetics\b/i,
      /\bculture and personality\b/i,
    ],
  },
  {
    subjectKey: "geography",
    patterns: [
      /\bgeomorphology\b/i,
      /\bclimatology\b/i,
      /\boceanography\b/i,
      /\bbiogeography\b/i,
      /\beconomic geography\b/i,
      /\bpopulation and settlement geography\b/i,
      /\bregional planning\b/i,
      /\bphysical geography\b/i,
      /\bhuman geography\b/i,
    ],
  },
  {
    subjectKey: "sociology",
    patterns: [
      /\bsociology\b/i,
      /\bkinship\b/i,
      /\bstratification\b/i,
      /\bsocial structure\b/i,
      /\bsocial change\b/i,
      /\bcaste system\b/i,
      /\btribal communities in india\b/i,
    ],
  },
  {
    subjectKey: "psir",
    patterns: [
      /\bpolitical theory\b/i,
      /\binternational relations\b/i,
      /\bindian government and politics\b/i,
      /\bforeign policy\b/i,
      /\bcomparative politics\b/i,
    ],
  },
  {
    subjectKey: "public-administration",
    patterns: [
      /\bpublic administration\b/i,
      /\badministrative thought\b/i,
      /\badministrative behaviour\b/i,
      /\bindian administration\b/i,
      /\bpersonnel administration\b/i,
      /\baccountability and control\b/i,
    ],
  },
];

let cachedIndex: WorkspaceIndex | null = null;
const TOKEN_CACHE = new Map<string, string[]>();
const TEXT_MATCH_CACHE = new Map<string, number>();
const QUESTION_SEARCH_TOKEN_CACHE = new Map<string, string[]>();

export function getWorkspaceIndex() {
  if (cachedIndex) return cachedIndex;

  const snapshot = readJson<WorkspaceSnapshot | null>(WORKSPACE_INDEX_FILE, null);
  if (snapshot?.questions?.length && snapshot.syllabusNodes?.length) {
    cachedIndex = hydrateWorkspaceIndex(snapshot);
    return cachedIndex;
  }

  cachedIndex = hydrateWorkspaceIndex(buildWorkspaceSnapshot());
  return cachedIndex;
}

export function buildWorkspaceSnapshot(): WorkspaceSnapshot {
  const rawQuestions = readJson<RawQuestionFile>(PYQ_FILE, {
    generatedAt: "",
    count: 0,
    cards: [],
  });
  const answerRecords = readJson<CanonicalAnswerFile>(CANONICAL_ANSWERS_FILE, { records: [] }).records;
  const ocrSummaries = readJson<Record<string, OcrSummaryEntry>>(OCR_SUMMARY_FILE, {});
  const canonical = loadCanonicalSyllabusIndex();

  const answerById = new Map(answerRecords.map((record) => [record.answerId, record]));
  const fallbackNodes = new Map<string, WorkspaceSyllabusNode>();
  const questions: WorkspaceQuestion[] = mergeDuplicateQuestions(rawQuestions.cards
    .map((card) => sanitizeQuestion(card, canonical, answerById, ocrSummaries, fallbackNodes))
    .filter((card): card is WorkspaceQuestion => Boolean(card)));

  const nodeById = new Map<string, WorkspaceSyllabusNode>();
  for (const node of canonical.allNodes) {
    nodeById.set(node.id, { ...node, questionCount: 0 });
  }
  for (const node of fallbackNodes.values()) {
    nodeById.set(node.id, node);
  }

  for (const question of questions) {
    const node = nodeById.get(question.syllabusNodeId);
    if (node) node.questionCount += 1;
    if (node?.parentId) {
      const parent = nodeById.get(node.parentId);
      if (parent) parent.questionCount += 1;
    }
  }

  return {
    generatedAt: rawQuestions.generatedAt,
    questions,
    syllabusNodes: [...nodeById.values()],
  };
}

export function getSubjectWorkspaceQuestions(subjectKey: SubjectKey, query = "", syllabusNodeId = "") {
  const index = getWorkspaceIndex();
  const questions = index.questionsBySubject.get(subjectKey) || [];
  const terms = searchTerms(query);

  return questions.filter((question) => {
    if (syllabusNodeId && question.syllabusNodeId !== syllabusNodeId) return false;
    if (!terms.length) return true;
    return searchScore(question, terms) > 0;
  });
}

export function searchWorkspaceQuestions(options: {
  query?: string;
  subjectKey?: SubjectKey | "";
  syllabusNodeId?: string;
  limit?: number;
}) {
  const { query = "", subjectKey = "", syllabusNodeId = "", limit = 80 } = options;
  const index = getWorkspaceIndex();
  const subjects = subjectKey ? [subjectKey] : getSubjectDefinitions().map((definition) => definition.key);
  const terms = searchTerms(query);

  let matches = subjects.flatMap((key) => index.questionsBySubject.get(key) || []);
  if (syllabusNodeId) matches = matches.filter((question) => question.syllabusNodeId === syllabusNodeId);

  if (!terms.length) return matches.slice(0, limit);

  return matches
    .map((question) => ({ question, score: searchScore(question, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || right.question.topperCount - left.question.topperCount || left.question.question.localeCompare(right.question.question))
    .slice(0, limit)
    .map((entry) => entry.question);
}

export function getWorkspaceSyllabusNodes(subjectKey: SubjectKey) {
  const nodes = getWorkspaceIndex().syllabusNodesBySubject.get(subjectKey) || [];
  const primary = nodes.filter((node) => !node.isFallback);
  return primary.length ? primary : nodes;
}

export function getWorkspaceNode(nodeId: string) {
  return getWorkspaceIndex().nodeById.get(nodeId) || null;
}

export function getWorkspaceQuestionById(questionId: string) {
  return getWorkspaceIndex().questions.find((question) => question.id === questionId) || null;
}

export function getWorkspaceStats() {
  const index = getWorkspaceIndex();
  const categoryCounts = new Map<string, number>();
  for (const question of index.questions) {
    const label = getSubjectDefinition(question.subjectKey).label;
    categoryCounts.set(label, (categoryCounts.get(label) || 0) + 1);
  }

  return {
    totalQuestions: index.questions.length,
    answerLinks: index.questions.reduce((sum, question) => sum + question.linkedInsights.filter((copy) => copy.sourceAvailable).length, 0),
    categoryCounts,
  };
}

function sanitizeQuestion(
  card: RawCard,
  canonical: ReturnType<typeof loadCanonicalSyllabusIndex>,
  answerById: Map<string, CanonicalAnswerRecord>,
  ocrSummaries: Record<string, OcrSummaryEntry>,
  fallbackNodes: Map<string, WorkspaceSyllabusNode>,
) {
  let questionText = cleanSentence(card.question);
  if (!isUsefulQuestionText(questionText)) return null;

  const placement = resolvePlacement(card, canonical, fallbackNodes);
  const essayPromptMatch = placement.subjectKey === "essay"
    ? resolveEssayPromptMatch(questionText, canonical)
    : null;
  if (placement.subjectKey === "essay") {
    if (!essayPromptMatch && shouldRejectEssayQuestion(questionText)) return null;
    if (essayPromptMatch?.prompt) questionText = essayPromptMatch.prompt;
  }
  const subject = getSubjectDefinition(placement.subjectKey);
  const linkedInsights = (card.linkedInsights || [])
    .map((copy) => sanitizeCopy(copy, answerById.get(copy.answerId), ocrSummaries))
    .sort((left, right) => {
      if (Number(left.sourceAvailable) !== Number(right.sourceAvailable)) {
        return Number(right.sourceAvailable) - Number(left.sourceAvailable);
      }
      if ((right.rank || 9999) !== (left.rank || 9999)) return (left.rank || 9999) - (right.rank || 9999);
      if ((right.year || 0) !== (left.year || 0)) return (right.year || 0) - (left.year || 0);
      return (left.topperName || "").localeCompare(right.topperName || "");
    });

  return {
    id: card.id,
    question: questionText,
    paper: placement.paper,
    category: subject.title,
    subjectKey: subject.key,
    subjectLabel: subject.shortLabel,
    estimatedYear: card.estimatedYear,
    marks: extractMarks(card.question),
    syllabusNodeId: placement.node.id,
    syllabusPath: placement.node.parentId
      ? [fallbackNodes.get(placement.node.parentId)?.label || canonical.nodeById.get(placement.node.parentId)?.label || subject.title, placement.node.label]
      : [placement.node.label],
    linkedInsights,
    topperCount: linkedInsights.length,
    searchText: buildSearchText(card, placement.node, linkedInsights),
  } satisfies WorkspaceQuestion;
}

function sanitizeCopy(
  copy: RawInsight,
  answerRecord: CanonicalAnswerRecord | undefined,
  ocrSummaries: Record<string, OcrSummaryEntry>,
): WorkspaceCopy {
  const driveId = answerRecord?.sourceDriveId || "";
  const rawOcrSummary = driveId ? cleanOcrSummary(ocrSummaries[driveId]?.summary || "") : "";
  const sheetSummary = cleanPublicText(copy.interpretation || "");
  const summaryAvailable = Boolean(
    rawOcrSummary
    && (answerRecord?.summarySource || copy.summarySource) === "ocr"
    && rawOcrSummary.length >= 120,
  );
  const fallbackSummaryAvailable = !summaryAvailable && sheetSummary.length >= 120;

  return {
    answerId: copy.answerId,
    topperName: normalizePublicTopperName(copy.topperName || answerRecord?.topperName || null),
    rank: copy.rank ?? answerRecord?.rank ?? null,
    year: copy.year ?? answerRecord?.year ?? null,
    institute: cleanPublicText(copy.institute || answerRecord?.institute || "") || null,
    marks: cleanPublicText(String(copy.marks ?? answerRecord?.marksObtained ?? "")) || null,
    pageHint: copy.pageHint ?? answerRecord?.pageNormalized ?? null,
    pageStatus: copy.pageStatus ?? answerRecord?.pageStatus ?? null,
    sourceAvailable: Boolean(copy.sourceAvailable ?? answerRecord?.sourceAvailable),
    sourceStatus: copy.sourceStatus ?? answerRecord?.sourceStatus ?? null,
    summary: summaryAvailable ? rawOcrSummary : (fallbackSummaryAvailable ? sheetSummary : ""),
    summaryAvailable: summaryAvailable || fallbackSummaryAvailable,
    summarySource: summaryAvailable ? "ocr" : (fallbackSummaryAvailable ? "sheet" : null),
  };
}

function resolvePlacement(
  card: RawCard,
  canonical: ReturnType<typeof loadCanonicalSyllabusIndex>,
  fallbackNodes: Map<string, WorkspaceSyllabusNode>,
): { subjectKey: SubjectKey; paper: string; node: SyllabusNode | WorkspaceSyllabusNode } {
  const tagCandidates = extractTagCandidates(card.syllabusTags);
  const question = cleanSentence(card.question);
  const categoryHint = getSubjectKeyFromValue(card.category);
  const paperHint = getSubjectKeyFromValue(card.paper);
  const patternHint = inferSubjectFromPatterns([...tagCandidates, question, card.category, card.paper].join(" "));
  const candidateSubjects = uniqueSubjectKeys([patternHint, categoryHint, paperHint].filter(Boolean) as SubjectKey[]);

  let best: { subjectKey: SubjectKey; node: SyllabusNode; score: number } | null = null;
  const subjectPool = candidateSubjects.length ? candidateSubjects : getSubjectDefinitions().map((definition) => definition.key);

  for (const subjectKey of subjectPool) {
    if (subjectKey === "essay") continue;
    const topics = canonical.topicsBySubject.get(subjectKey) || [];
    for (const node of topics) {
      const score = placementScore(tagCandidates, question, node, categoryHint || patternHint || paperHint);
      if (!best || score > best.score) {
        best = { subjectKey, node, score };
      }
    }
  }

  if (best && best.score >= 0.42) {
    return {
      subjectKey: best.subjectKey,
      paper: inferPaper(best.subjectKey, best.node.paper),
      node: best.node,
    };
  }

  const fallbackSubjectKey: SubjectKey = categoryHint || paperHint || patternHint || "essay";

  if (fallbackSubjectKey === "essay") {
    const essayNode = resolveEssayNode(question, canonical, fallbackNodes);
    return {
      subjectKey: "essay",
      paper: SUBJECT_DEFINITIONS.essay.paperLabel,
      node: essayNode,
    };
  }

  const subjectTopics = canonical.topicsBySubject.get(fallbackSubjectKey) || [];
  const withinSubject = subjectTopics
    .map((node) => ({ node, score: placementScore(tagCandidates, question, node, fallbackSubjectKey) }))
    .sort((left, right) => right.score - left.score)[0];

  if (withinSubject && withinSubject.score >= 0.18) {
    return {
      subjectKey: fallbackSubjectKey,
      paper: inferPaper(fallbackSubjectKey, withinSubject.node.paper),
      node: withinSubject.node,
    };
  }

  const node = createFallbackNode(fallbackSubjectKey, tagCandidates, question, fallbackNodes);
  return {
    subjectKey: fallbackSubjectKey,
    paper: inferPaper(fallbackSubjectKey, node.paper),
    node,
  };
}

function resolveEssayNode(
  question: string,
  canonical: ReturnType<typeof loadCanonicalSyllabusIndex>,
  fallbackNodes: Map<string, WorkspaceSyllabusNode>,
) {
  const essaySectionId = resolveEssayPromptMatch(question, canonical)?.sectionId;
  if (essaySectionId) {
    const existing = canonical.nodeById.get(essaySectionId);
    if (existing) return existing;
  }

  return createFallbackNode("essay", ["General essay theme"], question, fallbackNodes);
}

function createFallbackNode(
  subjectKey: SubjectKey,
  tagCandidates: string[],
  question: string,
  fallbackNodes: Map<string, WorkspaceSyllabusNode>,
) {
  const subject = getSubjectDefinition(subjectKey);
  const label = cleanSentence(tagCandidates[0] || summarizeQuestion(question) || `${subject.title} topic`);
  const groupId = `${subjectKey}:group:fallback`;

  if (!fallbackNodes.has(groupId)) {
    fallbackNodes.set(groupId, {
      id: groupId,
      subjectKey,
      label: subject.title,
      parentId: null,
      order: 10_000,
      kind: "group",
      paper: subject.paperLabel,
      isFallback: true,
      questionCount: 0,
    });
  }

  const nodeId = `${subjectKey}:topic:fallback:${slug(label)}`;
  if (!fallbackNodes.has(nodeId)) {
    fallbackNodes.set(nodeId, {
      id: nodeId,
      subjectKey,
      label,
      parentId: groupId,
      order: 10_001 + fallbackNodes.size,
      kind: "topic",
      paper: subject.paperLabel,
      isFallback: true,
      questionCount: 0,
    });
  }

  return fallbackNodes.get(nodeId)!;
}

function placementScore(
  tagCandidates: string[],
  question: string,
  node: SyllabusNode,
  subjectHint: SubjectKey | null,
) {
  const tagScore = tagCandidates.reduce((best, tag) => Math.max(best, textMatchScore(tag, node.label)), 0);
  const questionScore = textMatchScore(question, node.label);
  const hintBonus = subjectHint === node.subjectKey ? 0.08 : 0;
  const paperBonus = normalizeSyllabusText(question).includes(normalizeSyllabusText(node.paper)) ? 0.04 : 0;

  return tagScore * 0.76 + questionScore * 0.24 + hintBonus + paperBonus;
}

function textMatchScore(left: string, right: string) {
  const cacheKey = `${left}::${right}`;
  const cached = TEXT_MATCH_CACHE.get(cacheKey);
  if (cached !== undefined) return cached;

  const normalizedLeft = normalizeSyllabusText(left);
  const normalizedRight = normalizeSyllabusText(right);
  if (!normalizedLeft || !normalizedRight) {
    TEXT_MATCH_CACHE.set(cacheKey, 0);
    return 0;
  }
  if (normalizedLeft === normalizedRight) {
    TEXT_MATCH_CACHE.set(cacheKey, 1);
    return 1;
  }
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    TEXT_MATCH_CACHE.set(cacheKey, 0.82);
    return 0.82;
  }

  const leftTokens = filteredTokens(left);
  const rightTokens = filteredTokens(right);
  if (!leftTokens.length || !rightTokens.length) {
    TEXT_MATCH_CACHE.set(cacheKey, 0);
    return 0;
  }

  const shared = leftTokens.filter((token) => rightTokens.includes(token));
  if (!shared.length) {
    TEXT_MATCH_CACHE.set(cacheKey, 0);
    return 0;
  }

  const coverage = shared.length / Math.max(1, Math.min(leftTokens.length, rightTokens.length));
  const jaccard = shared.length / Math.max(1, leftTokens.length + rightTokens.length - shared.length);
  const score = coverage * 0.72 + jaccard * 0.28;
  TEXT_MATCH_CACHE.set(cacheKey, score);
  return score;
}

function inferSubjectFromPatterns(haystack: string): SubjectKey | null {
  for (const hint of SUBJECT_HINT_PATTERNS) {
    if (hint.patterns.some((pattern) => pattern.test(haystack))) return hint.subjectKey;
  }
  return null;
}

function inferPaper(subjectKey: SubjectKey, fallback: string) {
  if (subjectKey.startsWith("gs")) return SUBJECT_DEFINITIONS[subjectKey].paperLabel;
  return fallback || SUBJECT_DEFINITIONS[subjectKey].paperLabel;
}

function extractTagCandidates(values: string[]) {
  return values
    .flatMap((value) => String(value || "").split("|"))
    .map(cleanSentence)
    .filter((value) => value && !/^page\s+\d+$/i.test(value) && value.toLowerCase() !== "na")
    .slice(0, 18);
}

function cleanOcrSummary(value: string) {
  const lines = String(value || "")
    .split(/\r?\n/)
    .map((line) => cleanSentence(line))
    .filter(Boolean)
    .filter((line) => {
      const lowered = line.toLowerCase();
      if (lowered.includes("time allowed") || lowered.includes("maximum marks")) return false;
      if (lowered.startsWith("candidate") || lowered.startsWith("do not write")) return false;
      if (lowered.startsWith("mobile no") || lowered.startsWith("e-mail")) return false;
      if (lowered.startsWith("name:") || lowered.startsWith("test no")) return false;
      if (lowered.includes("question-cum-answer booklet")) return false;
      if (lowered.includes("more than a coaching")) return false;
      return true;
    });

  return lines.join(" ").replace(/\s+/g, " ").trim().slice(0, 520);
}

function isUsefulQuestionText(value: string) {
  const clean = cleanSentence(value);
  if (!isPublishableQuestionText(clean)) return false;
  if (!clean || clean.length < 24) return false;
  if (/^no questions were found\\b/i.test(clean)) return false;
  if (/^(?:q\\s*)?\\d+[a-e]?[.)-]?$/i.test(clean)) return false;
  const tokenCount = searchTerms(clean).length;
  if (tokenCount < 4 && clean.length < 40) return false;
  return true;
}

function buildSearchText(card: RawCard, node: SyllabusNode, copies: WorkspaceCopy[]) {
  return [
    cleanSentence(card.question),
    cleanSentence(card.paper),
    cleanSentence(card.category),
    node.label,
    ...copies.flatMap((copy) => [
      copy.topperName || "",
      copy.institute || "",
      copy.year ? String(copy.year) : "",
      copy.summary,
    ]),
  ]
    .join(" ")
    .toLowerCase();
}

function searchScore(question: WorkspaceQuestion, terms: string[]) {
  let score = 0;
  const questionText = question.question.toLowerCase();
  const searchText = question.searchText.toLowerCase();
  const questionTokens = questionSearchTokens(question);
  const syllabusTokensForQuestion = searchTokens(question.syllabusPath.join(" "));
  for (const term of terms) {
    if (!matchesSearchTerm(term, searchText, questionTokens)) return 0;
    const tokenScore = bestTokenMatchScore(term, questionTokens);
    if (questionText.includes(term)) score += 5 + tokenScore;
    else if (question.syllabusPath.some((label) => label.toLowerCase().includes(term))) score += 3 + tokenScore;
    else if (matchesSearchTerm(term, question.syllabusPath.join(" ").toLowerCase(), syllabusTokensForQuestion)) score += 2.25 + tokenScore;
    else score += 1 + tokenScore;
  }
  return score + question.topperCount;
}

function filteredTokens(value: string) {
  const key = normalizeSyllabusText(value);
  const cached = TOKEN_CACHE.get(key);
  if (cached) return cached;
  const tokens = syllabusTokens(value).filter((token) => !QUESTION_STOP_WORDS.has(token));
  TOKEN_CACHE.set(key, tokens);
  return tokens;
}

function questionSearchTokens(question: WorkspaceQuestion) {
  const cached = QUESTION_SEARCH_TOKEN_CACHE.get(question.id);
  if (cached) return cached;
  const tokens = searchTokens([question.question, question.searchText, question.syllabusPath.join(" ")].join(" "));
  QUESTION_SEARCH_TOKEN_CACHE.set(question.id, tokens);
  return tokens;
}

function extractMarks(question: string) {
  const match =
    String(question || "").match(/\b(10|15|20|25|125|250)\s*marks?\b/i)
    || String(question || "").match(/\((10|15|20|25)\s*m/i);
  return match ? Number(match[1]) : null;
}

function summarizeQuestion(value: string) {
  return cleanSentence(value).replace(/^q(?:uestion)?\.?\s*\d+[a-z]?\s*/i, "").slice(0, 140);
}

function normalizeEssayPrompt(value: string) {
  return cleanSentence(value)
    .toLowerCase()
    .replace(/^(?:section\s+[ab]\s+|topic\s+\d+\s+)?q(?:uestion)?\.?\s*\d+[a-z]?\)?\s*/i, "")
    .replace(/^\d+[a-z]?[.)]\s*/, "")
    .replace(/^["“”']+|["“”']+$/g, "")
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function resolveEssayPromptMatch(
  question: string,
  canonical: ReturnType<typeof loadCanonicalSyllabusIndex>,
) {
  const normalized = normalizeEssayPrompt(question);
  if (!normalized) return null;

  const exactSectionId = canonical.essaySectionByPrompt.get(normalized);
  if (exactSectionId) {
    return {
      normalized,
      prompt: canonical.essayPromptByNormalized.get(normalized) || question,
      sectionId: exactSectionId,
    };
  }

  const matches: Array<{ normalized: string; prompt: string; sectionId: string }> = [];
  for (const [promptKey, sectionId] of canonical.essaySectionByPrompt.entries()) {
    if (
      normalized.includes(promptKey)
      || promptKey.includes(normalized)
    ) {
      matches.push({
        normalized: promptKey,
        prompt: canonical.essayPromptByNormalized.get(promptKey) || promptKey,
        sectionId,
      });
    }
  }

  if (matches.length !== 1) return null;
  return matches[0];
}

function shouldRejectEssayQuestion(question: string) {
  const value = cleanSentence(question);
  const normalized = normalizeEssayPrompt(value);
  const promptMarkerCount = (value.match(/\bq(?:uestion)?\.?\s*\d+[a-z]?\b/gi) || []).length;
  if (!normalized) return true;
  if (promptMarkerCount > 1) return true;
  if (normalized.length > 180) return true;
  if (/^(?:write two essays|having discussed|what are|what is|why |how |who |which |so |then )/i.test(normalized)) return true;
  return false;
}

function mergeDuplicateQuestions(questions: WorkspaceQuestion[]) {
  const grouped = new Map<string, WorkspaceQuestion>();

  for (const question of questions) {
    const key = [
      question.subjectKey,
      question.syllabusNodeId,
      normalizeQuestionKey(question.question),
    ].join("::");
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        ...question,
        linkedInsights: [...question.linkedInsights],
      });
      continue;
    }

    if (questionQuality(question.question) > questionQuality(existing.question)) {
      existing.question = question.question;
      existing.marks = question.marks ?? existing.marks;
      existing.estimatedYear = question.estimatedYear ?? existing.estimatedYear;
    }

    for (const copy of question.linkedInsights) {
      if (!existing.linkedInsights.some((entry) => entry.answerId === copy.answerId)) {
        existing.linkedInsights.push(copy);
      }
    }

    existing.linkedInsights.sort((left, right) => {
      if (Number(left.sourceAvailable) !== Number(right.sourceAvailable)) {
        return Number(right.sourceAvailable) - Number(left.sourceAvailable);
      }
      if ((left.rank || 9999) !== (right.rank || 9999)) return (left.rank || 9999) - (right.rank || 9999);
      if ((right.year || 0) !== (left.year || 0)) return (right.year || 0) - (left.year || 0);
      return (left.topperName || "").localeCompare(right.topperName || "");
    });
    existing.topperCount = existing.linkedInsights.length;
    existing.searchText = `${existing.searchText} ${question.searchText}`.trim();
  }

  return [...grouped.values()];
}

function normalizeQuestionKey(value: string) {
  return cleanSentence(value)
    .toLowerCase()
    .replace(/^q(?:uestion)?\.?\s*\d+[a-z]?\)?\s*/i, "")
    .replace(/\(answer in \d+ words?\)/gi, "")
    .replace(/\(\d+\s*marks?\)/gi, "")
    .replace(/\b\d+\s*marks?\b/gi, "")
    .replace(/\b\d+\s*words?\b/gi, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function questionQuality(value: string) {
  const clean = cleanSentence(value);
  let score = 0;
  if (/\bmarks?\b/i.test(clean)) score += 3;
  if (!/\banswer in \d+ words?\b/i.test(clean)) score += 2;
  if ((clean.match(/\bq(?:uestion)?\.?\s*\d+/gi) || []).length <= 1) score += 2;
  if (clean.length <= 220) score += 1;
  return score;
}

function cleanSentence(value: string) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value: string) {
  return cleanSentence(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function uniqueSubjectKeys(values: SubjectKey[]) {
  return [...new Set(values)];
}

function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function hydrateWorkspaceIndex(snapshot: WorkspaceSnapshot): WorkspaceIndex {
  const nodeById = new Map(snapshot.syllabusNodes.map((node) => [node.id, node]));
  const questionsBySubject = new Map<SubjectKey, WorkspaceQuestion[]>();
  const syllabusNodesBySubject = new Map<SubjectKey, WorkspaceSyllabusNode[]>();

  for (const definition of getSubjectDefinitions()) {
    questionsBySubject.set(definition.key, []);
    syllabusNodesBySubject.set(
      definition.key,
      snapshot.syllabusNodes
        .filter((node) => node.subjectKey === definition.key && node.questionCount > 0)
        .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label)),
    );
  }

  for (const question of snapshot.questions) {
    questionsBySubject.get(question.subjectKey)?.push(question);
  }

  for (const definition of getSubjectDefinitions()) {
    questionsBySubject.get(definition.key)?.sort((left, right) => {
      if ((left.estimatedYear || 0) !== (right.estimatedYear || 0)) {
        return (right.estimatedYear || 0) - (left.estimatedYear || 0);
      }
      if (left.topperCount !== right.topperCount) return right.topperCount - left.topperCount;
      return left.question.localeCompare(right.question);
    });
  }

  return {
    generatedAt: snapshot.generatedAt,
    questions: snapshot.questions,
    questionsBySubject,
    syllabusNodesBySubject,
    nodeById,
  };
}
