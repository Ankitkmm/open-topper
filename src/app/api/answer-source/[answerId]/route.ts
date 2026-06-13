import { NextRequest } from "next/server";
import {
  ANSWER_SOURCE_HEADERS,
  contentDispositionFilename,
} from "@/lib/answer-sources";
import { getPdfUpstreamTimeoutMs } from "@/lib/env";
import {
  enforcePdfAccess,
  getPdfAccessTokenFromRequest,
  isAllowedPdfContentType,
  isValidPdfContentRange,
  isValidPdfRangeHeader,
  resolvePdfSourceForToken,
} from "@/lib/pdf-access";
import { requireSessionResponseIfConfigured } from "@/lib/session-access";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ answerId: string }> },
) {
  const { answerId } = await params;
  const accessError = await enforcePdfAccess(req, answerId);
  if (accessError) return accessError;
  const sessionError = await requireSessionResponseIfConfigured();
  if (sessionError) return sessionError;

  const token = getPdfAccessTokenFromRequest(req, answerId);
  const resolved = await resolvePdfSourceForToken(answerId, token);
  if (!resolved.ok) {
    return Response.json({ error: resolved.error }, { status: resolved.status, headers: ANSWER_SOURCE_HEADERS });
  }
  const { source } = resolved;

  const range = req.headers.get("range");
  if (range && !isValidPdfRangeHeader(range)) {
    const headers = new Headers(ANSWER_SOURCE_HEADERS);
    headers.set("Content-Range", "bytes */*");
    return Response.json({ error: "Invalid PDF byte range." }, { status: 416, headers });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getPdfUpstreamTimeoutMs());

  let upstream: Response;
  try {
    upstream = await fetch(source.sourceUrl, {
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
      headers: range ? { Range: range } : undefined,
    });
  } catch {
    return Response.json({ error: "PDF could not be opened." }, { status: 502, headers: ANSWER_SOURCE_HEADERS });
  } finally {
    clearTimeout(timeout);
  }

  if (range) {
    if (upstream.status !== 206) {
      return Response.json({ error: "PDF byte range was not available." }, { status: 502, headers: ANSWER_SOURCE_HEADERS });
    }
    if (!isValidPdfContentRange(upstream.headers.get("Content-Range"))) {
      return Response.json({ error: "PDF byte range response was invalid." }, { status: 502, headers: ANSWER_SOURCE_HEADERS });
    }
  } else if (upstream.status !== 200) {
    return Response.json({ error: "PDF could not be opened." }, { status: 502, headers: ANSWER_SOURCE_HEADERS });
  }
  if (!isAllowedPdfContentType(upstream.headers.get("Content-Type"))) {
    return Response.json({ error: "PDF source returned an unexpected content type." }, { status: 502, headers: ANSWER_SOURCE_HEADERS });
  }

  const headers = new Headers(ANSWER_SOURCE_HEADERS);
  headers.set("Content-Type", "application/pdf");
  headers.set("Content-Disposition", `inline; filename="${contentDispositionFilename(source.record, answerId)}"`);

  for (const key of ["Accept-Ranges", "Content-Length", "Content-Range"]) {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
