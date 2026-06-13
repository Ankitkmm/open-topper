import { NextRequest } from "next/server";
import {
  ANSWER_SOURCE_HEADERS,
} from "@/lib/answer-sources";
import { getAnswerSourceRateLimitMax, getRateLimitWindowMs } from "@/lib/env";
import { readBoundedJson, requireJsonMutationRequest } from "@/lib/request-guards";
import { buildPdfEmbedResponse, buildPdfTokenCookieHeader, enforcePdfAccess } from "@/lib/pdf-access";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireSessionResponseIfConfigured } from "@/lib/session-access";

export async function POST(req: NextRequest) {
  const requestError = requireJsonMutationRequest(req, 1024);
  if (requestError) return requestError;

  const issueLimit = await checkRateLimit(req, {
    scope: "answer-source",
    max: getAnswerSourceRateLimitMax(),
    windowMs: getRateLimitWindowMs(),
  });
  if (!issueLimit.ok) {
    const headers = new Headers(ANSWER_SOURCE_HEADERS);
    headers.set("Retry-After", String(Math.max(1, Math.ceil((issueLimit.resetAt - Date.now()) / 1000))));
    return Response.json({ error: "Too many PDF open requests. Please slow down." }, { status: 429, headers });
  }

  const bodyResult = await readBoundedJson<{ answerId?: unknown }>(req, 1024);
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.value;

  const answerId = typeof body.answerId === "string" ? body.answerId : "";
  const accessError = await enforcePdfAccess(req, answerId);
  if (accessError) return accessError;
  const sessionError = await requireSessionResponseIfConfigured();
  if (sessionError) return sessionError;

  const payload = await buildPdfEmbedResponse(answerId);
  if (!payload.ok) {
    return Response.json({ error: payload.error }, { status: payload.status, headers: ANSWER_SOURCE_HEADERS });
  }

  const headers = new Headers(ANSWER_SOURCE_HEADERS);
  headers.set("Set-Cookie", buildPdfTokenCookieHeader(answerId, payload.payload.token));
  const { token: _token, ...publicPayload } = payload.payload;
  void _token;

  return Response.json(
    publicPayload,
    { headers },
  );
}

export async function GET() {
  const headers = new Headers(ANSWER_SOURCE_HEADERS);
  headers.set("Allow", "POST");
  return Response.json(
    { error: "Use the source-page button on a verified answer signal." },
    { status: 405, headers },
  );
}
