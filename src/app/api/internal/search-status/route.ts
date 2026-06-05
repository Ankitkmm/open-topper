import { NextRequest } from "next/server";
import { getRateLimitWindowMs, getSearchRateLimitMax } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSearchStatus } from "@/lib/search-status";
import { PRIVATE_JSON_HEADERS, requireSessionResponseIfConfigured } from "@/lib/session-access";

export async function GET(req: NextRequest) {
  const sessionError = await requireSessionResponseIfConfigured();
  if (sessionError) return sessionError;

  const limitState = await checkRateLimit(req, {
    scope: "internal-search-status",
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

  const payload = await getSearchStatus();
  return Response.json(payload, { headers: PRIVATE_JSON_HEADERS });
}
