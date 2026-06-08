import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getAuthRateLimitMax, getRateLimitWindowMs } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";
import { readBoundedJson, requireJsonMutationRequest } from "@/lib/request-guards";
import { PRIVATE_JSON_HEADERS, isEmailPasswordAuthConfigured } from "@/lib/session-access";
import { createClient } from "@/utils/supabase/server";

export async function POST(req: NextRequest) {
  const requestError = requireJsonMutationRequest(req);
  if (requestError) return requestError;

  if (!isEmailPasswordAuthConfigured()) {
    return Response.json({ error: "Sign-in is temporarily disabled for QA." }, { status: 503, headers: PRIVATE_JSON_HEADERS });
  }

  const limit = await checkRateLimit(req, {
    scope: "auth-login",
    max: getAuthRateLimitMax(),
    windowMs: getRateLimitWindowMs(),
  });
  if (!limit.ok) {
    return Response.json({ error: "Too many sign-in attempts. Please slow down." }, {
      status: 429,
      headers: {
        ...PRIVATE_JSON_HEADERS,
        "Retry-After": String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))),
      },
    });
  }

  const bodyResult = await readBoundedJson<{ email?: string; password?: string }>(req);
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.value;

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!email || !password) {
    return Response.json({ error: "Invalid email or password." }, { status: 400, headers: PRIVATE_JSON_HEADERS });
  }

  const supabase = await createClient(await cookies());
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user?.email) {
    return Response.json({ error: "Invalid email or password." }, { status: 401, headers: PRIVATE_JSON_HEADERS });
  }

  return Response.json({
    ok: true,
    email: data.user.email,
  }, { headers: PRIVATE_JSON_HEADERS });
}
