import { NextRequest } from "next/server";
import { getSubjectKeyFromValue } from "@/lib/subject-definitions";
import { getRateLimitWindowMs, getSearchRateLimitMax } from "@/lib/env";
import { searchHybridWorkspaceQuestions } from "@/lib/pyq";
import { checkRateLimit } from "@/lib/rate-limit";

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
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
        "Retry-After": String(Math.max(1, Math.ceil((limitState.resetAt - Date.now()) / 1000))),
      },
    });
  }

  const subjectKey = getSubjectKeyFromValue(req.nextUrl.searchParams.get("subject") || "");
  const syllabusNodeId = req.nextUrl.searchParams.get("syllabusId") || req.nextUrl.searchParams.get("syllabus") || "";
  const limit = Math.min(120, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") || "40", 10)));
  const query = req.nextUrl.searchParams.get("q") || "";
  const results = await searchHybridWorkspaceQuestions({
    query,
    subjectKey: subjectKey || "",
    syllabusNodeId,
    limit,
  });

  return Response.json({
    total: results.length,
    nextCursor: null,
    query,
    results,
  }, {
    headers: {
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
    },
  });
}
