import { NextRequest } from "next/server";
import { getRateLimitWindowMs, getSearchRateLimitMax } from "@/lib/env";
import { getWorkspaceQuestionById } from "@/lib/question-bank";
import { checkRateLimit } from "@/lib/rate-limit";
import { PRIVATE_JSON_HEADERS, requireSessionResponseIfConfigured } from "@/lib/session-access";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ questionId: string }> },
) {
  const sessionError = await requireSessionResponseIfConfigured();
  if (sessionError) return sessionError;

  const limitState = await checkRateLimit(req, {
    scope: "questions-detail",
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

  const { questionId } = await params;
  const record = getWorkspaceQuestionById(questionId);
  if (!record) {
    return Response.json({ error: "Question not found." }, { status: 404, headers: PRIVATE_JSON_HEADERS });
  }

  return Response.json({
    id: record.id,
    question: record.question,
    paper: record.paper,
    category: record.category,
    subjectKey: record.subjectKey,
    subjectLabel: record.subjectLabel,
    estimatedYear: record.estimatedYear,
    marks: record.marks,
    syllabusNodeId: record.syllabusNodeId,
    syllabusPath: record.syllabusPath,
    topperCount: record.topperCount,
  }, { headers: PRIVATE_JSON_HEADERS });
}
