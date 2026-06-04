import { NextRequest } from "next/server";
import { getSubjectKeyFromValue } from "@/lib/subject-definitions";
import { searchWorkspaceQuestions } from "@/lib/question-bank";

const PAGE_SIZE = 30;

export async function GET(req: NextRequest) {
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
    {
      headers: {
        "X-Robots-Tag": "noindex, nofollow, noarchive",
        "Cache-Control": "private, no-store",
      },
    },
  );
}
