import type { NextRequest } from "next/server";
import { updateSession } from "@/utils/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/account",
    "/api/auth/:path*",
    "/api/progress",
    "/api/answer-source/:path*",
    "/pdf/:path*",
  ],
};
