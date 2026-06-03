import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { loadOfficialRows } from "../src/lib/official-pyqs";

const ROOT = join(__dirname, "..");
const APP_DATA_DIR = join(ROOT, "data", "app");
const PYQ_FILE = join(APP_DATA_DIR, "pyqs.json");
const TOPPER_ANSWERS_FILE = join(APP_DATA_DIR, "topper-answer-canonical.json");
const OUT_FILE = join(APP_DATA_DIR, "official-pyq-links.json");
const PUBLIC_OUT_FILE = join(APP_DATA_DIR, "public-official-pyq-links.json");
const AUDIT_FILE = join(APP_DATA_DIR, "official-pyq-link-audit.json");
const REVIEW_FILE = join(APP_DATA_DIR, "official-pyq-review-queues.json");

const THRESHOLD = {
  highConfidence: 0.82,
  strong: 0.68,
  topicMatch: 0.3,
  looseTopicMatch: 0.3,
  review: 0.24,
  maxCardsPerOfficial: 18,
  maxCopiesPerOfficial: 140,
};

const STOP_WORDS = new Set(
  [
    "the", "a", "an", "and", "or", "of", "in", "on", "to", "for", "with", "by", "from",
    "is", "are", "was", "were", "be", "been", "being", "as", "at", "it", "its", "this",
    "that", "these", "those", "into", "between", "through", "under", "over", "their",
    "has", "have", "had", "not", "no", "but", "if", "then", "than", "which", "what",
    "why", "how", "do", "does", "did", "can", "could", "should", "would", "will",
    "discuss", "examine", "critically", "analyse", "analyze", "comment", "evaluate",
    "explain", "describe", "highlight", "elucidate", "illustrate", "role", "impact",
    "significance", "importance", "need", "challenges", "issues", "measures", "india",
    "indian", "upsc", "marks", "mark", "words", "word", "question", "paper", "mains",
    "q", "qa", "qb", "qc", "qd", "qe",
  ],
);

const SUBJECT_NOISE = new Set(
  ["artificial", "intelligence", "united", "nations", "governance", "polity", "economy", "society", "history"],
);

const ANCHOR_NOISE = new Set([
  "national", "state", "policy", "principle", "significant", "provision", "article", "constitution",
  "right", "management", "strategy", "risk", "reduce", "during", "such", "event", "urban", "areas",
  "various", "cause", "factor", "component", "relation", "relationship", "problem", "challenge",
  "issue", "measure", "role", "public", "government", "decade", "recent", "current", "context",
]);

const TOKEN_CACHE = new Map<string, string[]>();
const CARD_SEMANTIC_CACHE = new Map<string, Set<string>>();

interface PyqCard {
  id: string;
  question: string;
  paper: string;
  category: string;
  estimatedYear: number | null;
  syllabusTags: string[];
  keywords: string[];
  linkedInsights: unknown[];
}

interface TopperAnswerRecord {
  answerId: string;
  cardId: string;
  extractedQuestion: string;
  cardCategory: string;
  paper: string;
  estimatedYear: number | null;
  syllabusTags: string[];
  keywords: string[];
  topperName: string;
  nameStatus?: string;
  nameSource?: string;
  rank: number | null;
  year: number | null;
  yearSource?: string | null;
  institute: string | null;
  instituteSource?: string | null;
  marksObtained?: string | null;
  marksSource?: string | null;
  sourceDriveId: string | null;
  sourceUrl: string | null;
  sourceAvailable: boolean;
  sourceStatus: string;
  linkSource: string | null;
  originalFilename: string | null;
  cleanFilename: string;
  pageRaw: number | string | null;
  pageNormalized: number | null;
  pageSource?: string;
  pageStatus: "valid" | "missing" | "fallback" | "out_of_range";
  pageCount: number | null;
  localPdfPath: string | null;
  summary: string;
  summaryStatus?: string;
  valueAdds: string[];
}

interface Score {
  confidence: number;
  tokenJaccard: number;
  officialCover: number;
  mappedCover: number;
  weightedOfficialCover: number;
  weightedMappedCover: number;
  sharedTokens: number;
  officialTokens: number;
  mappedTokens: number;
  strongAnchorMatches: string[];
  semanticHits: string[];
  subjectSignal: boolean;
  topicOverlap: number;
  topicHitCount: number;
  matchFloor: number;
}

interface AcceptedAnswerLink {
  officialQuestionId: string;
  topperAnswerId: string;
  cardId: string;
  matchType: "direct" | "strong" | "topic-match" | "loose-topic-match";
  matchConfidence: number;
  matchReason: string;
  officialQuestion?: string;
  extractedQuestion: string;
  paper: string;
  category: string;
  syllabusTags: string[];
  keywords: string[];
  topperName: string;
  nameStatus?: string;
  nameSource?: string;
  rank: number | null;
  year: number | null;
  yearSource?: string | null;
  institute: string | null;
  instituteSource?: string | null;
  marksObtained?: string | null;
  marksSource?: string | null;
  sourceAvailable: boolean;
  sourceStatus: string;
  originalFilename?: string | null;
  cleanFilename?: string;
  pageRaw?: number | string | null;
  pageNormalized: number | null;
  pageSource?: string;
  pageStatus: "valid" | "missing" | "fallback" | "out_of_range";
  summary: string;
  summaryStatus?: string;
  summarySource?: string;
  valueAdds: string[];
}

function main() {
  const officialRows = loadOfficialRows();
  const cards = uniqueCards(loadPyqCards()).filter((card) => card.linkedInsights.length > 0 && isUsableExtractedQuestion(card.question));
  const answers = loadTopperAnswers();
  const answersByCard = groupAnswersByCard(answers);
  const idf = buildIdf([...officialRows.map((row) => row.question), ...cards.map((card) => card.question)]);
  const exactIndex = buildExactIndex(cards);
  const tokenIndex = buildTokenIndex(cards);

  const links: Record<string, AcceptedAnswerLink[]> = {};
  const ambiguousOfficialMatches = [];
  let exactQuestionCount = 0;
  let strongQuestionCount = 0;
  let topicMatchQuestionCount = 0;
  let looseTopicMatchQuestionCount = 0;

  for (const row of officialRows) {
    if (isEssayRow(row)) {
      continue;
    }

    const exactCards = exactIndex.get(normalizeQuestion(row.question)) || [];
    let acceptedCards: { card: PyqCard; matchType: AcceptedAnswerLink["matchType"]; confidence: number; reason: string; score?: Score }[] = [];

    if (exactCards.length > 0) {
      exactQuestionCount += 1;
      acceptedCards = exactCards.map((card) => ({
        card,
        matchType: "direct",
        confidence: 1,
        reason: "Normalized official PYQ text exactly matches the extracted topper-answer card.",
      }));
    } else {
      const scored = scoreCandidates(row, cards, tokenIndex, idf);
      acceptedCards = scored
        .map(({ card, score }) => ({ card, score, matchType: classifyScore(score) }))
        .filter((match): match is { card: PyqCard; score: Score; matchType: AcceptedAnswerLink["matchType"] } => Boolean(match.matchType))
        .slice(0, THRESHOLD.maxCardsPerOfficial)
        .map(({ card, score, matchType }) => ({
          card,
          matchType,
          confidence: round(Math.max(score.confidence, score.matchFloor)),
          reason: explainScore(score),
          score,
        }));

      if (acceptedCards.some((match) => match.matchType === "strong")) strongQuestionCount += 1;
      if (acceptedCards.some((match) => match.matchType === "topic-match")) topicMatchQuestionCount += 1;
      if (acceptedCards.some((match) => match.matchType === "loose-topic-match")) looseTopicMatchQuestionCount += 1;

      const reviewCandidates = scored
        .filter(({ score }) => score.matchFloor >= THRESHOLD.review || score.confidence >= THRESHOLD.review)
        .slice(0, 6)
        .map(({ card, score }) => ({
          cardId: card.id,
          extractedQuestion: card.question,
          category: card.category,
          paper: card.paper,
          confidence: round(score.confidence),
          reason: explainScore(score),
          linkedCopies: answersByCard.get(card.id)?.length || 0,
        }));

      if (reviewCandidates.length > 0 && acceptedCards.length === 0) {
        ambiguousOfficialMatches.push({
          officialQuestionId: row.id,
          officialQuestion: row.question,
          subject: row.subjectKey,
          candidates: reviewCandidates,
        });
      }
    }

    const acceptedAnswers = acceptedCards.flatMap((match) => {
      const cardAnswers = answersByCard.get(match.card.id) || [];
      return cardAnswers.map((answer) => toAcceptedAnswer(row.id, row.question, answer, match));
    });

    const deduped = capOfficialAnswers(dedupeOfficialAnswers(acceptedAnswers));
    if (deduped.length > 0) links[row.id] = deduped.map(toPublicAnswerLink);
  }

  const allLinks = Object.values(links).flat();
  const reviewQueues = buildReviewQueues(answers, ambiguousOfficialMatches);
  const payload = {
    generatedAt: new Date().toISOString(),
    thresholds: THRESHOLD,
    officialQuestionCount: officialRows.length,
    candidateCardCount: cards.length,
    topperAnswerCount: answers.length,
    linkedQuestionCount: Object.keys(links).length,
    exactQuestionCount,
    strongQuestionCount,
    topicMatchQuestionCount,
    looseTopicMatchQuestionCount,
    linkedCopyCount: allLinks.length,
    sourceAvailableCount: allLinks.filter((link) => link.sourceAvailable).length,
    pageValidCount: allLinks.filter((link) => link.pageStatus === "valid").length,
    pageReviewCount: allLinks.filter((link) => link.pageStatus !== "valid").length,
    driveUrlLeakCount: JSON.stringify(allLinks).match(/drive\.google\.com/g)?.length || 0,
    links,
  };
  const publicPayload = {
    generatedAt: payload.generatedAt,
    thresholds: {
      topicMatch: THRESHOLD.topicMatch,
      looseTopicMatch: THRESHOLD.looseTopicMatch,
    },
    officialQuestionCount: payload.officialQuestionCount,
    linkedQuestionCount: payload.linkedQuestionCount,
    linkedCopyCount: payload.linkedCopyCount,
    sourceAvailableCount: payload.sourceAvailableCount,
    links: Object.fromEntries(
      Object.entries(links).map(([id, rows]) => [id, rows.map(toPublicWebsiteAnswerLink)]),
    ),
  };

  const audit = {
    generatedAt: payload.generatedAt,
    thresholds: THRESHOLD,
    officialQuestionCount: payload.officialQuestionCount,
    candidateCardCount: payload.candidateCardCount,
    topperAnswerCount: payload.topperAnswerCount,
    linkedQuestionCount: payload.linkedQuestionCount,
    exactQuestionCount: payload.exactQuestionCount,
    strongQuestionCount: payload.strongQuestionCount,
    topicMatchQuestionCount: payload.topicMatchQuestionCount,
    looseTopicMatchQuestionCount: payload.looseTopicMatchQuestionCount,
    linkedCopyCount: payload.linkedCopyCount,
    sourceAvailableCount: payload.sourceAvailableCount,
    pageValidCount: payload.pageValidCount,
    pageReviewCount: payload.pageReviewCount,
    driveUrlLeakCount: payload.driveUrlLeakCount,
    reviewQueueCounts: {
      ambiguousOfficialMatches: reviewQueues.ambiguousOfficialMatches.length,
      missingPdfQueue: reviewQueues.missingPdfQueue.length,
      pageReviewQueue: reviewQueues.pageReviewQueue.length,
      duplicateSourcePageQueue: reviewQueues.duplicateSourcePageQueue.length,
    },
  };

  mkdirSync(APP_DATA_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  writeFileSync(PUBLIC_OUT_FILE, JSON.stringify(publicPayload, null, 2));
  writeFileSync(AUDIT_FILE, JSON.stringify(audit, null, 2));
  writeFileSync(REVIEW_FILE, JSON.stringify({ generatedAt: payload.generatedAt, ...reviewQueues }, null, 2));

  console.log(`Built official PYQ links: ${payload.linkedQuestionCount.toLocaleString()} questions, ${payload.linkedCopyCount.toLocaleString()} linked copies`);
  console.log(`Source-ready copies: ${payload.sourceAvailableCount.toLocaleString()}`);
  console.log(`Review queues: ${JSON.stringify(audit.reviewQueueCounts)}`);
  console.log(`Output: ${OUT_FILE}`);
  console.log(`Public output: ${PUBLIC_OUT_FILE}`);
}

function loadPyqCards(): PyqCard[] {
  try {
    return JSON.parse(readFileSync(PYQ_FILE, "utf-8")).cards || [];
  } catch {
    return [];
  }
}

function loadTopperAnswers(): TopperAnswerRecord[] {
  try {
    return JSON.parse(readFileSync(TOPPER_ANSWERS_FILE, "utf-8")).records || [];
  } catch {
    return [];
  }
}

function uniqueCards(cards: PyqCard[]) {
  const byId = new Map<string, PyqCard>();
  for (const card of cards) {
    const existing = byId.get(card.id);
    if (!existing) {
      byId.set(card.id, { ...card, linkedInsights: [...card.linkedInsights] });
      continue;
    }
    existing.linkedInsights.push(...card.linkedInsights);
  }
  return [...byId.values()];
}

function groupAnswersByCard(records: TopperAnswerRecord[]) {
  const grouped = new Map<string, TopperAnswerRecord[]>();
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.answerId)) continue;
    seen.add(record.answerId);
    const bucket = grouped.get(record.cardId) || [];
    bucket.push(record);
    grouped.set(record.cardId, bucket);
  }
  return grouped;
}

function buildExactIndex(cards: PyqCard[]) {
  const exactIndex = new Map<string, PyqCard[]>();
  for (const card of cards) {
    const key = normalizeQuestion(card.question);
    if (!key) continue;
    const bucket = exactIndex.get(key) || [];
    bucket.push(card);
    exactIndex.set(key, bucket);
  }
  return exactIndex;
}

function buildTokenIndex(cards: PyqCard[]) {
  const tokenIndex = new Map<string, number[]>();
  cards.forEach((card, index) => {
    for (const token of new Set(tokens([card.question, ...card.syllabusTags, ...card.keywords, card.category].join(" ")))) {
      const bucket = tokenIndex.get(token) || [];
      bucket.push(index);
      tokenIndex.set(token, bucket);
    }
  });
  return tokenIndex;
}

function scoreCandidates(
  row: ReturnType<typeof loadOfficialRows>[number],
  cards: PyqCard[],
  tokenIndex: Map<string, number[]>,
  idf: Map<string, number>,
) {
  const candidateIndexes = new Set<number>();
  const officialTokens = tokens(row.question);
  const officialTopicTokens = topicTokensForOfficial(row);

  const rareTokens = [...new Set(officialTokens)]
    .sort((a, b) => weight(b, idf) - weight(a, idf))
    .slice(0, 10);

  for (const token of rareTokens) {
    if (candidateIndexes.size > 0 && weight(token, idf) < 1.65) continue;
    for (const index of tokenIndex.get(token) || []) candidateIndexes.add(index);
  }

  for (const token of officialTopicTokens) {
    for (const index of tokenIndex.get(token) || []) candidateIndexes.add(index);
  }

  if (candidateIndexes.size === 0) {
    for (const token of officialTokens) {
      for (const index of tokenIndex.get(token) || []) candidateIndexes.add(index);
    }
  }

  const scored: { card: PyqCard; score: Score }[] = [];
  for (const index of candidateIndexes) {
    const card = cards[index];
    const score = scoreQuestionPair(row, card, idf);
    if (score.sharedTokens === 0 && score.strongAnchorMatches.length === 0 && score.topicHitCount === 0) continue;
    scored.push({ card, score });
  }

  return scored.sort((a, b) => scoreSortValue(b.score) - scoreSortValue(a.score));
}

function scoreSortValue(score: Score) {
  return Math.max(score.confidence, score.matchFloor) + Math.min(0.18, score.topicOverlap * 0.18);
}

function scoreQuestionPair(row: ReturnType<typeof loadOfficialRows>[number], card: PyqCard, idf: Map<string, number>): Score {
  const official = new Set(tokens(row.question));
  const mapped = new Set(tokens(card.question));
  const shared = [...official].filter((token) => mapped.has(token));
  const officialWeight = [...official].reduce((sum, token) => sum + weight(token, idf), 0) || 1;
  const mappedWeight = [...mapped].reduce((sum, token) => sum + weight(token, idf), 0) || 1;
  const sharedWeight = shared.reduce((sum, token) => sum + weight(token, idf), 0);
  const strongAnchorMatches = matchedStrongAnchors(row.question, card.question, idf);
  const semanticHits = semanticOverlaps(row, card);
  const subjectSignal = isSubjectSignal(row, card) || semanticHits.length >= 2;
  const officialTopicTokens = topicTokensForOfficial(row);
  const mappedTopicTokens = cardTopicTokens(card);
  const topicHitCount = officialTopicTokens.filter((token) => mappedTopicTokens.has(token)).length;
  const topicOverlap = topicHitCount / Math.max(1, Math.min(officialTopicTokens.length || 1, mappedTopicTokens.size || 1));

  const officialCover = official.size ? shared.length / official.size : 0;
  const mappedCover = mapped.size ? shared.length / mapped.size : 0;
  const tokenJaccard = shared.length / Math.max(1, official.size + mapped.size - shared.length);
  const weightedOfficialCover = sharedWeight / officialWeight;
  const weightedMappedCover = sharedWeight / mappedWeight;
  const anchorBoost = Math.min(0.18, strongAnchorMatches.length * 0.07);
  const semanticBoost = Math.min(0.08, semanticHits.length * 0.025);
  const subjectBoost = subjectSignal ? 0.04 : 0;
  const topicBoost = Math.min(0.14, topicOverlap * 0.14);

  const confidence = Math.min(0.99,
    officialCover * 0.24
    + mappedCover * 0.18
    + tokenJaccard * 0.15
    + weightedOfficialCover * 0.24
    + weightedMappedCover * 0.09
    + anchorBoost
    + semanticBoost
    + subjectBoost
    + topicBoost,
  );
  const matchFloor = Math.max(officialCover, mappedCover, weightedOfficialCover, weightedMappedCover, topicOverlap);

  return {
    confidence,
    tokenJaccard,
    officialCover,
    mappedCover,
    weightedOfficialCover,
    weightedMappedCover,
    sharedTokens: shared.length,
    officialTokens: official.size,
    mappedTokens: mapped.size,
    strongAnchorMatches,
    semanticHits,
    subjectSignal,
    topicOverlap,
    topicHitCount,
    matchFloor,
  };
}

function classifyScore(score: Score): AcceptedAnswerLink["matchType"] | null {
  if (
    score.confidence >= THRESHOLD.highConfidence
    && score.sharedTokens >= 5
    && score.officialCover >= 0.72
    && score.weightedOfficialCover >= 0.76
  ) {
    return "strong";
  }

  if (
    score.confidence >= THRESHOLD.strong
    && score.subjectSignal
    && score.strongAnchorMatches.length >= 1
    && score.semanticHits.length >= 1
    && score.weightedOfficialCover >= 0.36
  ) {
    return "strong";
  }

  if (
    score.subjectSignal
    && score.topicOverlap >= THRESHOLD.topicMatch
    && (score.sharedTokens >= 2 || score.strongAnchorMatches.length >= 1 || score.weightedOfficialCover >= 0.18)
  ) {
    return "topic-match";
  }

  if (
    score.subjectSignal
    && score.matchFloor >= THRESHOLD.looseTopicMatch
    && score.topicHitCount >= 1
    && (score.sharedTokens >= 1 || score.semanticHits.length >= 2)
  ) {
    return "loose-topic-match";
  }

  return null;
}

function toAcceptedAnswer(
  officialQuestionId: string,
  officialQuestion: string,
  answer: TopperAnswerRecord,
  match: { card: PyqCard; matchType: AcceptedAnswerLink["matchType"]; confidence: number; reason: string },
): AcceptedAnswerLink {
  return {
    officialQuestionId,
    topperAnswerId: answer.answerId,
    cardId: answer.cardId,
    matchType: match.matchType,
    matchConfidence: match.confidence,
    matchReason: match.reason,
    officialQuestion,
    extractedQuestion: answer.extractedQuestion,
    paper: answer.paper,
    category: answer.cardCategory,
    syllabusTags: answer.syllabusTags,
    keywords: answer.keywords,
    topperName: answer.topperName,
    nameStatus: answer.nameStatus,
    nameSource: answer.nameSource,
    rank: answer.rank,
    year: answer.year,
    yearSource: answer.yearSource,
    institute: answer.institute,
    instituteSource: answer.instituteSource,
    marksObtained: answer.marksObtained,
    marksSource: answer.marksSource,
    sourceAvailable: answer.sourceAvailable,
    sourceStatus: answer.sourceStatus,
    originalFilename: answer.originalFilename,
    cleanFilename: answer.cleanFilename,
    pageRaw: answer.pageRaw,
    pageNormalized: answer.pageNormalized,
    pageSource: answer.pageSource,
    pageStatus: answer.pageStatus,
    summary: answer.summary,
    summaryStatus: answer.summaryStatus,
    summarySource: answer.summarySource,
    valueAdds: answer.valueAdds,
  };
}

function dedupeOfficialAnswers(records: AcceptedAnswerLink[]) {
  const seen = new Set<string>();
  const out = [];

  for (const record of records.sort((a, b) => Number(b.sourceAvailable) - Number(a.sourceAvailable) || b.matchConfidence - a.matchConfidence)) {
    const key = [
      record.sourceAvailable ? record.cleanFilename : record.originalFilename,
      record.topperName,
      record.pageNormalized,
      record.extractedQuestion,
    ].join("|").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(record);
  }

  return out;
}

function capOfficialAnswers(records: AcceptedAnswerLink[]) {
  return records
    .slice()
    .sort((a, b) => answerSortValue(b) - answerSortValue(a))
    .slice(0, THRESHOLD.maxCopiesPerOfficial);
}

function answerSortValue(record: AcceptedAnswerLink) {
  const typeRank: Record<AcceptedAnswerLink["matchType"], number> = {
    direct: 4,
    strong: 3,
    "topic-match": 2,
    "loose-topic-match": 1,
  };
  return (
    typeRank[record.matchType] * 10
    + record.matchConfidence
    + (record.sourceAvailable && record.pageStatus === "valid" ? 2 : 0)
    + (record.summaryStatus === "available" ? 0.5 : 0)
    + (!["Unknown topper", "Anonymous topper"].includes(record.topperName) ? 0.25 : 0)
  );
}

function toPublicAnswerLink(record: AcceptedAnswerLink) {
  return {
    officialQuestionId: record.officialQuestionId,
    topperAnswerId: record.topperAnswerId,
    cardId: record.cardId,
    matchType: record.matchType,
    matchConfidence: record.matchConfidence,
    matchReason: record.matchReason,
    extractedQuestion: record.extractedQuestion,
    paper: record.paper,
    category: record.category,
    syllabusTags: record.syllabusTags,
    keywords: record.keywords,
    topperName: record.topperName,
    nameStatus: record.nameStatus,
    nameSource: record.nameSource,
    rank: record.rank,
    year: record.year,
    yearSource: record.yearSource,
    institute: record.institute,
    instituteSource: record.instituteSource,
    marksObtained: record.marksObtained,
    marksSource: record.marksSource,
    sourceAvailable: record.sourceAvailable,
    sourceStatus: record.sourceStatus,
    pageNormalized: record.pageNormalized,
    pageSource: record.pageSource,
    pageStatus: record.pageStatus,
    summary: record.summary,
    summaryStatus: record.summaryStatus,
    summarySource: record.summarySource,
    valueAdds: record.valueAdds,
  };
}

function toPublicWebsiteAnswerLink(record: AcceptedAnswerLink) {
  return {
    officialQuestionId: record.officialQuestionId,
    topperAnswerId: record.topperAnswerId,
    cardId: record.cardId,
    matchType: record.matchType,
    matchConfidence: record.matchConfidence,
    matchReason: publicMatchReason(record),
    extractedQuestion: record.extractedQuestion,
    paper: record.paper,
    category: record.category,
    syllabusTags: record.syllabusTags,
    keywords: record.keywords,
    topperName: isAnonymousTopper(record.topperName) ? "Anonymous topper" : record.topperName,
    nameStatus: isAnonymousTopper(record.topperName) ? "anonymous" : record.nameStatus,
    rank: record.rank,
    year: record.year,
    institute: record.institute,
    marksObtained: record.marksObtained,
    sourceAvailable: record.sourceAvailable,
    sourceStatus: record.sourceStatus,
    pageNormalized: record.pageNormalized,
    pageStatus: record.pageStatus,
    summary: record.summary,
    summaryStatus: record.summary ? "available" : "missing",
    valueAdds: record.valueAdds,
  };
}

function isAnonymousTopper(value: string) {
  return !value || /^unknown topper$/i.test(value) || /^mapped topper$/i.test(value) || /^anonymous topper$/i.test(value);
}

function publicMatchReason(record: AcceptedAnswerLink) {
  if (record.matchType === "direct") return "Directly matched with the extracted question.";
  if (record.matchType === "strong") return "Strong overlap with the official question and syllabus area.";
  if (record.matchType === "topic-match") return "Same syllabus area with useful topic overlap.";
  return "Related syllabus area with usable topic overlap.";
}

function buildReviewQueues(records: TopperAnswerRecord[], ambiguousOfficialMatches: unknown[]) {
  const missingPdfQueue = records
    .filter((record) => record.sourceStatus === "not_uploaded")
    .map(compactAnswerRecord);

  const pageReviewQueue = records
    .filter((record) => record.pageStatus !== "valid")
    .map(compactAnswerRecord);

  const duplicateGroups = new Map<string, TopperAnswerRecord[]>();
  for (const record of records) {
    if (!record.sourceUrl || !record.pageNormalized) continue;
    const key = `${record.sourceUrl}|${record.pageNormalized}`;
    const bucket = duplicateGroups.get(key) || [];
    bucket.push(record);
    duplicateGroups.set(key, bucket);
  }

  const duplicateSourcePageQueue = [...duplicateGroups.values()]
    .filter((bucket) => bucket.length > 1)
    .map((bucket) => ({
      sourceUrl: bucket[0].sourceUrl,
      page: bucket[0].pageNormalized,
      count: bucket.length,
      examples: bucket.slice(0, 8).map(compactAnswerRecord),
    }));

  return {
    ambiguousOfficialMatches,
    missingPdfQueue,
    pageReviewQueue,
    duplicateSourcePageQueue,
  };
}

function compactAnswerRecord(record: TopperAnswerRecord) {
  return {
    answerId: record.answerId,
    cardId: record.cardId,
    extractedQuestion: record.extractedQuestion,
    topperName: record.topperName,
    originalFilename: record.originalFilename,
    sourceStatus: record.sourceStatus,
    pageRaw: record.pageRaw,
    pageNormalized: record.pageNormalized,
    pageStatus: record.pageStatus,
  };
}

function isUsableExtractedQuestion(value: string) {
  const clean = normalizeQuestion(value);
  if (clean.length < 32) return false;
  return tokens(value).length >= 4;
}

function isEssayRow(row: ReturnType<typeof loadOfficialRows>[number]) {
  return row.subjectKey === "essay" || row.paper.toLowerCase() === "essay" || row.category.toLowerCase() === "essay";
}

function semanticOverlaps(row: ReturnType<typeof loadOfficialRows>[number], card: PyqCard) {
  const officialTerms = new Set(topicTokensForOfficial(row));
  const mappedTerms = cardSemanticTokens(card);
  return [...officialTerms].filter((token) => mappedTerms.has(token)).slice(0, 8);
}

function cardSemanticTokens(card: PyqCard) {
  const cached = CARD_SEMANTIC_CACHE.get(card.id);
  if (cached) return cached;

  const value = new Set(tokens([card.question, ...card.syllabusTags, ...card.keywords, card.category].join(" ")));
  CARD_SEMANTIC_CACHE.set(card.id, value);
  return value;
}

function topicTokensForOfficial(row: ReturnType<typeof loadOfficialRows>[number]) {
  return cleanTopicTokens([...row.syllabusTags, ...row.keywords, row.category].join(" "));
}

function cardTopicTokens(card: PyqCard) {
  return new Set(cleanTopicTokens([card.question, ...card.syllabusTags, ...card.keywords, card.category].join(" ")));
}

function cleanTopicTokens(value: string) {
  return tokens(value)
    .filter((token) => !SUBJECT_NOISE.has(token))
    .filter((token) => !ANCHOR_NOISE.has(token))
    .filter((token) => !/^\d{1,2}$/.test(token));
}

function isSubjectSignal(row: ReturnType<typeof loadOfficialRows>[number], card: PyqCard) {
  const paper = card.paper.toLowerCase().replace(/[^a-z0-9]/g, "");
  return row.subjectKey === paper || card.category.toLowerCase().replace(/\s+/g, "") === row.subjectKey;
}

function matchedStrongAnchors(officialQuestion: string, mappedQuestion: string, idf: Map<string, number>) {
  const officialTokens = tokens(officialQuestion);
  const mappedText = ` ${tokens(mappedQuestion).join(" ")} `;
  const anchors = new Set<string>();

  for (const size of [3, 2]) {
    for (let index = 0; index <= officialTokens.length - size; index += 1) {
      const phraseTokens = officialTokens.slice(index, index + size);
      if (phraseTokens.some((token) => STOP_WORDS.has(token))) continue;
      const phrase = phraseTokens.join(" ");
      const phraseWeight = phraseTokens.reduce((sum, token) => sum + weight(token, idf), 0) / size;
      if (!isSpecificAnchor(phraseTokens, idf)) continue;
      if (phraseWeight < 2.2 && !phraseTokens.some((token) => token.length >= 8)) continue;
      if (mappedText.includes(` ${phrase} `)) anchors.add(phrase);
    }
  }

  return [...anchors].slice(0, 8);
}

function isSpecificAnchor(phraseTokens: string[], idf: Map<string, number>) {
  return phraseTokens.some((token) => {
    if (/^\d{2,4}$/.test(token)) return true;
    if (ANCHOR_NOISE.has(token) || SUBJECT_NOISE.has(token)) return false;
    return token.length >= 5 || weight(token, idf) >= 2.4;
  });
}

function explainScore(score: Score) {
  const parts = [];
  if (score.strongAnchorMatches.length) parts.push(`shared anchor: ${score.strongAnchorMatches.slice(0, 3).join(", ")}`);
  if (score.semanticHits.length) parts.push(`shared topic: ${score.semanticHits.slice(0, 3).join(", ")}`);
  if (score.topicOverlap >= THRESHOLD.topicMatch) parts.push(`topic overlap ${Math.round(score.topicOverlap * 100)}%`);
  parts.push(`token cover ${Math.round(score.officialCover * 100)}%`);
  return parts.join("; ");
}

function buildIdf(texts: string[]) {
  const df = new Map<string, number>();
  for (const text of texts) {
    for (const token of new Set(tokens(text))) {
      df.set(token, (df.get(token) || 0) + 1);
    }
  }

  const total = texts.length || 1;
  const idf = new Map<string, number>();
  for (const [token, count] of df.entries()) {
    idf.set(token, Math.log((total + 1) / (count + 1)) + 1);
  }
  return idf;
}

function weight(token: string, idf: Map<string, number>) {
  return idf.get(token) || 1;
}

function tokens(value: string) {
  const key = String(value || "");
  const cached = TOKEN_CACHE.get(key);
  if (cached) return cached;

  const out = normalizeQuestion(key)
    .split(" ")
    .map(stem)
    .filter((token) => (token.length >= 3 || /^\d{2,4}$/.test(token)) && !STOP_WORDS.has(token));
  TOKEN_CACHE.set(key, out);
  return out;
}

function stem(token: string) {
  let value = token
    .replace(/isation$/, "ization")
    .replace(/isations$/, "ization")
    .replace(/analys$/, "analysis")
    .replace(/^nineteenth$/, "19th")
    .replace(/^twentieth$/, "20th");

  if (value.length > 6 && value.endsWith("ies")) value = `${value.slice(0, -3)}y`;
  else if (value.length > 7 && value.endsWith("ing")) value = value.slice(0, -3);
  else if (value.length > 6 && value.endsWith("ed")) value = value.slice(0, -2);
  else if (value.length > 5 && value.endsWith("s") && !value.endsWith("ss")) value = value.slice(0, -1);
  return value;
}

function normalizeQuestion(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\([^)]*\b\d{1,3}\s*marks?[^)]*\)/gi, "")
    .replace(/\[[^\]]*\b\d{1,3}\s*marks?[^\]]*\]/gi, "")
    .replace(/\b\d{1,3}\s*marks?(?:\s*\/\s*\d+\s*words?)?\b/gi, "")
    .replace(/^\s*q\.?\s*\d{0,2}\s*[a-e]?\s*[.)\]:-]?\s*/i, "")
    .replace(/^\s*qa?\s*[.)\]:-]?\s*/i, "")
    .replace(/^\s*\d{1,2}\s*[.)\]:-]\s*/i, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

main();
