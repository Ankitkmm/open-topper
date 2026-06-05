import { redirect } from "next/navigation";
import { PdfViewerPage } from "@/components/PdfViewerPage";
import { resolvePdfSourceForToken } from "@/lib/pdf-access";
import { getAuthenticatedUser, isEmailPasswordAuthConfigured } from "@/lib/session-access";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ answerId: string }>;
  searchParams: Promise<{ token?: string; page?: string }>;
}) {
  const { answerId } = await params;
  const { token = "", page = "" } = await searchParams;

  if (isEmailPasswordAuthConfigured()) {
    const user = await getAuthenticatedUser();
    if (!user?.email) {
      redirect(`/account?next=${encodeURIComponent(`/pdf/${answerId}?token=${token}${page ? `&page=${page}` : ""}`)}`);
    }
  }

  const resolved = resolvePdfSourceForToken(answerId, token);
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
      sourceUrl={`/api/answer-source/${answerId}?token=${encodeURIComponent(token)}`}
      topperName={resolved.source.record.topperName}
      pageStatus={resolved.source.record.pageStatus || null}
      sourceStatus={resolved.source.record.sourceStatus || null}
    />
  );
}
