"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Search, ZoomIn, ZoomOut } from "lucide-react";

type PdfModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfDocument = Awaited<ReturnType<PdfModule["getDocument"]>["promise"]>;

interface PdfViewerProps {
  src: string;
  initialPage: number;
  title: string;
  pageStatus?: string | null;
}

export function PdfViewer({ src, initialPage, title, pageStatus }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [documentProxy, setDocumentProxy] = useState<PdfDocument | null>(null);
  const [currentPage, setCurrentPage] = useState(Math.max(1, initialPage || 1));
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
        mod.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.mjs",
          import.meta.url,
        ).toString();

        const task = mod.getDocument({ url: src });
        const pdf = await task.promise;
        if (!active) return;
        setDocumentProxy(pdf);
        setPageCount(pdf.numPages);
        setCurrentPage((page) => Math.min(Math.max(1, initialPage || page), pdf.numPages));
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "PDF could not be loaded.");
      }
    })();

    return () => {
      active = false;
    };
  }, [src, initialPage]);

  useEffect(() => {
    if (!documentProxy || !canvasRef.current) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const page = await documentProxy.getPage(currentPage);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas context unavailable.");

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: context, viewport, canvas }).promise;
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "PDF page could not be rendered.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [documentProxy, currentPage, scale]);

  async function handleSearch() {
    if (!documentProxy || !searchText.trim()) return;
    setSearching(true);
    const needle = searchText.trim().toLowerCase();
    try {
      for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber++) {
        const page = await documentProxy.getPage(pageNumber);
        const text = await page.getTextContent();
        const content = text.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .toLowerCase();
        if (content.includes(needle)) {
          setCurrentPage(pageNumber);
          return;
        }
      }
      setError(`No match found in ${title}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search inside PDF failed.");
    } finally {
      setSearching(false);
    }
  }

  const pageAccuracy = useMemo(() => {
    if (pageStatus === "fallback") return "Estimated page";
    if (pageStatus === "valid") return "Exact page";
    if (pageStatus === "missing") return "Page not confirmed";
    return null;
  }, [pageStatus]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-neutral-900">{title}</div>
          <div className="mt-1 text-xs text-neutral-500">
            Page {currentPage}{pageCount ? ` / ${pageCount}` : ""}{pageAccuracy ? ` · ${pageAccuracy}` : ""}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5">
            <Search size={14} className="text-neutral-500" />
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleSearch();
                }
              }}
              placeholder="Search inside PDF"
              className="w-40 bg-transparent text-xs text-neutral-900 outline-none"
            />
            <button
              type="button"
              className="text-xs font-semibold text-neutral-700"
              onClick={() => void handleSearch()}
              disabled={searching}
            >
              {searching ? "Searching..." : "Find"}
            </button>
          </div>

          <button type="button" className="btn-secondary" onClick={() => setScale((value) => Math.max(0.8, value - 0.1))}>
            <ZoomOut size={14} />
          </button>
          <button type="button" className="btn-secondary" onClick={() => setScale((value) => Math.min(2.5, value + 0.1))}>
            <ZoomIn size={14} />
          </button>
          <button type="button" className="btn-secondary" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={currentPage <= 1}>
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setCurrentPage((page) => Math.min(pageCount || page, page + 1))}
            disabled={pageCount > 0 && currentPage >= pageCount}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-auto bg-neutral-100 p-4">
        {loading && <div className="mb-3 text-sm text-neutral-600">Rendering page...</div>}
        {error && <div className="mb-3 text-sm text-red-700">{error}</div>}
        <div className="mx-auto w-fit rounded-md bg-white shadow-md">
          <canvas ref={canvasRef} />
        </div>
      </div>
    </div>
  );
}
