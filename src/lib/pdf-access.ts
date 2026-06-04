import { createHash } from "crypto";
import type { NextRequest } from "next/server";
import {
  ANSWER_SOURCE_HEADERS,
  getResolvedAnswerSource,
  isSameOriginRequest,
  isValidAnswerId,
} from "./answer-sources";
import { getPdfRateLimitMax, getPdfTokenTtlSeconds, getRateLimitWindowMs, secureEquals, signValue } from "./env";
import { checkRateLimit } from "./rate-limit";

type PdfTokenPayload = {
  answerId: string;
  exp: number;
  nonce: string;
};

export function issuePdfAccessToken(answerId: string) {
  const payload: PdfTokenPayload = {
    answerId,
    exp: Math.floor(Date.now() / 1000) + getPdfTokenTtlSeconds(),
    nonce: createHash("sha256").update(`${answerId}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 16),
  };

  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = signValue(body);
  return `${body}.${sig}`;
}

export function verifyPdfAccessToken(token: string, answerId: string) {
  const [body, signature] = token.split(".");
  if (!body || !signature) return { ok: false as const, error: "Invalid token." };
  const expected = signValue(body);
  if (!secureEquals(signature, expected)) return { ok: false as const, error: "Invalid token signature." };

  let payload: PdfTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PdfTokenPayload;
  } catch {
    return { ok: false as const, error: "Malformed token." };
  }

  if (payload.answerId !== answerId) return { ok: false as const, error: "Token answer mismatch." };
  if (payload.exp < Math.floor(Date.now() / 1000)) return { ok: false as const, error: "Token expired." };
  return { ok: true as const, payload };
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
  if (!verified.ok) return verified;

  const source = getResolvedAnswerSource(answerId);
  if (!source) return { ok: false as const, error: "Source not available." };

  return {
    ok: true as const,
    source,
  };
}

export function buildPdfEmbedResponse(answerId: string) {
  const source = getResolvedAnswerSource(answerId);
  if (!source) return null;

  const token = issuePdfAccessToken(answerId);
  return {
    embedUrl: `/api/answer-source/${answerId}?token=${encodeURIComponent(token)}#page=${source.page}&toolbar=0&navpanes=0&scrollbar=0`,
    page: source.page,
    pageStatus: source.record.pageStatus || null,
    sourceStatus: source.record.sourceStatus || null,
    topperName: source.record.topperName,
    rank: source.record.rank,
    year: source.record.year,
    tokenTtlSeconds: getPdfTokenTtlSeconds(),
  };
}

function rateLimitHeaders(resetAt: number) {
  const headers = new Headers(ANSWER_SOURCE_HEADERS);
  headers.set("Retry-After", String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))));
  return headers;
}
