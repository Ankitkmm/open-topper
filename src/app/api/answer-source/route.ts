import { NextRequest } from "next/server";
import {
  ANSWER_SOURCE_HEADERS,
} from "@/lib/answer-sources";
import { getAnswerSourceRateLimitMax, getRateLimitWindowMs } from "@/lib/env";
import { buildPdfEmbedResponse, enforcePdfAccess } from "@/lib/pdf-access";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireSessionResponseIfConfigured } from "@/lib/session-access";

export async function POST(req: NextRequest) {
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

  let body: { answerId?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400, headers: ANSWER_SOURCE_HEADERS });
  }

  const answerId = typeof body.answerId === "string" ? body.answerId : "";
  const sessionError = await requireSessionResponseIfConfigured();
  if (sessionError) return sessionError;
  const accessError = await enforcePdfAccess(req, answerId);
  if (accessError) return accessError;

  const payload = buildPdfEmbedResponse(answerId);
  if (!payload.ok) {
    return Response.json({ error: payload.error }, { status: payload.status, headers: ANSWER_SOURCE_HEADERS });
  }

  return Response.json(
    payload.payload,
    { headers: ANSWER_SOURCE_HEADERS },
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
