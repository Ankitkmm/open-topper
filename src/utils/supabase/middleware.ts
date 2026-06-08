import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { getSupabasePublicPublishableKey, getSupabasePublicUrl } from "@/lib/public-env";
import type { Database } from "@/utils/supabase/schema";

const AUTH_COOKIE_PATTERN = /^sb-.*-auth-token(?:\.\d+)?$/;

export async function updateSession(request: NextRequest) {
  const url = getSupabasePublicUrl();
  const key = getSupabasePublicPublishableKey();

  if (!url || !key || !hasSupabaseAuthCookie(request)) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
      },
    },
  });

  await supabase.auth.getUser();
  return supabaseResponse;
}

function hasSupabaseAuthCookie(request: NextRequest) {
  return request.cookies.getAll().some(({ name }) => AUTH_COOKIE_PATTERN.test(name));
}
