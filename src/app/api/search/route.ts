import { NextRequest } from "next/server";
import { getRateLimitWindowMs, getSearchRateLimitMax } from "@/lib/env";
import {
  getOfficialBrowsePyqs,
  getOfficialQuestionShell,
  getOfficialSubjectPyqShells,
} from "@/lib/official-pyqs";
import {
  getWorkspaceNode,
  getWorkspaceQuestionById,
  searchWorkspaceQuestions,
  toWorkspaceQuestionShell,
} from "@/lib/question-bank-runtime";
import { checkRateLimit } from "@/lib/rate-limit";
import { boundedParam } from "@/lib/request-guards";
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
  const subject = boundedParam(req.nextUrl.searchParams.get("subject"), 80);
  const subjectKey = getSubjectKeyFromValue(subject);
  const questionId = boundedParam(req.nextUrl.searchParams.get("questionId"), 160);
  const syllabusId = boundedParam(req.nextUrl.searchParams.get("syllabusId") || req.nextUrl.searchParams.get("syllabus"), 160);
  const parsedLimit = Number.parseInt(boundedParam(req.nextUrl.searchParams.get("limit"), 4) || "40", 10);
  const limit = Math.min(120, Math.max(1, Number.isFinite(parsedLimit) ? parsedLimit : 40));
  const query = boundedParam(req.nextUrl.searchParams.get("q"), 500);

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
  const syllabus = resolveOfficialSyllabusFilter(options.subjectKey, options.syllabusId);

  if (options.subjectKey) {
    return getOfficialSubjectPyqShells(options.subjectKey, options.query, options.limit, syllabus);
  }

  return getOfficialBrowsePyqs(options.query, category, "", options.limit);
}

async function searchWorkspaceShells(options: {
  query: string;
  subjectKey: SubjectKey | "";
  questionId: string;
  syllabusId: string;
  limit: number;
}) {
  if (options.questionId.trim()) {
    const shell = getWorkspaceQuestionById(options.questionId.trim());
    return shell ? [toWorkspaceQuestionShell(shell)] : [];
  }

  const questions = searchWorkspaceQuestions({
    query: options.query,
    subjectKey: options.subjectKey,
    syllabusNodeId: options.syllabusId,
    limit: options.limit,
  });

  return questions.map(toWorkspaceQuestionShell);
}

export function resolveOfficialSyllabusFilter(subjectKey: SubjectKey | null, syllabusId: string) {
  const value = syllabusId.trim();
  if (!value) return "";
  if (!subjectKey) return value;

  const node = getWorkspaceNode(value);
  if (!node || node.subjectKey !== subjectKey) return value;
  return node.label || value;
}
