import { NextRequest } from "next/server";
import { getRateLimitWindowMs, getSearchRateLimitMax } from "@/lib/env";
import { getWorkspaceQuestionByIdAsync, toPublicWorkspaceQuestion } from "@/lib/question-bank-runtime";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireSameOriginRead } from "@/lib/request-guards";
import { PRIVATE_JSON_HEADERS, requireSessionResponseIfConfigured } from "@/lib/session-access";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ questionId: string }> },
) {
  const sameOriginError = requireSameOriginRead(req);
  if (sameOriginError) return sameOriginError;

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

  const sessionError = await requireSessionResponseIfConfigured();
  if (sessionError) return sessionError;

  const { questionId } = await params;
  const question = await getWorkspaceQuestionByIdAsync(questionId);
  if (!question) {
    return Response.json({ error: "Question not found." }, { status: 404, headers: PRIVATE_JSON_HEADERS });
  }

  return Response.json(toPublicWorkspaceQuestion(question), { headers: PRIVATE_JSON_HEADERS });
}
