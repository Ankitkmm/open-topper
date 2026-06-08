import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getAuthRateLimitMax, getRateLimitWindowMs } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";
import { rejectLargeBody, requireSameOriginMutation } from "@/lib/request-guards";
import { PRIVATE_JSON_HEADERS, isEmailPasswordAuthConfigured } from "@/lib/session-access";
import { createClient } from "@/utils/supabase/server";

export async function POST(req: NextRequest) {
  const originError = requireSameOriginMutation(req);
  if (originError) return originError;
  const sizeError = rejectLargeBody(req, 1024);
  if (sizeError) return sizeError;

  const limit = await checkRateLimit(req, {
    scope: "auth-logout",
    max: getAuthRateLimitMax(),
    windowMs: getRateLimitWindowMs(),
  });
  if (!limit.ok) {
    return Response.json({ error: "Too many sign-out requests. Please slow down." }, {
      status: 429,
      headers: {
        ...PRIVATE_JSON_HEADERS,
        "Retry-After": String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))),
      },
    });
  }

  if (!isEmailPasswordAuthConfigured()) {
    return Response.json({ ok: true }, { headers: PRIVATE_JSON_HEADERS });
  }

  const supabase = await createClient(await cookies());
  await supabase.auth.signOut();
  return Response.json({ ok: true }, { headers: PRIVATE_JSON_HEADERS });
}
