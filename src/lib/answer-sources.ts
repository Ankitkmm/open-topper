import { readFileSync } from "fs";
import { join } from "path";
import type { NextRequest } from "next/server";
import { APP_DATA_DIR } from "@/lib/paths";

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

let cachedSources: AnswerSourceDataset | null = null;
let cachedR2Map: Record<string, string> | null = null;

export const ANSWER_SOURCE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

export function isValidAnswerId(answerId: string) {
  return /^ans_[a-f0-9]{16}$/.test(answerId);
}

export function getResolvedAnswerSource(answerId: string) {
  const record = loadAnswerSources().sources[answerId];
  const sourceUrl = resolvePublishedUrl(record?.url || "");
  if (!record || !sourceUrl) return null;

  return {
    record,
    sourceUrl,
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
  try {
    cachedSources = JSON.parse(readFileSync(join(APP_DATA_DIR, "answer-sources.json"), "utf-8")) as AnswerSourceDataset;
  } catch {
    cachedSources = { sources: {} };
  }
  return cachedSources;
}

function loadR2Map() {
  if (cachedR2Map) return cachedR2Map;
  try {
    cachedR2Map = JSON.parse(readFileSync(join(APP_DATA_DIR, "pdf-r2-map.json"), "utf-8")) as Record<string, string>;
  } catch {
    cachedR2Map = {};
  }
  return cachedR2Map;
}

function resolvePublishedUrl(rawUrl: string) {
  const url = String(rawUrl || "").trim();
  if (!url) return null;
  if (isR2Url(url)) return url;
  if (isDirectPdfUrl(url)) return url;

  const driveId = url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/)?.[1]
    || url.match(/\/drive_([^/?#]+?)\.pdf(?:[?#]|$)/)?.[1];
  if (!driveId) return null;

  const mapped = loadR2Map()[driveId];
  return mapped && isR2Url(mapped) ? mapped : null;
}

function isR2Url(url: string) {
  return url.includes(".r2.dev") || url.includes(".r2.cloudflarestorage.com");
}

function isDirectPdfUrl(url: string) {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    return /\.pdf$/i.test(new URL(url).pathname);
  } catch {
    return /\.pdf(?:[?#]|$)/i.test(url);
  }
}
