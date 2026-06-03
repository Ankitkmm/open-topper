import { NextRequest } from "next/server";
import {
  ANSWER_SOURCE_HEADERS,
  getResolvedAnswerSource,
  isSameOriginRequest,
  isValidAnswerId,
  toProxiedPdfUrl,
} from "@/lib/answer-sources";

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return Response.json({ error: "This PDF can only be opened from UPSCat." }, { status: 403, headers: ANSWER_SOURCE_HEADERS });
  }

  let body: { answerId?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400, headers: ANSWER_SOURCE_HEADERS });
  }

  const answerId = typeof body.answerId === "string" ? body.answerId : "";
  if (!isValidAnswerId(answerId)) {
    return Response.json({ error: "Invalid answer id." }, { status: 400, headers: ANSWER_SOURCE_HEADERS });
  }

  const source = getResolvedAnswerSource(answerId);
  if (!source) {
    return Response.json({ error: "Source not available." }, { status: 404, headers: ANSWER_SOURCE_HEADERS });
  }

  return Response.json(
    {
      embedUrl: toProxiedPdfUrl(answerId, source.page),
      page: source.page,
      topperName: source.record.topperName,
      rank: source.record.rank,
      year: source.record.year,
    },
    { headers: ANSWER_SOURCE_HEADERS },
  );
}

export async function GET() {
  return Response.json({ error: "Use the source-page button on a verified answer signal." }, { status: 405, headers: ANSWER_SOURCE_HEADERS });
}
