import { NextRequest } from "next/server";
import {
  ANSWER_SOURCE_HEADERS,
} from "@/lib/answer-sources";
import { buildPdfEmbedResponse, enforcePdfAccess } from "@/lib/pdf-access";
import { requireSessionResponseIfConfigured } from "@/lib/session-access";

export async function POST(req: NextRequest) {
  let body: { answerId?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400, headers: ANSWER_SOURCE_HEADERS });
  }

  const answerId = typeof body.answerId === "string" ? body.answerId : "";
  const sessionError = await requireSessionResponseIfConfigured();
  if (sessionError) return sessionError;
  const accessError = await enforcePdfAccess(req, answerId);
  if (accessError) return accessError;

  const payload = buildPdfEmbedResponse(answerId);
  if (!payload.ok) {
    return Response.json({ error: payload.error }, { status: payload.status, headers: ANSWER_SOURCE_HEADERS });
  }

  return Response.json(
    payload.payload,
    { headers: ANSWER_SOURCE_HEADERS },
  );
}

export async function GET() {
  return Response.json({ error: "Use the source-page button on a verified answer signal." }, { status: 405, headers: ANSWER_SOURCE_HEADERS });
}
