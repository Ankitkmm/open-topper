import { NextRequest } from "next/server";
import { getRateLimitWindowMs, getSearchRateLimitMax } from "@/lib/env";
import { getWorkspaceQuestionById } from "@/lib/question-bank-runtime";
import { checkRateLimit } from "@/lib/rate-limit";
import { PRIVATE_JSON_HEADERS, requireSessionResponseIfConfigured } from "@/lib/session-access";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ questionId: string }> },
) {
  const sessionError = await requireSessionResponseIfConfigured();
  if (sessionError) return sessionError;

  const limit = await checkRateLimit(req, {
    scope: "detail-workspace",
    max: getSearchRateLimitMax(),
    windowMs: getRateLimitWindowMs(),
  });
  if (!limit.ok) {
    return Response.json({ error: "Too many requests. Please slow down." }, {
      status: 429,
      headers: {
        ...PRIVATE_JSON_HEADERS,
        "Retry-After": String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))),
      },
    });
  }

  const { questionId } = await params;
  const question = getWorkspaceQuestionById(questionId);
  if (!question) {
    return Response.json({ error: "Question not found." }, { status: 404, headers: PRIVATE_JSON_HEADERS });
  }

  return Response.json({
    ...question,
    searchText: undefined,
  }, { headers: PRIVATE_JSON_HEADERS });
}
