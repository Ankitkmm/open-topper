import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { loadRuntimeJson } from "./runtime-data";
import { PUBLIC_TOPPER_NAME_FALLBACK, normalizePublicTopperName } from "./public-records";
import { bestTokenMatchScore, matchesSearchTerm, searchTerms, searchTokens } from "./search-text";
import { type SubjectKey, getSubjectDefinition, getSubjectDefinitions } from "./subject-definitions";

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

export type PublicWorkspaceCopy = WorkspaceCopy;

export type PublicWorkspaceQuestion = Omit<WorkspaceQuestion, "searchText"> & {
  searchText?: never;
};

export type WorkspaceQuestionShell = Omit<PublicWorkspaceQuestion, "linkedInsights"> & {
  linkedInsights: [];
};

export interface WorkspaceSyllabusNode {
  id: string;
  subjectKey: SubjectKey;
  label: string;
  parentId: string | null;
  order: number;
  kind: "group" | "topic";
  paper: string;
  isFallback?: boolean;
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

interface RuntimeDataManifest {
  datasets?: Record<string, {
    shards?: Array<{ file: string; key: string; count: number }>;
  }>;
}

const WORKSPACE_INDEX_FILE = join(process.cwd(), "data", "app", "workspace-index.json");
const RUNTIME_DATA_MANIFEST_FILE = join(process.cwd(), ".cloudflare-runtime-data", "manifest.json");
const RUNTIME_DATA_DIR = join(process.cwd(), ".cloudflare-runtime-data");
const QUESTION_SEARCH_TOKEN_CACHE = new Map<string, string[]>();

let cachedIndex: WorkspaceIndex | null = null;
let cachedIndexPromise: Promise<WorkspaceIndex> | null = null;

export function __setWorkspaceIndexForTests(snapshot: WorkspaceSnapshot | null) {
  QUESTION_SEARCH_TOKEN_CACHE.clear();
  cachedIndex = snapshot ? hydrateWorkspaceIndex(snapshot) : null;
}

export function getWorkspaceIndex() {
  if (cachedIndex) return cachedIndex;

  const snapshot = readJson<WorkspaceSnapshot | null>(WORKSPACE_INDEX_FILE, null);
  cachedIndex = hydrateWorkspaceIndex(snapshot ?? emptyWorkspaceSnapshot());
  return cachedIndex;
}

export async function getWorkspaceIndexAsync() {
  if (cachedIndex) return cachedIndex;
  if (cachedIndexPromise) return cachedIndexPromise;

  cachedIndexPromise = loadWorkspaceIndexAsync()
    .then((index) => {
      cachedIndex = index;
      return index;
    })
    .finally(() => {
      cachedIndexPromise = null;
    });

  return cachedIndexPromise;
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
    .sort(compareWorkspaceSearchEntries)
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

export function toPublicWorkspaceCopy(copy: WorkspaceCopy): PublicWorkspaceCopy {
  const publicTopperName = normalizePublicTopperName(copy.topperName);
  return {
    answerId: copy.answerId,
    topperName: publicTopperName ?? PUBLIC_TOPPER_NAME_FALLBACK,
    rank: copy.rank,
    year: copy.year,
    institute: copy.institute,
    marks: copy.marks,
    pageHint: copy.pageHint,
    pageStatus: copy.pageStatus,
    sourceAvailable: copy.sourceAvailable,
    sourceStatus: copy.sourceStatus,
    summary: copy.summary,
    summaryAvailable: copy.summaryAvailable,
    summarySource: copy.summarySource,
  };
}

export function toPublicWorkspaceQuestion(question: WorkspaceQuestion): PublicWorkspaceQuestion {
  return {
    id: question.id,
    question: question.question,
    paper: question.paper,
    category: question.category,
    subjectKey: question.subjectKey,
    subjectLabel: question.subjectLabel,
    estimatedYear: question.estimatedYear,
    marks: question.marks,
    syllabusNodeId: question.syllabusNodeId,
    syllabusPath: Array.isArray(question.syllabusPath) ? [...question.syllabusPath] : [],
    linkedInsights: Array.isArray(question.linkedInsights)
      ? question.linkedInsights.map(toPublicWorkspaceCopy)
      : [],
    topperCount: question.topperCount,
  };
}

export function toWorkspaceQuestionShell(question: WorkspaceQuestion): WorkspaceQuestionShell {
  return {
    id: question.id,
    question: question.question,
    paper: question.paper,
    category: question.category,
    subjectKey: question.subjectKey,
    subjectLabel: question.subjectLabel,
    estimatedYear: question.estimatedYear,
    marks: question.marks,
    syllabusNodeId: question.syllabusNodeId,
    syllabusPath: Array.isArray(question.syllabusPath) ? [...question.syllabusPath] : [],
    linkedInsights: [],
    topperCount: question.topperCount,
  };
}

export async function getSubjectWorkspaceQuestionsAsync(subjectKey: SubjectKey, query = "", syllabusNodeId = "") {
  const index = await getWorkspaceIndexAsync();
  const questions = index.questionsBySubject.get(subjectKey) || [];
  const terms = searchTerms(query);

  return questions.filter((question) => {
    if (syllabusNodeId && question.syllabusNodeId !== syllabusNodeId) return false;
    if (!terms.length) return true;
    return searchScore(question, terms) > 0;
  });
}

export async function searchWorkspaceQuestionsAsync(options: {
  query?: string;
  subjectKey?: SubjectKey | "";
  syllabusNodeId?: string;
  limit?: number;
}) {
  const { query = "", subjectKey = "", syllabusNodeId = "", limit = 80 } = options;
  const index = await getWorkspaceIndexAsync();
  const subjects = subjectKey ? [subjectKey] : getSubjectDefinitions().map((definition) => definition.key);
  const terms = searchTerms(query);

  let matches = subjects.flatMap((key) => index.questionsBySubject.get(key) || []);
  if (syllabusNodeId) matches = matches.filter((question) => question.syllabusNodeId === syllabusNodeId);

  if (!terms.length) return matches.slice(0, limit);

  return matches
    .map((question) => ({ question, score: searchScore(question, terms) }))
    .filter((entry) => entry.score > 0)
    .sort(compareWorkspaceSearchEntries)
    .slice(0, limit)
    .map((entry) => entry.question);
}

export async function getWorkspaceSyllabusNodesAsync(subjectKey: SubjectKey) {
  const nodes = (await getWorkspaceIndexAsync()).syllabusNodesBySubject.get(subjectKey) || [];
  const primary = nodes.filter((node) => !node.isFallback);
  return primary.length ? primary : nodes;
}

export async function getWorkspaceNodeAsync(nodeId: string) {
  return (await getWorkspaceIndexAsync()).nodeById.get(nodeId) || null;
}

export async function getWorkspaceQuestionByIdAsync(questionId: string) {
  return (await getWorkspaceIndexAsync()).questions.find((question) => question.id === questionId) || null;
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
  return score;
}

function compareWorkspaceSearchEntries(
  left: { question: WorkspaceQuestion; score: number },
  right: { question: WorkspaceQuestion; score: number },
) {
  return right.score - left.score
    || right.question.topperCount - left.question.topperCount
    || left.question.question.localeCompare(right.question.question);
}

function questionSearchTokens(question: WorkspaceQuestion) {
  const cached = QUESTION_SEARCH_TOKEN_CACHE.get(question.id);
  if (cached) return cached;
  const tokens = searchTokens([question.question, question.searchText, question.syllabusPath.join(" ")].join(" "));
  QUESTION_SEARCH_TOKEN_CACHE.set(question.id, tokens);
  return tokens;
}

async function loadWorkspaceIndexAsync() {
  const sharded = await loadShardedWorkspaceSnapshot();
  if (sharded) return hydrateWorkspaceIndex(normalizeWorkspaceSnapshot(sharded));

  const result = await loadRuntimeJson<WorkspaceSnapshot>({
    key: "workspace-index.json",
    localPath: WORKSPACE_INDEX_FILE,
    label: "workspace-index",
  });

  if (result.ok) {
    return hydrateWorkspaceIndex(normalizeWorkspaceSnapshot(result.value));
  }

  return hydrateWorkspaceIndex(emptyWorkspaceSnapshot());
}

async function loadShardedWorkspaceSnapshot(): Promise<WorkspaceSnapshot | null> {
  const manifestResult = await loadRuntimeJson<RuntimeDataManifest>({
    key: "manifest.json",
    localPath: RUNTIME_DATA_MANIFEST_FILE,
    label: "runtime data manifest",
  });
  if (!manifestResult.ok) return null;

  const shards = manifestResult.value.datasets?.["workspace-index"]?.shards || [];
  if (!shards.length) return null;

  const metadataResult = await loadRuntimeJson<Partial<WorkspaceSnapshot>>({
    key: "workspace-index/metadata.json",
    localPath: join(RUNTIME_DATA_DIR, "workspace-index", "metadata.json"),
    label: "workspace-index metadata",
  });

  const questions: WorkspaceQuestion[] = [];
  for (const shard of shards) {
    const result = await loadRuntimeJson<unknown>({
      key: shard.file,
      localPath: join(RUNTIME_DATA_DIR, shard.file),
      label: `workspace-index shard ${shard.file}`,
    });
    if (!result.ok) return null;
    questions.push(...extractQuestionsFromWorkspaceShard(result.value));
  }

  return {
    generatedAt: metadataResult.ok && typeof metadataResult.value.generatedAt === "string"
      ? metadataResult.value.generatedAt
      : "",
    questions,
    syllabusNodes: metadataResult.ok && Array.isArray(metadataResult.value.syllabusNodes)
      ? metadataResult.value.syllabusNodes
      : [],
  };
}

function normalizeWorkspaceSnapshot(snapshot: WorkspaceSnapshot | null | undefined): WorkspaceSnapshot {
  if (!snapshot || typeof snapshot !== "object") return emptyWorkspaceSnapshot();

  const normalizedQuestions = Array.isArray(snapshot.questions)
    ? snapshot.questions
    : loadQuestionsFromLegacyShardRecord(snapshot as unknown as Record<string, unknown>);
  const normalizedNodes = Array.isArray(snapshot.syllabusNodes)
    ? snapshot.syllabusNodes
    : [];

  return {
    generatedAt: typeof snapshot.generatedAt === "string" ? snapshot.generatedAt : "",
    questions: normalizedQuestions,
    syllabusNodes: normalizedNodes,
  };
}

function loadQuestionsFromLegacyShardRecord(snapshot: Record<string, unknown>) {
  const questions = snapshot["questions"];
  if (Array.isArray(questions)) return questions as WorkspaceQuestion[];

  const maybeFirstShard = snapshot["0000"];
  if (Array.isArray(maybeFirstShard)) return maybeFirstShard as WorkspaceQuestion[];

  return [] as WorkspaceQuestion[];
}

function extractQuestionsFromWorkspaceShard(value: unknown): WorkspaceQuestion[] {
  if (Array.isArray(value)) return value as WorkspaceQuestion[];
  if (!value || typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  if (Array.isArray(record["questions"])) return record["questions"] as WorkspaceQuestion[];

  const values = Object.values(record);
  if (values.length && values.every((entry) => entry && typeof entry === "object" && !Array.isArray(entry))) {
    return values as WorkspaceQuestion[];
  }

  return [];
}

function emptyWorkspaceSnapshot(): WorkspaceSnapshot {
  return {
    generatedAt: "",
    questions: [],
    syllabusNodes: [],
  };
}
