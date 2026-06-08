import { randomBytes } from "crypto";
import type { NextRequest } from "next/server";
import {
  ANSWER_SOURCE_HEADERS,
  getResolvedAnswerSource,
  isSameOriginRequest,
  isValidAnswerId,
} from "./answer-sources";
import {
  assertProductionPdfSecrets,
  getPdfRateLimitMax,
  getPdfTokenTtlSeconds,
  getRateLimitWindowMs,
  isProductionLikeRuntime,
  secureEquals,
  signValue,
} from "./env";
import { normalizePublicTopperName } from "./public-records";
import { checkRateLimit } from "./rate-limit";

type PdfTokenPayload = {
  answerId: string;
  exp: number;
  iat: number;
  nonce: string;
  purpose: typeof PDF_TOKEN_PURPOSE;
  v: typeof PDF_TOKEN_VERSION;
};

const PDF_TOKEN_PURPOSE = "pdf-source" as const;
const PDF_TOKEN_VERSION = 1 as const;
const PDF_TOKEN_CLOCK_SKEW_SECONDS = 30;
const PDF_TOKEN_COOKIE_PREFIX = "upscat_pdf_";
const PDF_TOKEN_BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const PDF_TOKEN_SIGNATURE_RE = /^[a-f0-9]{64}$/;
const PDF_RANGE_RE = /^bytes=(\d*)-(\d*)$/;
const PDF_CONTENT_RANGE_RE = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i;
const MAX_PDF_RANGE_SPAN_BYTES = 32 * 1024 * 1024;
const ALLOWED_PDF_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/octet-stream",
  "binary/octet-stream",
]);

export function issuePdfAccessToken(answerId: string) {
  assertProductionPdfSecrets();
  const now = Math.floor(Date.now() / 1000);
  const payload: PdfTokenPayload = {
    answerId,
    exp: now + getPdfTokenTtlSeconds(),
    iat: now,
    nonce: randomBytes(16).toString("base64url"),
    purpose: PDF_TOKEN_PURPOSE,
    v: PDF_TOKEN_VERSION,
  };

  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = signValue(body);
  return `${body}.${sig}`;
}

export function verifyPdfAccessToken(token: string, answerId: string) {
  assertProductionPdfSecrets();
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false as const, error: "Invalid token." };
  const [body, signature] = parts;
  if (!body || !signature) return { ok: false as const, error: "Invalid token." };
  if (!PDF_TOKEN_BASE64URL_RE.test(body) || !PDF_TOKEN_SIGNATURE_RE.test(signature)) {
    return { ok: false as const, error: "Invalid token." };
  }

  const expected = signValue(body);
  if (!secureEquals(signature, expected)) return { ok: false as const, error: "Invalid token signature." };

  let payload: Partial<PdfTokenPayload>;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<PdfTokenPayload>;
  } catch {
    return { ok: false as const, error: "Malformed token." };
  }

  if (!isValidPdfTokenPayload(payload)) return { ok: false as const, error: "Malformed token." };
  if (payload.answerId !== answerId) return { ok: false as const, error: "Token answer mismatch." };
  if (!isValidAnswerId(payload.answerId)) return { ok: false as const, error: "Malformed token." };

  const now = Math.floor(Date.now() / 1000);
  if (payload.iat > now + PDF_TOKEN_CLOCK_SKEW_SECONDS) return { ok: false as const, error: "Token issued in the future." };
  if (payload.exp < now) return { ok: false as const, error: "Token expired." };
  if (payload.exp - payload.iat > getPdfTokenTtlSeconds() + PDF_TOKEN_CLOCK_SKEW_SECONDS) {
    return { ok: false as const, error: "Token lifetime is invalid." };
  }

  return { ok: true as const, payload };
}

export function getPdfTokenCookieName(answerId: string) {
  return `${PDF_TOKEN_COOKIE_PREFIX}${isValidAnswerId(answerId) ? answerId : "invalid"}`;
}

export function getPdfAccessTokenFromRequest(req: NextRequest, answerId: string) {
  return req.cookies.get(getPdfTokenCookieName(answerId))?.value || "";
}

export async function enforcePdfAccess(
  req: NextRequest,
  answerId: string,
  options?: { skipOriginCheck?: boolean },
) {
  if (!options?.skipOriginCheck && !isSameOriginRequest(req)) {
    return Response.json({ error: "This PDF can only be opened from UPSCat." }, { status: 403, headers: ANSWER_SOURCE_HEADERS });
  }

  if (!isValidAnswerId(answerId)) {
    return Response.json({ error: "Invalid answer id." }, { status: 400, headers: ANSWER_SOURCE_HEADERS });
  }

  const limit = await checkRateLimit(req, {
    scope: "pdf",
    max: getPdfRateLimitMax(),
    windowMs: getRateLimitWindowMs(),
  });
  if (!limit.ok) {
    return Response.json({ error: "Too many PDF requests. Please slow down." }, { status: 429, headers: rateLimitHeaders(limit.resetAt) });
  }

  return null;
}

export function resolvePdfSourceForToken(answerId: string, token: string) {
  const verified = verifyPdfAccessToken(token, answerId);
  if (!verified.ok) return { ok: false as const, status: 403, error: verified.error };

  const source = getResolvedAnswerSource(answerId);
  if (!source.ok) {
    return {
      ok: false as const,
      status: source.kind === "runtime" ? 500 : 404,
      error: source.kind === "runtime" ? source.error : "Source not available.",
    };
  }

  return {
    ok: true as const,
    source,
  };
}

export function buildPdfEmbedResponse(answerId: string) {
  const source = getResolvedAnswerSource(answerId);
  if (!source.ok) {
    return {
      ok: false as const,
      status: source.kind === "runtime" ? 500 : 404,
      error: source.kind === "runtime" ? source.error : "Source not available.",
    };
  }

  const token = issuePdfAccessToken(answerId);
  return {
    ok: true as const,
    payload: {
      viewerUrl: `/pdf/${answerId}?page=${source.page}`,
      embedUrl: `/pdf/${answerId}?page=${source.page}`,
      page: source.page,
      pageStatus: source.record.pageStatus || null,
      sourceStatus: source.record.sourceStatus || null,
      topperName: normalizePublicTopperName(source.record.topperName),
      rank: source.record.rank,
      year: source.record.year,
      token,
      tokenTtlSeconds: getPdfTokenTtlSeconds(),
    },
  };
}

export function buildPdfTokenCookieHeader(answerId: string, token: string) {
  const parts = [
    `${getPdfTokenCookieName(answerId)}=${token}`,
    "Path=/",
    `Max-Age=${getPdfTokenTtlSeconds()}`,
    "HttpOnly",
    "SameSite=Lax",
  ];

  if (isProductionLikeRuntime()) parts.push("Secure");
  return parts.join("; ");
}

export function isValidPdfRangeHeader(range: string) {
  const match = range.match(PDF_RANGE_RE);
  if (!match) return false;

  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) return false;
  const start = parsePdfInteger(startRaw);
  const end = parsePdfInteger(endRaw);
  if (startRaw && start === null) return false;
  if (endRaw && end === null) return false;

  if (start === null) {
    if (end === null || end <= 0) return false;
    return end <= MAX_PDF_RANGE_SPAN_BYTES;
  }

  if (end !== null) {
    if (start > end) return false;
    return end - start + 1 <= MAX_PDF_RANGE_SPAN_BYTES;
  }

  return true;
}

export function isAllowedPdfContentType(contentType: string | null) {
  if (!contentType) return false;
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
  return Boolean(mediaType && ALLOWED_PDF_CONTENT_TYPES.has(mediaType));
}

export function isValidPdfContentRange(contentRange: string | null) {
  const match = contentRange?.trim().match(PDF_CONTENT_RANGE_RE);
  if (!match) return false;

  const [, startRaw, endRaw, totalRaw] = match;
  const start = parsePdfInteger(startRaw);
  const end = parsePdfInteger(endRaw);
  if (start === null || end === null || start > end) return false;
  if (end - start + 1 > MAX_PDF_RANGE_SPAN_BYTES) return false;
  if (totalRaw === "*") return true;

  const total = parsePdfInteger(totalRaw);
  return total !== null && total > 0 && end < total;
}

function parsePdfInteger(value: string | undefined) {
  if (!value) return null;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function rateLimitHeaders(resetAt: number) {
  const headers = new Headers(ANSWER_SOURCE_HEADERS);
  headers.set("Retry-After", String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))));
  return headers;
}

function isValidPdfTokenPayload(payload: Partial<PdfTokenPayload>): payload is PdfTokenPayload {
  return payload !== null
    && typeof payload === "object"
    && payload.purpose === PDF_TOKEN_PURPOSE
    && payload.v === PDF_TOKEN_VERSION
    && typeof payload.answerId === "string"
    && Number.isInteger(payload.iat)
    && Number.isInteger(payload.exp)
    && typeof payload.nonce === "string"
    && /^[A-Za-z0-9_-]{16,64}$/.test(payload.nonce);
}
