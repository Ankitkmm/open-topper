import { NextRequest } from "next/server";
import {
  ANSWER_SOURCE_HEADERS,
  contentDispositionFilename,
  getResolvedAnswerSource,
  isSameOriginRequest,
  isValidAnswerId,
} from "@/lib/answer-sources";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ answerId: string }> },
) {
  if (!isSameOriginRequest(req)) {
    return Response.json({ error: "This PDF can only be opened from UPSCat." }, { status: 403, headers: ANSWER_SOURCE_HEADERS });
  }

  const { answerId } = await params;
  if (!isValidAnswerId(answerId)) {
    return Response.json({ error: "Invalid answer id." }, { status: 400, headers: ANSWER_SOURCE_HEADERS });
  }

  const source = getResolvedAnswerSource(answerId);
  if (!source) {
    return Response.json({ error: "Source not available." }, { status: 404, headers: ANSWER_SOURCE_HEADERS });
  }

  const range = req.headers.get("range");
  const upstream = await fetch(source.sourceUrl, {
    cache: "no-store",
    headers: range ? { Range: range } : undefined,
  });

  if (!upstream.ok && upstream.status !== 206) {
    return Response.json({ error: "PDF could not be opened." }, { status: 502, headers: ANSWER_SOURCE_HEADERS });
  }

  const headers = new Headers(ANSWER_SOURCE_HEADERS);
  headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/pdf");
  headers.set("Content-Disposition", `inline; filename="${contentDispositionFilename(source.record)}"`);

  for (const key of ["Accept-Ranges", "Content-Length", "Content-Range"]) {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
