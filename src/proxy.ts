import type { NextRequest } from "next/server";
import { rejectNonBrowserApiRequest } from "@/lib/request-guard";
import { updateSession } from "@/utils/supabase/middleware";

export async function proxy(request: NextRequest) {
  if (isGuardedPublicApi(request.nextUrl.pathname)) {
    const rejected = rejectNonBrowserApiRequest(request);
    if (rejected) return rejected;
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/account",
    "/api/auth/:path*",
    "/api/progress",
    "/api/search",
    "/api/official-questions/:path*",
    "/api/workspace-questions/:path*",
    "/api/answer-source/:path*",
    "/pdf/:path*",
  ],
};

function isGuardedPublicApi(pathname: string) {
  return (
    pathname === "/api/search" ||
    pathname.startsWith("/api/official-questions/") ||
    pathname.startsWith("/api/workspace-questions/") ||
    pathname === "/api/answer-source" ||
    pathname.startsWith("/api/answer-source/")
  );
}
