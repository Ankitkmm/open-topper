import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { PdfViewerPage } from "@/components/PdfViewerPage";
import { getPdfTokenCookieName, resolvePdfSourceForToken } from "@/lib/pdf-access";
import { normalizePublicTopperName } from "@/lib/public-records";
import { shouldFailClosedForMissingAuth } from "@/lib/auth-availability";
import { getAuthenticatedUser, isEmailPasswordAuthConfigured } from "@/lib/session-access";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ answerId: string }>;
  searchParams: Promise<{ token?: string; page?: string }>;
}) {
  const { answerId } = await params;
  const { page = "" } = await searchParams;
  const requestHeaders = await headers();
  const token = (await cookies()).get(getPdfTokenCookieName(answerId))?.value || "";

  if (!isAllowedPdfViewerNavigation(requestHeaders)) {
    return (
      <main className="library-page min-h-screen px-6 py-16">
        <div className="mx-auto max-w-xl soft-panel p-6 text-center" role="alert">
          <div className="overline mb-3">PDF access</div>
          <h1 className="text-2xl">PDF could not be opened from this navigation.</h1>
          <p className="mt-3 text-secondary">Reopen the source from UPSCat so the short reading-session token can be verified.</p>
        </div>
      </main>
    );
  }

  if (shouldFailClosedForMissingAuth()) {
    return (
      <main className="library-page min-h-screen px-6 py-16">
        <div className="mx-auto max-w-xl soft-panel p-6 text-center">
          <div className="overline mb-3">PDF access</div>
          <h1 className="text-2xl">Authentication is not configured.</h1>
          <p className="mt-3 text-secondary">PDF access is closed until production Supabase auth is configured.</p>
        </div>
      </main>
    );
  }

  if (isEmailPasswordAuthConfigured()) {
    const user = await getAuthenticatedUser();
    if (!user?.email) {
      redirect(`/account?next=${encodeURIComponent(`/pdf/${answerId}${page ? `?page=${page}` : ""}`)}`);
    }
  }

  const resolved = await resolvePdfSourceForToken(answerId, token);
  if (!resolved.ok) {
    return (
      <main className="library-page min-h-screen px-6 py-16">
        <div className="mx-auto max-w-xl soft-panel p-6 text-center">
          <div className="overline mb-3">PDF access</div>
          <h1 className="text-2xl">PDF could not be opened.</h1>
          <p className="mt-3 text-secondary">{resolved.error}</p>
        </div>
      </main>
    );
  }

  const fallbackPage = Math.max(1, Number.parseInt(page, 10) || resolved.source.page);

  return (
    <PdfViewerPage
      answerId={answerId}
      initialPage={fallbackPage}
      sourceUrl={`/api/answer-source/${answerId}`}
      topperName={normalizePublicTopperName(resolved.source.record.topperName)}
      pageStatus={resolved.source.record.pageStatus || null}
      sourceStatus={resolved.source.record.sourceStatus || null}
    />
  );
}

function isAllowedPdfViewerNavigation(requestHeaders: Headers) {
  const fetchSite = requestHeaders.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite === "cross-site") return false;
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) return false;

  const expectedOrigin = requestOrigin(requestHeaders);
  if (!expectedOrigin) return !requestHeaders.get("origin") && !requestHeaders.get("referer");

  const origin = requestHeaders.get("origin");
  if (origin && !sameOrigin(origin, expectedOrigin)) return false;

  const referer = requestHeaders.get("referer");
  if (referer && !sameOrigin(referer, expectedOrigin)) return false;

  return true;
}

function requestOrigin(requestHeaders: Headers) {
  const host = (requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "").split(",")[0]?.trim();
  if (!host || /[\s/\\]/.test(host)) return "";
  const proto = (requestHeaders.get("x-forwarded-proto") || "").split(",")[0]?.trim().toLowerCase()
    || (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  if (!["http", "https"].includes(proto)) return "";
  return `${proto}://${host}`;
}

function sameOrigin(value: string, expectedOrigin: string) {
  try {
    return new URL(value).origin === expectedOrigin;
  } catch {
    return false;
  }
}
