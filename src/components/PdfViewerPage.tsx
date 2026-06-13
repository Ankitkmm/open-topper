"use client";

import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizePublicTopperName } from "@/lib/public-records";

type PdfModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type LoadedPdfDocument = Awaited<ReturnType<PdfModule["getDocument"]>["promise"]>;

type PdfPageMode = "auto" | "single" | "spread";

type Spread = {
  key: string;
  pages: number[];
};

interface PageShellProps {
  pageNumber: number;
  basePageWidth: number;
  baseAspectRatio: number;
  isDesktop: boolean;
  children?: React.ReactNode;
}

interface PageCanvasProps extends PageShellProps {
  pdfDocument: LoadedPdfDocument;
  scale: number;
}

interface Props {
  answerId: string;
  initialPage: number;
  sourceUrl: string;
  topperName: string | null;
  pageStatus: string | null;
  sourceStatus: string | null;
}

const ZOOM_OPTIONS = [0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25] as const;
const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";
const SPREAD_OBSERVER_THRESHOLDS = [0.15, 0.35, 0.6, 0.9];
const RENDER_WINDOW_RADIUS = 2;
const DEFAULT_DESKTOP_ZOOM = 1;
const DEFAULT_MOBILE_ZOOM = 0.6;

function buildSpreads(pageCount: number, isDesktop: boolean) {
  if (pageCount < 1) return [] as Spread[];
  if (!isDesktop) {
    return Array.from({ length: pageCount }, (_, index) => ({
      key: `page-${index + 1}`,
      pages: [index + 1],
    }));
  }

  const spreads: Spread[] = [{ key: "spread-1", pages: [1] }];
  for (let page = 2; page <= pageCount; page += 2) {
    spreads.push({
      key: `spread-${page}`,
      pages: page + 1 <= pageCount ? [page, page + 1] : [page],
    });
  }
  return spreads;
}

function findSpreadIndex(spreads: Spread[], pageNumber: number) {
  return spreads.findIndex((spread) => spread.pages.includes(pageNumber));
}

function PageShell({
  pageNumber,
  basePageWidth,
  baseAspectRatio,
  isDesktop,
  children,
}: PageShellProps) {
  const width = Math.max(220, Math.floor(basePageWidth));

  return (
    <div className="flex w-full flex-col items-center gap-2 lg:w-auto lg:flex-none">
      <div
        className="relative overflow-hidden rounded-[1.25rem] border border-[color:var(--border)] bg-[color:var(--bg-elevated)] shadow-[var(--shadow-soft)]"
        style={{
          width: isDesktop ? `${width}px` : "100%",
          maxWidth: `${width}px`,
          aspectRatio: String(baseAspectRatio),
        }}
      >
        {children}
      </div>
      <div className="text-xs text-muted">Page {pageNumber}</div>
    </div>
  );
}

function PagePlaceholder(props: PageShellProps) {
  return (
    <PageShell {...props}>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-secondary">
        <span className="study-badge">Scroll to load</span>
      </div>
    </PageShell>
  );
}

function PageCanvas({
  pageNumber,
  pdfDocument,
  scale,
  basePageWidth,
  baseAspectRatio,
  isDesktop,
}: PageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<{ cancel?: () => void; promise?: Promise<unknown> } | null>(null);
  const [status, setStatus] = useState<"rendering" | "ready" | "error">("rendering");
  const [error, setError] = useState<string | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number>(basePageWidth);
  const [measuredAspectRatio, setMeasuredAspectRatio] = useState<number>(baseAspectRatio);

  useEffect(() => {
    let cancelled = false;

    async function renderPage() {
      setStatus("rendering");
      setError(null);

      try {
        const page = await pdfDocument.getPage(pageNumber);
        if (cancelled) return;

        const viewport = page.getViewport({ scale });
        const outputScale = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1;
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) throw new Error("PDF canvas is unavailable.");

        setMeasuredWidth(viewport.width);
        setMeasuredAspectRatio(viewport.width / viewport.height);

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = isDesktop ? `${Math.floor(viewport.width)}px` : "100%";
        canvas.style.height = isDesktop ? `${Math.floor(viewport.height)}px` : "auto";
        canvas.style.maxWidth = "100%";

        const task = page.render({
          canvas,
          canvasContext: context,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
          viewport,
        });
        renderTaskRef.current = task;
        await task.promise;
        if (cancelled) return;
        setStatus("ready");
      } catch (cause) {
        if (cancelled) return;
        const name = typeof cause === "object" && cause !== null && "name" in cause ? String(cause.name) : "";
        if (name === "RenderingCancelledException") return;
        setStatus("error");
        setError(cause instanceof Error ? cause.message : "Page could not be rendered.");
      }
    }

    void renderPage();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel?.();
    };
  }, [isDesktop, pageNumber, pdfDocument, scale]);

  return (
    <PageShell
      pageNumber={pageNumber}
      basePageWidth={measuredWidth}
      baseAspectRatio={measuredAspectRatio}
      isDesktop={isDesktop}
    >
      {status === "rendering" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-secondary">
          <Loader2 size={20} className="animate-spin" aria-hidden="true" />
          <p className="text-sm">Loading page…</p>
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-secondary" role="alert">
          <div>
            <p className="font-semibold text-primary">Page {pageNumber} could not be rendered.</p>
            <p className="mt-2">{error}</p>
          </div>
        </div>
      )}
      <canvas
        ref={canvasRef}
        className={status === "ready" ? "block max-w-full" : "invisible absolute inset-0 max-w-full"}
        aria-label={`PDF page ${pageNumber}`}
      />
    </PageShell>
  );
}

export function PdfViewerPage({
  answerId,
  initialPage,
  sourceUrl,
  topperName,
  pageStatus,
  sourceStatus,
}: Props) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pdfDocumentRef = useRef<LoadedPdfDocument | null>(null);
  const spreadRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const visibleSpreadRatiosRef = useRef<Map<string, number>>(new Map());
  const didInitialScrollRef = useRef(false);
  const lastLayoutModeRef = useRef<boolean | null>(null);
  const userSelectedZoomRef = useRef(false);
  const [pdfDocument, setPdfDocument] = useState<LoadedPdfDocument | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [basePageWidth, setBasePageWidth] = useState(612);
  const [baseAspectRatio, setBaseAspectRatio] = useState(1 / Math.sqrt(2));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState<(typeof ZOOM_OPTIONS)[number]>(DEFAULT_DESKTOP_ZOOM);
  const [pageMode, setPageMode] = useState<PdfPageMode>("auto");
  const [isDesktop, setIsDesktop] = useState(false);
  const [currentSpreadIndex, setCurrentSpreadIndex] = useState(0);
  const [anchorPageNumber, setAnchorPageNumber] = useState(Math.max(1, initialPage));
  const [pageInputDraft, setPageInputDraft] = useState(String(Math.max(1, initialPage)));
  const [isEditingPageInput, setIsEditingPageInput] = useState(false);
  const publicTopperName = normalizePublicTopperName(topperName) ?? "Topper copy";

  const registerSpreadElement = useCallback((spreadKey: string, element: HTMLDivElement | null) => {
    spreadRefs.current.set(spreadKey, element);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const update = () => {
      const nextIsDesktop = mediaQuery.matches;
      setIsDesktop(nextIsDesktop);
      if (!userSelectedZoomRef.current) {
        setScale(nextIsDesktop ? DEFAULT_DESKTOP_ZOOM : DEFAULT_MOBILE_ZOOM);
      }
    };
    update();

    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<PdfModule["getDocument"]> | null = null;

    async function loadPdf() {
      setLoading(true);
      setError(null);
      setPdfDocument(null);
      setPageCount(0);
      setCurrentSpreadIndex(0);
      setAnchorPageNumber(Math.max(1, initialPage));
      pdfDocumentRef.current = null;
      didInitialScrollRef.current = false;
      visibleSpreadRatiosRef.current.clear();
      spreadRefs.current.clear();

      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
        loadingTask = pdfjs.getDocument({ url: sourceUrl, withCredentials: false });
        const pdf = await loadingTask.promise;
        if (cancelled) {
          await loadingTask.destroy();
          return;
        }

        const firstPage = await pdf.getPage(1);
        const firstViewport = firstPage.getViewport({ scale: 1 });
        pdfDocumentRef.current = pdf;
        setPdfDocument(pdf);
        setPageCount(pdf.numPages);
        setBasePageWidth(firstViewport.width);
        setBaseAspectRatio(firstViewport.width / firstViewport.height);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "PDF could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadPdf();
    return () => {
      cancelled = true;
      const activePdf = pdfDocumentRef.current as (LoadedPdfDocument & { destroy?: () => Promise<void> | void }) | null;
      pdfDocumentRef.current = null;
      if (loadingTask) {
        void loadingTask.destroy();
      }
      if (activePdf?.destroy) {
        void activePdf.destroy();
      } else if (activePdf) {
        void activePdf.cleanup();
      }
    };
  }, [initialPage, sourceUrl]);

  const useSpreadLayout = pageMode === "single"
    ? false
    : pageMode === "spread"
      ? true
      : isDesktop;
  const spreads = useMemo(() => buildSpreads(pageCount, useSpreadLayout), [pageCount, useSpreadLayout]);

  const initialSpreadIndex = useMemo(() => {
    if (!spreads.length) return 0;
    const safeInitialPage = Math.min(Math.max(1, initialPage), pageCount || 1);
    return Math.max(0, findSpreadIndex(spreads, safeInitialPage));
  }, [initialPage, pageCount, spreads]);

  const anchorSpreadIndex = useMemo(() => {
    if (!spreads.length) return 0;
    return Math.max(0, findSpreadIndex(spreads, Math.min(Math.max(1, anchorPageNumber), pageCount || 1)));
  }, [anchorPageNumber, pageCount, spreads]);

  const activeSpreadIndex = spreads[currentSpreadIndex] ? currentSpreadIndex : anchorSpreadIndex;
  const currentSpread = spreads[activeSpreadIndex] ?? null;

  const renderablePages = useMemo(() => {
    const pages = new Set<number>();
    const spreadIndexes = new Set<number>();

    for (let index = initialSpreadIndex - 1; index <= initialSpreadIndex + 1; index += 1) {
      if (index >= 0 && index < spreads.length) spreadIndexes.add(index);
    }
    for (let index = activeSpreadIndex - RENDER_WINDOW_RADIUS; index <= activeSpreadIndex + RENDER_WINDOW_RADIUS; index += 1) {
      if (index >= 0 && index < spreads.length) spreadIndexes.add(index);
    }

    spreadIndexes.forEach((index) => {
      spreads[index]?.pages.forEach((page) => pages.add(page));
    });
    return pages;
  }, [activeSpreadIndex, initialSpreadIndex, spreads]);

  const scrollToSpread = useCallback((
    spreadIndex: number,
    behavior: ScrollBehavior = "smooth",
    anchorPageOverride?: number,
  ) => {
    const container = scrollContainerRef.current;
    const spread = spreads[spreadIndex];
    const element = spread ? spreadRefs.current.get(spread.key) : null;
    if (!container || !spread || !element) return;

    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const targetTop = elementRect.top - containerRect.top + container.scrollTop - 16;

    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior,
    });
    setCurrentSpreadIndex(spreadIndex);
    setAnchorPageNumber(anchorPageOverride ?? spread.pages[0] ?? 1);
  }, [spreads]);

  const scrollToPage = useCallback((pageNumber: number, behavior: ScrollBehavior = "smooth") => {
    const safePage = Math.min(Math.max(1, pageNumber), pageCount || 1);
    const targetSpreadIndex = findSpreadIndex(spreads, safePage);
    if (targetSpreadIndex >= 0) {
      setAnchorPageNumber(safePage);
      scrollToSpread(targetSpreadIndex, behavior, safePage);
    }
  }, [pageCount, scrollToSpread, spreads]);

  useEffect(() => {
    if (!spreads.length || loading || didInitialScrollRef.current) return;
    didInitialScrollRef.current = true;
    requestAnimationFrame(() => scrollToPage(initialPage, "auto"));
  }, [initialPage, loading, scrollToPage, spreads]);

  useEffect(() => {
    if (lastLayoutModeRef.current === null) {
      lastLayoutModeRef.current = useSpreadLayout;
      return;
    }
    if (lastLayoutModeRef.current === useSpreadLayout || loading || !spreads.length) return;

    lastLayoutModeRef.current = useSpreadLayout;
    requestAnimationFrame(() => scrollToPage(anchorPageNumber, "auto"));
  }, [anchorPageNumber, loading, scrollToPage, spreads, useSpreadLayout]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !spreads.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const spreadKey = entry.target.getAttribute("data-spread-key");
          if (!spreadKey) return;
          visibleSpreadRatiosRef.current.set(spreadKey, entry.isIntersecting ? entry.intersectionRatio : 0);
        });

        let bestIndex = activeSpreadIndex;
        let bestRatio = -1;
        spreads.forEach((spread, index) => {
          const ratio = visibleSpreadRatiosRef.current.get(spread.key) ?? 0;
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestIndex = index;
          }
        });

        if (bestRatio >= 0 && bestIndex !== activeSpreadIndex) {
          const nextSpread = spreads[bestIndex];
          setCurrentSpreadIndex(bestIndex);
          if (nextSpread && !nextSpread.pages.includes(anchorPageNumber)) {
            setAnchorPageNumber(nextSpread.pages[0] ?? 1);
          }
        }
      },
      {
        root: container,
        threshold: SPREAD_OBSERVER_THRESHOLDS,
      },
    );

    spreadRefs.current.forEach((element) => {
      if (element) observer.observe(element);
    });

    return () => observer.disconnect();
  }, [activeSpreadIndex, anchorPageNumber, spreads]);

  const commitPageInput = useCallback(() => {
    const parsed = Number.parseInt(pageInputDraft, 10);
    scrollToPage(Number.isNaN(parsed) ? currentSpread?.pages[0] ?? 1 : parsed);
    setIsEditingPageInput(false);
  }, [currentSpread, pageInputDraft, scrollToPage]);

  const statusBadge = useMemo(() => {
    if (pageStatus === "fallback") return "Approximate page";
    if (pageStatus === "out_of_range") return "Needs page fix";
    if (sourceStatus === "not_uploaded") return "Source unavailable";
    return null;
  }, [pageStatus, sourceStatus]);

  const pageInputValue = isEditingPageInput
    ? pageInputDraft
    : String(Math.min(Math.max(1, anchorPageNumber), pageCount || Math.max(1, initialPage)));

  const positionBadge = useMemo(() => {
    if (!currentSpread || !pageCount) return "Preparing pages";
    const [firstPage, secondPage] = currentSpread.pages;
    const safeAnchorPage = Math.min(Math.max(1, anchorPageNumber), pageCount);
    if (!useSpreadLayout) return `Page ${safeAnchorPage} / ${pageCount}`;
    const spreadLabel = `Spread ${activeSpreadIndex + 1} / ${spreads.length}`;
    if (secondPage) return `${spreadLabel} · Page ${safeAnchorPage} (${firstPage}-${secondPage}) / ${pageCount}`;
    return `${spreadLabel} · Page ${firstPage} / ${pageCount}`;
  }, [activeSpreadIndex, anchorPageNumber, currentSpread, pageCount, spreads.length, useSpreadLayout]);

  return (
    <main className="library-page min-h-screen px-3 py-3 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:gap-5">
        {isDesktop && (
          <div className="soft-panel flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="overline mb-2">PDF viewer</div>
              <h1 className="text-2xl sm:text-3xl">{publicTopperName}</h1>
              <p className="mt-2 text-sm text-secondary">
                OCR/AI study aids can be imperfect. Verify against the original PDF page before relying on summary or matching cues.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="study-badge study-badge-accent">{positionBadge}</span>
              {statusBadge && <span className="study-badge">{statusBadge}</span>}
            </div>
          </div>
        )}

        <div className="soft-panel flex flex-wrap items-center justify-between gap-2 p-2.5 sm:gap-3 sm:p-3">
          <div className="flex flex-wrap items-center gap-2">
            {!isDesktop && <span className="study-badge study-badge-accent">{positionBadge}</span>}
            {!isDesktop && statusBadge && <span className="study-badge">{statusBadge}</span>}
            <button
              type="button"
              className="btn-secondary"
              disabled={loading || activeSpreadIndex <= 0}
              onClick={() => scrollToSpread(Math.max(0, activeSpreadIndex - 1))}
            >
              <ChevronLeft size={15} aria-hidden="true" /> Prev
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={loading || activeSpreadIndex >= spreads.length - 1}
              onClick={() => scrollToSpread(Math.min(spreads.length - 1, activeSpreadIndex + 1))}
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
              value={pageInputValue}
              onFocus={() => {
                setIsEditingPageInput(true);
                setPageInputDraft(pageInputValue);
              }}
              onBlur={commitPageInput}
              onChange={(event) => setPageInputDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitPageInput();
                }
              }}
              className="soft-input h-10 w-24 px-3 text-sm"
            />
            <label className="study-badge" htmlFor="pdf-page-mode">Pages</label>
            <select
              id="pdf-page-mode"
              className="soft-input h-10 px-3 text-sm"
              value={pageMode}
              onChange={(event) => setPageMode(event.currentTarget.value as PdfPageMode)}
            >
              <option value="auto">Auto</option>
              <option value="single">One page</option>
              <option value="spread">Two page</option>
            </select>
            <select
              className="soft-input h-10 px-3 text-sm"
              value={String(scale)}
              onChange={(event) => {
                userSelectedZoomRef.current = true;
                setScale((Number(event.currentTarget.value) || DEFAULT_DESKTOP_ZOOM) as (typeof ZOOM_OPTIONS)[number]);
              }}
            >
              {ZOOM_OPTIONS.map((zoom) => (
                <option key={zoom} value={zoom}>
                  {Math.round(zoom * 100)}%
                </option>
              ))}
            </select>
          </div>
        </div>

        <div ref={scrollContainerRef} className="soft-panel h-[84vh] overflow-auto p-2 sm:h-[78vh] sm:p-6">
          {loading && (
            <div className="flex min-h-full flex-col items-center justify-center gap-3 text-secondary" role="status" aria-live="polite">
              <Loader2 size={24} className="animate-spin" aria-hidden="true" />
              <p>Loading document…</p>
            </div>
          )}
          {error && !loading && (
            <div className="flex min-h-full items-center justify-center" role="alert">
              <div className="max-w-xl text-center text-secondary">
                <p className="font-semibold text-primary">PDF could not be loaded.</p>
                <p className="mt-2 text-sm">{error}</p>
              </div>
            </div>
          )}
          {!loading && !error && pdfDocument && (
            <div className="flex min-w-full flex-col items-center gap-6 pb-2">
              {spreads.map((spread) => (
                <div
                  key={spread.key}
                  ref={(element) => registerSpreadElement(spread.key, element)}
                  data-spread-key={spread.key}
                  className="flex w-full justify-center gap-4 lg:w-fit lg:max-w-none lg:flex-row lg:items-start"
                >
                  {spread.pages.map((pageNumber) => {
                    const sharedProps = {
                      pageNumber,
                      basePageWidth,
                      baseAspectRatio,
                      isDesktop,
                    };

                    return renderablePages.has(pageNumber) ? (
                      <PageCanvas
                        key={pageNumber}
                        {...sharedProps}
                        pdfDocument={pdfDocument}
                        scale={scale}
                      />
                    ) : (
                      <PagePlaceholder key={pageNumber} {...sharedProps} />
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={`text-center text-xs text-muted ${isDesktop ? "" : "hidden"}`}>
          Answer id: <span className="mono-stat">{answerId}</span>
        </div>
      </div>
    </main>
  );
}
