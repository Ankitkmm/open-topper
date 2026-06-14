import type { NextRequest } from "next/server";

const API_GUARD_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
  Vary: "Origin, Referer, Sec-Fetch-Site, User-Agent",
};

const AUTOMATION_UA_PATTERN =
  /\b(?:curl|wget|python-requests|python-urllib|httpx|aiohttp|scrapy|go-http-client|java\/|okhttp|httpie|node-fetch|undici|axios|libwww-perl|postmanruntime)\b/i;

export function rejectNonBrowserApiRequest(req: NextRequest) {
  if (isSameOriginBrowserRequest(req)) return null;

  return Response.json(
    { error: "Use UPSCat from the website." },
    { status: 403, headers: API_GUARD_HEADERS },
  );
}

export function isSameOriginBrowserRequest(req: NextRequest) {
  const userAgent = req.headers.get("user-agent") || "";
  if (!userAgent || AUTOMATION_UA_PATTERN.test(userAgent)) return false;

  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite && !["same-origin", "same-site", "none"].includes(secFetchSite)) return false;

  const origin = req.headers.get("origin");
  if (origin) return origin === req.nextUrl.origin;

  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === req.nextUrl.origin;
    } catch {
      return false;
    }
  }

  return secFetchSite === "same-origin" || secFetchSite === "same-site";
}
