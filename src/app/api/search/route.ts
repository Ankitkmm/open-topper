import { NextRequest } from "next/server";
import { getRateLimitWindowMs, getSearchRateLimitMax } from "@/lib/env";
import {
  getOfficialBrowsePyqs,
  getOfficialQuestionShell,
  getOfficialSubjectPyqShells,
  searchOfficialBrowsePyqs,
  searchOfficialSubjectPyqs,
} from "@/lib/official-pyqs";
import { getWorkspaceQuestionShellById, searchHybridWorkspaceQuestions } from "@/lib/pyq";
import { searchWorkspaceQuestions } from "@/lib/question-bank";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSubjectKeyFromValue, type SubjectKey } from "@/lib/subject-definitions";

const PRIVATE_SEARCH_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
};

export async function GET(req: NextRequest) {
  const limitState = await checkRateLimit(req, {
    scope: "search",
    max: getSearchRateLimitMax(),
    windowMs: getRateLimitWindowMs(),
  });

  if (!limitState.ok) {
    return Response.json({ error: "Too many search requests. Please slow down." }, {
      status: 429,
      headers: {
        ...PRIVATE_SEARCH_HEADERS,
        "Retry-After": String(Math.max(1, Math.ceil((limitState.resetAt - Date.now()) / 1000))),
      },
    });
  }

  const dataset = req.nextUrl.searchParams.get("dataset") === "official" ? "official" : "workspace";
  const subject = req.nextUrl.searchParams.get("subject") || "";
  const subjectKey = getSubjectKeyFromValue(subject);
  const questionId = req.nextUrl.searchParams.get("questionId") || "";
  const syllabusId = req.nextUrl.searchParams.get("syllabusId") || req.nextUrl.searchParams.get("syllabus") || "";
  const limit = Math.min(120, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") || "40", 10)));
  const query = req.nextUrl.searchParams.get("q") || "";

  const results = dataset === "official"
    ? await searchOfficialShells({ query, subject, subjectKey, questionId, syllabusId, limit })
    : await searchWorkspaceShells({ query, subjectKey: subjectKey || "", questionId, syllabusId, limit });

  return Response.json({
    dataset,
    total: results.length,
    nextCursor: null,
    query,
    results,
  }, {
    headers: PRIVATE_SEARCH_HEADERS,
  });
}

async function searchOfficialShells(options: {
  query: string;
  subject: string;
  subjectKey: SubjectKey | null;
  questionId: string;
  syllabusId: string;
  limit: number;
}) {
  if (options.questionId.trim()) {
    const shell = getOfficialQuestionShell(options.questionId.trim());
    return shell ? [shell] : [];
  }

  const category = options.subjectKey || options.subject.trim().toLowerCase();

  if (options.subjectKey) {
    return options.query.trim()
      ? searchOfficialSubjectPyqs(options.subjectKey, options.query, options.limit, options.syllabusId)
      : getOfficialSubjectPyqShells(options.subjectKey, "", options.limit, options.syllabusId);
  }

  return options.query.trim()
    ? searchOfficialBrowsePyqs(options.query, category, options.limit)
    : getOfficialBrowsePyqs("", category, "", options.limit);
}

async function searchWorkspaceShells(options: {
  query: string;
  subjectKey: SubjectKey | "";
  questionId: string;
  syllabusId: string;
  limit: number;
}) {
  if (options.questionId.trim()) {
    const shell = getWorkspaceQuestionShellById(options.questionId.trim());
    return shell ? [shell] : [];
  }

  const questions = options.query.trim()
    ? await searchHybridWorkspaceQuestions({
      query: options.query,
      subjectKey: options.subjectKey,
      syllabusNodeId: options.syllabusId,
      limit: options.limit,
    })
    : searchWorkspaceQuestions({
      query: "",
      subjectKey: options.subjectKey,
      syllabusNodeId: options.syllabusId,
      limit: options.limit,
    });

  return questions.map((question) => ({
    ...question,
    linkedInsights: [],
    searchText: undefined,
  }));
}
