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

  const limit = await checkRateLimit(req, {
    scope: "auth-register",
    max: getAuthRateLimitMax(),
    windowMs: getRateLimitWindowMs(),
  });
  if (!limit.ok) {
    return Response.json({ error: "Too many sign-up attempts. Please slow down." }, {
      status: 429,
      headers: {
        ...PRIVATE_JSON_HEADERS,
        "Retry-After": String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))),
      },
    });
  }

  if (!isEmailPasswordAuthConfigured()) {
    return Response.json({ error: "Sign-in is temporarily disabled for QA." }, { status: 503, headers: PRIVATE_JSON_HEADERS });
  }

  const bodyResult = await readBoundedJson<{ email?: string; password?: string; name?: string }>(req);
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.value;

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const name = String(body.name || "").trim();
  if (!email || !password || password.length < 8) {
    return Response.json({ error: "Enter a valid email and an 8+ character password." }, { status: 400, headers: PRIVATE_JSON_HEADERS });
  }

  const supabase = await createClient(await cookies());
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: name ? { full_name: name } : undefined,
    },
  });

  if (error) {
    return Response.json({ error: "Account could not be created. Please verify the email and try again later." }, { status: 400, headers: PRIVATE_JSON_HEADERS });
  }

  return Response.json({
    ok: true,
    requiresEmailVerification: !data.session,
    email: data.user?.email || email,
  }, { headers: PRIVATE_JSON_HEADERS });
}
