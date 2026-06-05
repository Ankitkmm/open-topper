import { readFileSync } from "fs";
import { join } from "path";
import type { NextRequest } from "next/server";

export interface AnswerSourceRecord {
  url: string;
  page: number;
  questionId: string;
  topperName: string | null;
  rank: number | null;
  year: number | null;
  linkSource: string | null;
  pageStatus?: "valid" | "missing" | "fallback" | "out_of_range";
  pageSource?: string;
  sourceStatus?: string;
  filename?: string;
  sourceFilename?: string | null;
}

interface AnswerSourceDataset {
  sources: Record<string, AnswerSourceRecord>;
}

type RuntimeDataResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export type ResolvedAnswerSourceResult =
  | {
    ok: true;
    record: AnswerSourceRecord;
    sourceUrl: string;
    page: number;
  }
  | {
    ok: false;
    kind: "missing";
  }
  | {
    ok: false;
    kind: "runtime";
    error: string;
  };

const PDF_RUNTIME_DIR = join(process.cwd(), "data", "pdf-runtime");
const ANSWER_SOURCES_FILE = join(PDF_RUNTIME_DIR, "answer-sources.json");
const PDF_R2_MAP_FILE = join(PDF_RUNTIME_DIR, "pdf-r2-map.json");
const PDF_RUNTIME_DATA_ERROR = "PDF source dataset is unavailable on the server.";

let cachedSources: RuntimeDataResult<AnswerSourceDataset> | null = null;
let cachedR2Map: RuntimeDataResult<Record<string, string>> | null = null;
const loggedRuntimeDataFailures = new Set<string>();

export const ANSWER_SOURCE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

export function isValidAnswerId(answerId: string) {
  return /^ans_[a-f0-9]{16}$/.test(answerId);
}

export function getResolvedAnswerSource(answerId: string) {
  const sources = loadAnswerSources();
  if (!sources.ok) return { ok: false as const, kind: "runtime", error: sources.error };

  const record = sources.value.sources[answerId];
  if (!record) return { ok: false as const, kind: "missing" };

  const sourceUrl = resolvePublishedUrl(record.url || "");
  if (!sourceUrl.ok) return sourceUrl;
  if (!sourceUrl.value) return { ok: false as const, kind: "missing" };

  return {
    ok: true as const,
    record,
    sourceUrl: sourceUrl.value,
    page: Math.max(1, Math.floor(Number(record.page) || 1)),
  };
}

export function isSameOriginRequest(req: NextRequest) {
  const expected = req.nextUrl.origin;
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");

  if (origin) return origin === expected;
  if (referer) {
    try {
      return new URL(referer).origin === expected;
    } catch {
      return false;
    }
  }

  return false;
}

export function toProxiedPdfUrl(answerId: string, page: number) {
  return `/api/answer-source/${answerId}#page=${page}&toolbar=0&navpanes=0&scrollbar=0`;
}

export function contentDispositionFilename(record: AnswerSourceRecord) {
  const preferred = record.filename || `${record.topperName || "Name unavailable"} ${record.questionId}.pdf`;
  const clean = preferred
    .replace(/[^\w .()-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);

  return clean.toLowerCase().endsWith(".pdf") ? clean : `${clean || "topper-copy"}.pdf`;
}

function loadAnswerSources() {
  if (cachedSources) return cachedSources;
  cachedSources = loadRuntimeJson<AnswerSourceDataset>(ANSWER_SOURCES_FILE, "answer-sources");
  return cachedSources;
}

function loadR2Map() {
  if (cachedR2Map) return cachedR2Map;
  cachedR2Map = loadRuntimeJson<Record<string, string>>(PDF_R2_MAP_FILE, "pdf-r2-map");
  return cachedR2Map;
}

function resolvePublishedUrl(rawUrl: string) {
  const url = String(rawUrl || "").trim();
  if (!url) return { ok: true as const, value: null };
  if (isR2Url(url)) return { ok: true as const, value: url };

  const driveId = url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/)?.[1]
    || url.match(/\/drive_([^/?#]+?)\.pdf(?:[?#]|$)/)?.[1];
  if (!driveId) return { ok: true as const, value: null };

  const r2Map = loadR2Map();
  if (!r2Map.ok) return { ok: false as const, kind: "runtime", error: r2Map.error };

  const mapped = r2Map.value[driveId];
  return { ok: true as const, value: mapped && isR2Url(mapped) ? mapped : null };
}

function isR2Url(url: string) {
  return url.includes(".r2.dev") || url.includes(".r2.cloudflarestorage.com");
}

function loadRuntimeJson<T>(file: string, label: string): RuntimeDataResult<T> {
  try {
    return { ok: true, value: JSON.parse(readFileSync(file, "utf-8")) as T };
  } catch (error) {
    logRuntimeDataFailure(label, file, error);
    return { ok: false, error: PDF_RUNTIME_DATA_ERROR };
  }
}

function logRuntimeDataFailure(label: string, file: string, error: unknown) {
  const key = `${label}:${file}`;
  if (loggedRuntimeDataFailures.has(key)) return;
  loggedRuntimeDataFailures.add(key);
  console.error(`[pdf-runtime] Failed to load ${label} from ${file}`, error);
}
