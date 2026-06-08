import type { NextRequest } from "next/server";
import { isSameOriginRequest } from "./answer-sources";
import { PRIVATE_JSON_HEADERS } from "./session-access";

export function requireSameOriginMutation(req: NextRequest) {
  if (isSameOriginRequest(req)) return null;
  return Response.json(
    { error: "Cross-site requests are not allowed." },
    { status: 403, headers: PRIVATE_JSON_HEADERS },
  );
}

export function requireJsonContentType(req: NextRequest) {
  const contentType = req.headers.get("content-type") || "";
  if (contentType.toLowerCase().split(";")[0]?.trim() === "application/json") return null;
  return Response.json(
    { error: "Expected application/json." },
    { status: 415, headers: PRIVATE_JSON_HEADERS },
  );
}

export function rejectLargeBody(req: NextRequest, maxBytes = 16_384) {
  const raw = req.headers.get("content-length");
  if (!raw) return null;
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) {
    return Response.json(
      { error: "Invalid Content-Length." },
      { status: 400, headers: PRIVATE_JSON_HEADERS },
    );
  }
  const size = Number(normalized);
  if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) {
    return Response.json(
      { error: "Request body too large." },
      { status: 413, headers: PRIVATE_JSON_HEADERS },
    );
  }
  return null;
}

export function boundedParam(value: string | null | undefined, maxLength: number) {
  const normalized = String(value || "").trim();
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

export function requireJsonMutationRequest(req: NextRequest, maxBytes = 16_384) {
  return requireSameOriginMutation(req)
    || requireJsonContentType(req)
    || rejectLargeBody(req, maxBytes);
}

export async function readBoundedJson<T = unknown>(req: NextRequest, maxBytes = 16_384) {
  const lengthError = rejectLargeBody(req, maxBytes);
  if (lengthError) return { ok: false as const, response: lengthError };

  if (!req.body) {
    return {
      ok: false as const,
      response: Response.json({ error: "Invalid request." }, { status: 400, headers: PRIVATE_JSON_HEADERS }),
    };
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return {
          ok: false as const,
          response: Response.json({ error: "Request body too large." }, { status: 413, headers: PRIVATE_JSON_HEADERS }),
        };
      }
      chunks.push(value);
    }
  } catch {
    return {
      ok: false as const,
      response: Response.json({ error: "Invalid request." }, { status: 400, headers: PRIVATE_JSON_HEADERS }),
    };
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { ok: true as const, value: JSON.parse(new TextDecoder().decode(body)) as T };
  } catch {
    return {
      ok: false as const,
      response: Response.json({ error: "Invalid request." }, { status: 400, headers: PRIVATE_JSON_HEADERS }),
    };
  }
}
