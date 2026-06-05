import { NextRequest } from "next/server";
import { getRateLimitWindowMs, getSearchRateLimitMax } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";
import { getDuplicateReviewRecords } from "@/lib/search-status";
import { PRIVATE_JSON_HEADERS, requireSessionResponseIfConfigured } from "@/lib/session-access";

export async function GET(req: NextRequest) {
  const sessionError = await requireSessionResponseIfConfigured();
  if (sessionError) return sessionError;

  const limitState = await checkRateLimit(req, {
    scope: "internal-duplicate-review",
    max: Math.max(20, Math.floor(getSearchRateLimitMax() / 2)),
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

  const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get("limit") || "200")));
  const payload = await getDuplicateReviewRecords(limit);
  const safeRows = payload.map((row: {
    duplicate_key: string;
    kept_answer_id: string;
    dropped_answer_ids: string[];
    question_id: string;
    topper_name: string;
    page_hint: string | null;
  }) => ({
    duplicate_key: row.duplicate_key,
    kept_answer_id: row.kept_answer_id,
    dropped_answer_ids: row.dropped_answer_ids,
    question_id: row.question_id,
    topper_name: row.topper_name,
    page_hint: row.page_hint,
  }));
  return Response.json({ count: safeRows.length, rows: safeRows }, { headers: PRIVATE_JSON_HEADERS });
}
