import { NextRequest } from "next/server";
import { getOfficialBrowsePyqs } from "@/lib/official-pyqs";
import type { SubjectPyqCard } from "@/lib/pyq";

const PAGE_SIZE = 30;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  const category = req.nextUrl.searchParams.get("category") || null;
  const keyword = req.nextUrl.searchParams.get("keyword") || null;
  const offset = parseInt(req.nextUrl.searchParams.get("offset") || "0");
  const limit = Math.min(60, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") || String(PAGE_SIZE))));
  const includeIndex = req.nextUrl.searchParams.get("includeIndex") === "1";

  const filtered = getOfficialBrowsePyqs(q, category || "", keyword || "", 10000);

  const page = filtered.slice(offset, offset + limit);

  return Response.json({
    questions: page.map(toApiQuestion),
    hasMore: offset + limit < filtered.length,
    total: filtered.length,
    keywordIndex: includeIndex ? buildKeywordIndex(filtered) : undefined,
  }, {
    headers: {
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Cache-Control": "private, no-store",
    },
  });
}

function toApiQuestion(question: SubjectPyqCard) {
  return {
    id: question.id,
    question: question.question,
    syllabusTags: question.syllabusTags,
    syllabus_tags: question.syllabusTags,
    keywords: question.keywords,
    category: question.category,
    paper: question.paper,
    estimatedYear: question.estimatedYear,
    marks: question.marks,
    relevantQuestionCount: question.relevantQuestionCount,
    mappedCopyCount: question.topperCount,
    derivedLinkCount: question.topperCount,
    sourceAvailableCount: question.relevantQuestions.reduce((sum, relevant) => sum + relevant.sourceAvailableCount, 0),
  };
}

function buildKeywordIndex(questions: SubjectPyqCard[]) {
  const index: Record<string, { id: string; question: string; category: string; copies: number }[]> = {};

  for (const question of questions) {
    for (const keyword of question.keywords || []) {
      index[keyword] ||= [];
      if (index[keyword].length >= 40) continue;

      index[keyword].push({
        id: question.id,
        question: question.question,
        category: question.category,
        copies: question.topperCount,
      });
    }
  }

  return index;
}
