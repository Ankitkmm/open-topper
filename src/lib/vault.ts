import { readFileSync } from "fs";
import { join } from "path";
import { APP_VAULT_DIR } from "./paths";

const VAULT_DIR = APP_VAULT_DIR;

export interface VaultDocument {
  id: string;
  title: string;
  sourceType: "complete" | "master" | "page" | "unknown";
  topperName: string | null;
  rank: number | null;
  institute: string | null;
  subject: string | null;
  testName: string | null;
  pageCount: number;
  textPages: number;
  wordCount: number;
  diagramCount: number;
  remarkCount: number;
  questionCount: number;
  scoreCount: number;
  totalScore: number | null;
  maxMarks: number | null;
  concepts: string[];
  topAssets: string[];
  interpretation: string;
  valueAddSummary: string[];
  questionSamples: string[];
  hasSource: boolean;
}

export interface VaultChunk {
  id: string;
  docId: string;
  page: number | null;
  title: string;
  topperName: string | null;
  subject: string | null;
  institute: string | null;
  sourceType: "complete" | "master" | "page" | "unknown";
  interpretation: string;
  wordCount: number;
  hasDiagram: boolean;
  hasRemarks: boolean;
  concepts: string[];
  questions: string[];
  assets: string[];
}

export interface VaultConcept {
  name: string;
  documentCount: number;
  chunkCount: number;
  subjects: string[];
}

export interface VaultIndex {
  generatedAt: string;
  inputDir: string;
  documents: number;
  chunks: number;
  totalWords: number;
  completeFiles: number;
  masterFiles: number;
  pageFiles: number;
  diagrams: number;
  remarks: number;
  questions: number;
  concepts: VaultConcept[];
  subjects: { name: string; count: number }[];
  institutes: { name: string; count: number }[];
}

export interface VaultSearchParams {
  q?: string;
  subject?: string;
  concept?: string;
  topper?: string;
  institute?: string;
  hasDiagram?: boolean;
  hasRemarks?: boolean;
  sourceType?: string;
  offset?: number;
  limit?: number;
}

export interface VaultSearchResult {
  documents: VaultDocument[];
  chunks: (VaultChunk & { score: number })[];
  totalDocuments: number;
  totalChunks: number;
  facets: {
    subjects: { name: string; count: number }[];
    institutes: { name: string; count: number }[];
    concepts: { name: string; count: number }[];
  };
}

let cachedDocuments: VaultDocument[] | null = null;
let cachedChunks: VaultChunk[] | null = null;
let cachedConcepts: VaultConcept[] | null = null;
let cachedIndex: VaultIndex | null = null;

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(join(VAULT_DIR, file), "utf-8")) as T;
  } catch {
    return fallback;
  }
}

export function loadVaultDocuments(): VaultDocument[] {
  if (cachedDocuments) return cachedDocuments;
  cachedDocuments = readJson<VaultDocument[]>("documents.json", []);
  return cachedDocuments;
}

export function loadVaultChunks(): VaultChunk[] {
  if (cachedChunks) return cachedChunks;
  cachedChunks = readJson<VaultChunk[]>("chunks.json", []);
  return cachedChunks;
}

export function loadVaultConcepts(): VaultConcept[] {
  if (cachedConcepts) return cachedConcepts;
  cachedConcepts = readJson<VaultConcept[]>("concepts.json", []);
  return cachedConcepts;
}

export function loadVaultIndex(): VaultIndex {
  if (cachedIndex) return cachedIndex;
  cachedIndex = readJson<VaultIndex>("index.json", {
    generatedAt: "",
    inputDir: "",
    documents: 0,
    chunks: 0,
    totalWords: 0,
    completeFiles: 0,
    masterFiles: 0,
    pageFiles: 0,
    diagrams: 0,
    remarks: 0,
    questions: 0,
    concepts: [],
    subjects: [],
    institutes: [],
  });
  return cachedIndex;
}

export function getVaultDocument(id: string): VaultDocument | null {
  return loadVaultDocuments().find((doc) => doc.id === id) || null;
}

export function getVaultDocumentChunks(id: string): VaultChunk[] {
  return loadVaultChunks().filter((chunk) => chunk.docId === id);
}

export function searchVault(params: VaultSearchParams): VaultSearchResult {
  const limit = clamp(params.limit ?? 24, 1, 80);
  const offset = Math.max(0, params.offset ?? 0);
  const query = normalize(params.q || "");
  const terms = query.split(/\s+/).filter((term) => term.length > 1);

  let documents = loadVaultDocuments();
  let chunks = loadVaultChunks();

  documents = documents.filter((doc) => docMatchesFilters(doc, params));
  chunks = chunks.filter((chunk) => chunkMatchesFilters(chunk, params));

  const scoredDocuments = documents
    .map((doc) => ({ doc, score: scoreDocument(doc, terms, params.concept) }))
    .filter((item) => terms.length === 0 || item.score > 0)
    .sort((a, b) => b.score - a.score || b.doc.wordCount - a.doc.wordCount);

  const scoredChunks = chunks
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, terms, params.concept) }))
    .filter((item) => terms.length === 0 || item.score > 0)
    .sort((a, b) => b.score - a.score || b.chunk.wordCount - a.chunk.wordCount);

  const facets = buildFacets(scoredDocuments.map((item) => item.doc));

  return {
    documents: scoredDocuments.slice(offset, offset + limit).map((item) => item.doc),
    chunks: scoredChunks.slice(0, Math.min(18, limit)).map((item) => ({ ...item.chunk, score: item.score })),
    totalDocuments: scoredDocuments.length,
    totalChunks: scoredChunks.length,
    facets,
  };
}

function docMatchesFilters(doc: VaultDocument, params: VaultSearchParams): boolean {
  if (params.subject && doc.subject !== params.subject) return false;
  if (params.institute && doc.institute !== params.institute) return false;
  if (params.sourceType && doc.sourceType !== params.sourceType) return false;
  if (params.topper && !normalize(doc.topperName || "").includes(normalize(params.topper))) return false;
  if (params.concept && !doc.concepts.some((concept) => concept.toLowerCase() === params.concept!.toLowerCase())) return false;
  if (params.hasDiagram && doc.diagramCount === 0) return false;
  if (params.hasRemarks && doc.remarkCount === 0) return false;
  return true;
}

function chunkMatchesFilters(chunk: VaultChunk, params: VaultSearchParams): boolean {
  if (params.subject && chunk.subject !== params.subject) return false;
  if (params.institute && chunk.institute !== params.institute) return false;
  if (params.sourceType && chunk.sourceType !== params.sourceType) return false;
  if (params.topper && !normalize(chunk.topperName || "").includes(normalize(params.topper))) return false;
  if (params.concept && !chunk.concepts.some((concept) => concept.toLowerCase() === params.concept!.toLowerCase())) return false;
  if (params.hasDiagram && !chunk.hasDiagram) return false;
  if (params.hasRemarks && !chunk.hasRemarks) return false;
  return true;
}

function scoreDocument(doc: VaultDocument, terms: string[], concept?: string): number {
  let score = concept ? 10 : 1;
  const haystack = normalize([
    doc.title,
    doc.topperName,
    doc.subject,
    doc.institute,
    doc.testName,
    doc.interpretation,
    doc.questionSamples.join(" "),
    doc.concepts.join(" "),
    doc.topAssets.join(" "),
    doc.valueAddSummary.join(" "),
  ].filter(Boolean).join(" "));

  for (const term of terms) {
    if (haystack.includes(term)) score += term.length > 4 ? 8 : 4;
    if (normalize(doc.title).includes(term)) score += 10;
    if (normalize(doc.topperName || "").includes(term)) score += 12;
    if (doc.concepts.some((conceptName) => normalize(conceptName).includes(term))) score += 8;
  }

  if (doc.totalScore) score += Math.min(8, doc.totalScore / 30);
  if (doc.diagramCount > 0) score += 1.5;
  if (doc.remarkCount > 0) score += 1.5;
  return score;
}

function scoreChunk(chunk: VaultChunk, terms: string[], concept?: string): number {
  let score = concept ? 8 : 1;
  const haystack = normalize([
    chunk.title,
    chunk.topperName,
    chunk.subject,
    chunk.institute,
    chunk.interpretation,
    chunk.concepts.join(" "),
    chunk.assets.join(" "),
    chunk.questions.join(" "),
  ].filter(Boolean).join(" "));

  for (const term of terms) {
    if (haystack.includes(term)) score += term.length > 4 ? 6 : 3;
    if (normalize(chunk.interpretation).includes(term)) score += 4;
    if (chunk.questions.some((question) => normalize(question).includes(term))) score += 10;
  }

  if (chunk.hasDiagram) score += 2;
  if (chunk.hasRemarks) score += 2;
  return score;
}

function buildFacets(documents: VaultDocument[]) {
  return {
    subjects: topCounts(documents.map((doc) => doc.subject).filter(Boolean) as string[], 20),
    institutes: topCounts(documents.map((doc) => doc.institute).filter(Boolean) as string[], 20),
    concepts: topCounts(documents.flatMap((doc) => doc.concepts), 30),
  };
}

function topCounts(values: string[], limit: number) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
