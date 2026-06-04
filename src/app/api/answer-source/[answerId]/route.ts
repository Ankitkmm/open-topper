import { NextRequest } from "next/server";
import {
  ANSWER_SOURCE_HEADERS,
  contentDispositionFilename,
} from "@/lib/answer-sources";
import { enforcePdfAccess, resolvePdfSourceForToken } from "@/lib/pdf-access";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ answerId: string }> },
) {
  const { answerId } = await params;
  const accessError = await enforcePdfAccess(req, answerId, {
    skipOriginCheck: Boolean(req.nextUrl.searchParams.get("token")),
  });
  if (accessError) return accessError;

  const token = req.nextUrl.searchParams.get("token") || "";
  const resolved = resolvePdfSourceForToken(answerId, token);
  if (!resolved.ok) return Response.json({ error: resolved.error }, { status: 403, headers: ANSWER_SOURCE_HEADERS });
  const { source } = resolved;

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
