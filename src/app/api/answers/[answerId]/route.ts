import { NextRequest } from "next/server";
import { getAnswerDetail } from "@/lib/db-search";
import { getRateLimitWindowMs, getSearchRateLimitMax } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";
import { PRIVATE_JSON_HEADERS, requireSessionResponseIfConfigured } from "@/lib/session-access";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ answerId: string }> },
) {
  const sessionError = await requireSessionResponseIfConfigured();
  if (sessionError) return sessionError;

  const limitState = await checkRateLimit(req, {
    scope: "answers-detail",
    max: getSearchRateLimitMax(),
    windowMs: getRateLimitWindowMs(),
  });
  if (!limitState.ok) {
    return Response.json({ error: "Too many requests. Please slow down." }, {
      status: 429,
      headers: {
        ...PRIVATE_JSON_HEADERS,
        "Retry-After": String(Math.max(1, Math.ceil((limitState.resetAt - Date.now()) / 1000))),
      },
    });
  }

  const { answerId } = await params;
  const record = await getAnswerDetail(answerId);
  if (!record) {
    return Response.json({ error: "Answer not found." }, { status: 404, headers: PRIVATE_JSON_HEADERS });
  }

  return Response.json(record, { headers: PRIVATE_JSON_HEADERS });
}
