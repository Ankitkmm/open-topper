import { createClient } from "@/utils/supabase/server";
import { isPublicAuthAvailable, shouldFailClosedForMissingAuth } from "@/lib/auth-availability";

export const PRIVATE_JSON_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
};

export function isEmailPasswordAuthConfigured() {
  return isPublicAuthAvailable();
}

export async function getAuthenticatedUser() {
  if (!isEmailPasswordAuthConfigured()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user ?? null;
}

export async function requireSessionResponseIfConfigured() {
  if (shouldFailClosedForMissingAuth()) {
    return Response.json(
      { error: "Authentication is required but Supabase auth is not configured." },
      { status: 503, headers: PRIVATE_JSON_HEADERS },
    );
  }

  if (!isEmailPasswordAuthConfigured()) return null;
  const user = await getAuthenticatedUser();
  if (user?.email) return null;
  return Response.json({ error: "Sign in required." }, { status: 401, headers: PRIVATE_JSON_HEADERS });
}
