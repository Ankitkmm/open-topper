import { readFileSync } from "fs";
import { join } from "path";
import type { NextRequest } from "next/server";
import { getR2AllowedPublicHosts, getR2PublicUrl } from "./env";
import { PUBLIC_TOPPER_NAME_FALLBACK, normalizePublicTopperName } from "./public-records";

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
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
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
  const fetchSite = req.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  if (fetchSite === "none" && req.method !== "GET" && req.method !== "HEAD") return false;

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

  return fetchSite === "same-origin" || (fetchSite === "none" && (req.method === "GET" || req.method === "HEAD"));
}

export function toProxiedPdfUrl(answerId: string, page: number) {
  return `/api/answer-source/${answerId}#page=${page}&toolbar=0&navpanes=0&scrollbar=0`;
}

export function contentDispositionFilename(record: AnswerSourceRecord, answerId?: string) {
  const publicName = normalizePublicTopperName(record.topperName)
    || normalizePublicTopperName(record.filename)
    || normalizePublicTopperName(record.sourceFilename)
    || PUBLIC_TOPPER_NAME_FALLBACK;

  const pieces = [
    publicName,
    record.rank ? `AIR ${record.rank}` : "",
    record.year ? String(record.year) : "",
    answerId || record.questionId,
    record.page ? `p${record.page}` : "",
  ].filter(Boolean);

  const preferred = `${pieces.join(" ")}.pdf`;
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
  const directR2 = normalizeAllowedR2PdfUrl(url);
  if (directR2) return { ok: true as const, value: directR2 };

  const driveId = url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/)?.[1]
    || url.match(/\/drive_([^/?#]+?)\.pdf(?:[?#]|$)/)?.[1];
  if (!driveId || !isPlausibleDriveId(driveId)) return { ok: true as const, value: null };

  const r2Map = loadR2Map();
  if (!r2Map.ok) return { ok: false as const, kind: "runtime", error: r2Map.error };

  const mapped = r2Map.value[driveId];
  return { ok: true as const, value: mapped ? normalizeAllowedR2PdfUrl(mapped) : null };
}

export function normalizeAllowedR2PdfUrl(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.hash || parsed.search) return null;
  if (!isAllowedR2Hostname(parsed.hostname)) return null;
  if (!isSafePdfPathname(parsed.pathname)) return null;

  return parsed.href;
}

const DEFAULT_ALLOWED_R2_HOSTS = new Set([
  "pub-3476e7cc4efd44b58da659c67aad1348.r2.dev",
]);

function isAllowedR2Hostname(hostname: string) {
  const host = hostname.toLowerCase();
  const configuredHosts = configuredR2PublicHostnames();
  return configuredHosts.has(host) || DEFAULT_ALLOWED_R2_HOSTS.has(host);
}

function configuredR2PublicHostnames() {
  const hosts = new Set<string>();
  const publicUrl = getR2PublicUrl();
  if (publicUrl) {
    try {
      hosts.add(new URL(publicUrl).hostname.toLowerCase());
    } catch {
      // Ignore invalid configuration here; URL validation will fail closed.
    }
  }

  for (const host of getR2AllowedPublicHosts()) hosts.add(host);

  return hosts;
}

function isSafePdfPathname(pathname: string) {
  const lower = pathname.toLowerCase();
  if (!lower.endsWith(".pdf")) return false;
  if (lower.includes("%00") || lower.includes("%2f") || lower.includes("%5c")) return false;
  if (pathname.includes("\\")) return false;
  return true;
}

function isPlausibleDriveId(driveId: string) {
  return /^[A-Za-z0-9_-]{10,200}$/.test(driveId);
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
