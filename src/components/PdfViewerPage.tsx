"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

type PdfModule = typeof import("pdfjs-dist");
type LoadedPdfDocument = Awaited<ReturnType<PdfModule["getDocument"]>["promise"]>;

interface Props {
  answerId: string;
  initialPage: number;
  sourceUrl: string;
  topperName: string | null;
  pageStatus: string | null;
  sourceStatus: string | null;
}

export function PdfViewerPage({
  answerId,
  initialPage,
  sourceUrl,
  topperName,
  pageStatus,
  sourceStatus,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfModuleRef = useRef<PdfModule | null>(null);
  const pdfDocumentRef = useRef<LoadedPdfDocument | null>(null);
  const [pageCount, setPageCount] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(Math.max(1, initialPage));
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1.25);

  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      setLoading(true);
      setError(null);
      pdfDocumentRef.current = null;
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfModuleRef.current = pdfjs;
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const loadingTask = pdfjs.getDocument({ url: sourceUrl, withCredentials: false });
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        pdfDocumentRef.current = pdf;
        setPageCount(pdf.numPages);
        setPageNumber((current) => Math.min(Math.max(1, current), pdf.numPages));
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "PDF could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadPdf();
    return () => {
      cancelled = true;
      pdfDocumentRef.current = null;
    };
  }, [sourceUrl]);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel?: () => void; promise?: Promise<unknown> } | null = null;

    async function renderPage() {
      const pdf = pdfDocumentRef.current;
      if (!pdf || error) return;
      setRendering(true);
      try {
        const safePage = Math.min(Math.max(1, pageNumber), pdf.numPages);
        if (safePage !== pageNumber) {
          setPageNumber(safePage);
          return;
        }
        const page = await pdf.getPage(safePage);
        const viewport = page.getViewport({ scale });
        const outputScale = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1;
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) throw new Error("PDF canvas is unavailable.");

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const pageRenderTask = page.render({
          canvas,
          canvasContext: context,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
          viewport,
        });
        renderTask = pageRenderTask;
        await pageRenderTask.promise;
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "PDF could not be loaded.");
      } finally {
        if (!cancelled) setRendering(false);
      }
    }

    void renderPage();
    return () => {
      cancelled = true;
      renderTask?.cancel?.();
    };
  }, [error, pageNumber, scale, pageCount]);

  const badgeText = useMemo(() => {
    if (pageStatus === "fallback") return "Approximate page";
    if (pageStatus === "out_of_range") return "Needs page fix";
    if (sourceStatus === "not_uploaded") return "Source unavailable";
    return `Page ${pageNumber}${pageCount ? ` / ${pageCount}` : ""}`;
  }, [pageCount, pageNumber, pageStatus, sourceStatus]);

  return (
    <main className="library-page min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <div className="soft-panel flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="overline mb-2">PDF viewer</div>
            <h1 className="text-2xl sm:text-3xl">{topperName || "Topper copy"}</h1>
            <p className="mt-2 text-sm text-secondary">
              OCR/AI study aids can be imperfect. Verify against the original PDF page before relying on summary or matching cues.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="study-badge study-badge-accent">{badgeText}</span>
          </div>
        </div>

        <div className="soft-panel flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={pageNumber <= 1 || loading || rendering}
              onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft size={15} aria-hidden="true" /> Prev
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={Boolean(pageCount) && pageNumber >= pageCount || loading || rendering}
              onClick={() => setPageNumber((current) => current + 1)}
            >
              Next <ChevronRight size={15} aria-hidden="true" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm text-secondary">
            <label className="study-badge" htmlFor="pdf-page-input">Go to page</label>
            <input
              id="pdf-page-input"
              type="number"
              min={1}
              max={pageCount || undefined}
              value={pageNumber}
              onChange={(event) => setPageNumber(Math.max(1, Number(event.currentTarget.value) || 1))}
              className="soft-input h-10 w-24 px-3 text-sm"
            />
            <select
              className="soft-input h-10 px-3 text-sm"
              value={String(scale)}
              onChange={(event) => setScale(Number(event.currentTarget.value) || 1.25)}
            >
              <option value="1">100%</option>
              <option value="1.25">125%</option>
              <option value="1.5">150%</option>
              <option value="1.75">175%</option>
            </select>
          </div>
        </div>

        <div className="soft-panel flex min-h-[60vh] items-center justify-center overflow-auto p-4 sm:p-6">
          {loading && (
            <div className="flex flex-col items-center gap-3 text-secondary">
              <Loader2 size={24} className="animate-spin" aria-hidden="true" />
              <p>Loading document…</p>
            </div>
          )}
          {error && !loading && (
            <div className="max-w-xl text-center text-secondary">
              <p className="font-semibold text-primary">PDF could not be loaded.</p>
              <p className="mt-2 text-sm">{error}</p>
            </div>
          )}
          <canvas ref={canvasRef} className={loading || error ? "hidden" : "mx-auto rounded-lg shadow-[var(--shadow-soft)]"} />
        </div>

        <div className="text-center text-xs text-muted">
          Answer id: <span className="mono-stat">{answerId}</span>
        </div>
      </div>
    </main>
  );
}
