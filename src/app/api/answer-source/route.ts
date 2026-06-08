import { NextRequest } from "next/server";
import {
  ANSWER_SOURCE_HEADERS,
} from "@/lib/answer-sources";
import { readBoundedJson, requireJsonMutationRequest } from "@/lib/request-guards";
import { buildPdfEmbedResponse, buildPdfTokenCookieHeader, enforcePdfAccess } from "@/lib/pdf-access";
import { requireSessionResponseIfConfigured } from "@/lib/session-access";

export async function POST(req: NextRequest) {
  const requestError = requireJsonMutationRequest(req, 1024);
  if (requestError) return requestError;

  const bodyResult = await readBoundedJson<{ answerId?: unknown }>(req, 1024);
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.value;

  const answerId = typeof body.answerId === "string" ? body.answerId : "";
  const sessionError = await requireSessionResponseIfConfigured();
  if (sessionError) return sessionError;
  const accessError = await enforcePdfAccess(req, answerId);
  if (accessError) return accessError;

  const payload = buildPdfEmbedResponse(answerId);
  if (!payload.ok) {
    return Response.json({ error: payload.error }, { status: payload.status, headers: ANSWER_SOURCE_HEADERS });
  }

  const headers = new Headers(ANSWER_SOURCE_HEADERS);
  headers.set("Set-Cookie", buildPdfTokenCookieHeader(answerId, payload.payload.token));
  const { token: _token, ...publicPayload } = payload.payload;
  void _token;

  return Response.json(
    publicPayload,
    { headers },
  );
}

export async function GET() {
  const headers = new Headers(ANSWER_SOURCE_HEADERS);
  headers.set("Allow", "POST");
  return Response.json(
    { error: "Use the source-page button on a verified answer signal." },
    { status: 405, headers },
  );
}
