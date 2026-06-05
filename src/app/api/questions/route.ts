import { NextRequest } from "next/server";
import { getRateLimitWindowMs, getSearchRateLimitMax } from "@/lib/env";
import { searchWorkspaceQuestions } from "@/lib/question-bank";
import { checkRateLimit } from "@/lib/rate-limit";
import { PRIVATE_JSON_HEADERS, requireSessionResponseIfConfigured } from "@/lib/session-access";
import { getSubjectKeyFromValue } from "@/lib/subject-definitions";

const PAGE_SIZE = 30;

export async function GET(req: NextRequest) {
  const sessionError = await requireSessionResponseIfConfigured();
  if (sessionError) return sessionError;

  const limitState = await checkRateLimit(req, {
    scope: "questions-list",
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

  const q = req.nextUrl.searchParams.get("q") || "";
  const category = req.nextUrl.searchParams.get("category") || "";
  const syllabusNodeId = req.nextUrl.searchParams.get("syllabusId") || "";
  const offset = Math.max(0, parseInt(req.nextUrl.searchParams.get("offset") || "0", 10));
  const limit = Math.min(60, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") || String(PAGE_SIZE), 10)));

  const subjectKey = getSubjectKeyFromValue(category);
  const results = searchWorkspaceQuestions({
    query: q,
    subjectKey: subjectKey || "",
    syllabusNodeId,
    limit: offset + limit,
  });
  const page = results.slice(offset, offset + limit);

  return Response.json(
    {
      questions: page.map((question) => ({
        id: question.id,
        question: question.question,
        subjectKey: question.subjectKey,
        subjectLabel: question.subjectLabel,
        syllabusPath: question.syllabusPath,
        category: question.category,
        paper: question.paper,
        estimatedYear: question.estimatedYear,
        marks: question.marks,
        topperCount: question.topperCount,
        sourceAvailableCount: question.linkedInsights.filter((copy) => copy.sourceAvailable).length,
      })),
      hasMore: offset + limit < results.length,
      total: results.length,
    },
    { headers: PRIVATE_JSON_HEADERS },
  );
}
