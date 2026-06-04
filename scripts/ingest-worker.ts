import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import * as dotenv from "dotenv";

const ROOT = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(ROOT, ".env.local") });

const QUEUE_FILE = path.join(ROOT, "data", "app", "ingest", "queue.json");
const OUT_DIR = path.join(ROOT, "data", "app", "ingest", "runs");
const RAW_DIR = path.join(ROOT, "data", "app", "ingest", "records");
const RUN_FILE = path.join(OUT_DIR, `run-${Date.now()}.json`);
const LIMIT = Number(process.env.INGEST_LIMIT || "250");
const OFFSET = Number(process.env.INGEST_OFFSET || "0");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
let OPENAI_ENABLED = Boolean(OPENAI_API_KEY);
let OPENAI_AUTH_WARNED = false;
const PYTHON = fs.existsSync(path.join(ROOT, ".venv", "bin", "python"))
  ? path.join(ROOT, ".venv", "bin", "python")
  : "python3";

type QueueRecord = {
  sourceQuestionId: number;
  sourceCategory: string;
  sourceQuestion: string;
  driveKey: string;
  fileName: string;
  link: string;
  pdfPath: string;
  introduction: string;
  page: string;
  syllabus: string;
  topperName: string;
  marks: string;
  valueAdds: { type: string; value: string }[];
};

type PdfPage = {
  pageNumber: number;
  text: string;
  wordCount: number;
  hasText: boolean;
};

type PdfMeta = {
  pageCount: number;
  totalWords: number;
  pages: PdfPage[];
};

type ResultRecord = {
  queueIndex: number;
  sourceQuestionId: number;
  sourceCategory: string;
  driveKey: string;
  fileName: string;
  pdfPath: string;
  link: string;
  topperName: string;
  question: string;
  pageHint: string;
  syllabus: string;
  marks: string;
  pdf: PdfMeta;
  selectedPages: number[];
  summary: string;
  valueAdditions: string[];
  assetMentions: string[];
  topicTags: string[];
  examinerRemarks: string;
  confidence: number;
  extractionMode: "local" | "hybrid";
  model?: {
    summary?: string;
    valueAdditions?: string[];
    assetMentions?: string[];
    topicTags?: string[];
    examinerRemarks?: string;
    pageNumbers?: number[];
    confidence?: number;
  };
};

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function safe(value: unknown): string {
  return String(value ?? "").trim();
}

function truncate(value: string, max = 2000): string {
  const clean = safe(value).replace(/\s+/g, " ");
  return clean.length <= max ? clean : `${clean.slice(0, max)}...`;
}

function extractDriveKey(value: string): string {
  const normalized = safe(value);
  const fromDrive = normalized.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/)?.[1];
  if (fromDrive) return fromDrive;
  const fromDrivePrefix = normalized.match(/^drive_([a-zA-Z0-9_-]{10,})/i)?.[1];
  if (fromDrivePrefix) return fromDrivePrefix;
  const fromId = normalized.match(/[?&]id=([a-zA-Z0-9_-]{10,})/)?.[1];
  if (fromId) return fromId;
  return normalized
    .replace(/\.pdf$/i, "")
    .replace(/^drive_/, "")
    .toLowerCase();
}

function extractGoogleDriveId(value: string): string | null {
  const normalized = safe(value);
  return (
    normalized.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/)?.[1] ||
    normalized.match(/[?&]id=([a-zA-Z0-9_-]{10,})/)?.[1] ||
    normalized.match(/^drive_([a-zA-Z0-9_-]{10,})/i)?.[1] ||
    null
  );
}

function sanitizeFileName(value: string): string {
  return safe(value)
    .replace(/\.pdf$/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "document";
}

function runPython(code: string, args: string[] = []) {
  const result = spawnSync(PYTHON, ["-c", code, ...args], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "python helper failed").trim());
  }
  return result.stdout.trim();
}

function extractPdfMeta(pdfPath: string): PdfMeta {
  const script = `
import json, sys
import fitz

doc = fitz.open(sys.argv[1])
pages = []
total_words = 0
for i, page in enumerate(doc, start=1):
    try:
        text = page.get_text("text") or ""
    except Exception:
        text = ""
    text = text.strip()
    wc = len(text.split())
    total_words += wc
    pages.append({
        "pageNumber": i,
        "text": text,
        "wordCount": wc,
        "hasText": bool(text),
    })

print(json.dumps({
    "pageCount": len(doc),
    "totalWords": total_words,
    "pages": pages,
}, ensure_ascii=False))
`;
  return JSON.parse(runPython(script, [pdfPath])) as PdfMeta;
}

function renderPdfPages(pdfPath: string, pages: number[]): Record<number, string> {
  const pageList = pages.join(",");
  if (!pageList) return {};
  const script = `
import base64, json, sys
import fitz

pdf_path = sys.argv[1]
page_nums = [int(v) for v in sys.argv[2].split(",") if v.strip()]
doc = fitz.open(pdf_path)
result = {}
for page_num in page_nums:
    if page_num < 1 or page_num > len(doc):
        continue
    page = doc.load_page(page_num - 1)
    pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0), alpha=False)
    b64 = base64.b64encode(pix.tobytes("png")).decode("ascii")
    result[str(page_num)] = "data:image/png;base64," + b64
print(json.dumps(result))
`;
  const parsed = JSON.parse(runPython(script, [pdfPath, pageList])) as Record<string, string>;
  return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [Number(k), v]));
}

function detectAssets(text: string) {
  const assets = new Set<string>();
  const patterns: [string, RegExp][] = [
    ["Judgment", /\b[A-Z][A-Za-z.\s-]{2,40}\s+(?:v\.|vs\.?|versus)\s+[A-Z][A-Za-z.\s-]{2,40}\b/g],
    ["Committee", /\b[A-Z][A-Za-z.\s-]{2,50}\s+(?:Committee|Commission)\b/g],
    ["Report", /\b[A-Z][A-Za-z.\s-]{2,60}\s+Report\b/g],
    ["SDG", /\bSDG\s*\d{1,2}\b/gi],
    ["Article", /\bArticle\s+\d+[A-Z]?\b/gi],
    ["Act", /\b[A-Z][A-Za-z\s-]{2,60}\s+Act,?\s*(?:19|20)\d{2}\b/g],
    ["Scheme", /\b[A-Z][A-Za-z\s-]{2,60}\s+Scheme\b/g],
    ["Organisation", /\b(?:UNESCO|UNICEF|WHO|IMF|World Bank|WTO|UNDP|UNFPA|FAO|OECD|ILO|ASEAN|BRICS|G20)\b/g],
    ["Quote", /"[^"]{20,160}"/g],
  ];
  for (const [, re] of patterns) {
    for (const match of text.matchAll(re)) assets.add(match[0].trim());
  }
  return [...assets].slice(0, 20);
}

function choosePages(meta: PdfMeta, pageHint: string): number[] {
  const hint = Number.parseInt(pageHint.replace(/[^\d]/g, ""), 10);
  const candidates = new Set<number>();
  if (meta.pageCount <= 3) {
    for (let i = 1; i <= meta.pageCount; i++) candidates.add(i);
    return [...candidates];
  }

  candidates.add(1);
  const richest = [...meta.pages].sort((a, b) => b.wordCount - a.wordCount).slice(0, 1);
  for (const page of richest) candidates.add(page.pageNumber);
  if (Number.isFinite(hint) && hint >= 1 && hint <= meta.pageCount) candidates.add(hint);
  if (meta.pageCount > 1) candidates.add(meta.pageCount);

  return [...candidates].sort((a, b) => a - b).slice(0, 4);
}

function buildLocalSummary(record: QueueRecord, meta: PdfMeta, selectedPages: number[]) {
  const pageTexts = selectedPages
    .map((pageNumber) => meta.pages.find((page) => page.pageNumber === pageNumber)?.text || "")
    .filter(Boolean);
  const combined = pageTexts.join("\n");
  const summary = truncate([record.sourceQuestion, record.introduction, combined].filter(Boolean).join(" "), 1200);
  return {
    summary,
    assetMentions: detectAssets(combined),
    valueAdditions: [
      ...(record.introduction ? [record.introduction] : []),
      ...(record.valueAdds || []).map((item) => `${item.type}: ${item.value}`),
    ],
    topicTags: record.syllabus ? [record.syllabus] : [],
    examinerRemarks: "",
    confidence: Math.min(0.55 + Math.min(meta.totalWords / 5000, 0.25), 0.8),
  };
}

function extractJsonFromText(text: string) {
  const trimmed = text.trim();
  const fence = trimmed.match(/```json\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function resolvePdfSource(record: QueueRecord) {
  if (record.pdfPath) {
    const abs = path.join(ROOT, record.pdfPath);
    if (fs.existsSync(abs)) return abs;
  }

  if (record.link.startsWith("/")) {
    const abs = path.join(ROOT, record.link);
    if (fs.existsSync(abs)) return abs;
  }

  const driveId = extractGoogleDriveId(record.link || record.fileName || record.driveKey);
  if (!driveId) return "";

  const cacheDir = path.join(ROOT, "data", "app", "ingest", "pdf-cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const cached = path.join(cacheDir, `${sanitizeFileName(record.fileName || record.driveKey || driveId)}_${driveId}.pdf`);
  if (fs.existsSync(cached) && fs.statSync(cached).size > 0) return cached;

  const downloadUrl = `https://drive.google.com/uc?export=download&id=${driveId}`;
  const response = await fetch(downloadUrl, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!response.ok) return "";

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 2048) return "";
  fs.writeFileSync(cached, bytes);
  return cached;
}

async function callOpenAI(record: QueueRecord, meta: PdfMeta, selectedPages: number[]) {
  if (!OPENAI_API_KEY || !OPENAI_ENABLED) return null;

  const sparsePages = selectedPages.filter((pageNumber) => {
    const page = meta.pages.find((p) => p.pageNumber === pageNumber);
    return !page || page.wordCount < 20;
  });
  const images = sparsePages.length ? renderPdfPages(record.pdfPath, sparsePages) : {};

  const pageBlocks = selectedPages.map((pageNumber) => {
    const page = meta.pages.find((p) => p.pageNumber === pageNumber);
    const text = page ? truncate(page.text, 2500) : "";
    return `PAGE ${pageNumber}\nTEXT:\n${text || "[no extracted text]"}`;
  }).join("\n\n");

  const prompt = [
    "You are extracting structured study metadata from a UPSC topper-copy PDF page packet.",
    "Use the Excel row metadata as authoritative when present.",
    "Return STRICT JSON with keys: summary, examinerRemarks, valueAdditions, assetMentions, topicTags, pageNumbers, confidence.",
    "Keep summary concise and focused on what the answer argues and which page(s) contain the best evidence.",
    `Excel question: ${truncate(record.sourceQuestion, 500)}`,
    `Excel intro: ${truncate(record.introduction, 400)}`,
    `Excel syllabus: ${truncate(record.syllabus, 300)}`,
    `Excel page hint: ${truncate(record.page, 50)}`,
    `Excel topper name: ${truncate(record.topperName, 100)}`,
    `Selected pages:\n${pageBlocks}`,
  ].join("\n");

  const content: Array<Record<string, unknown>> = [{ type: "input_text", text: prompt }];
  for (const pageNumber of selectedPages) {
    const page = meta.pages.find((p) => p.pageNumber === pageNumber);
    const text = page ? truncate(page.text, 1800) : "";
    content.push({ type: "input_text", text: `Page ${pageNumber} text:\n${text || "[no extracted text]"}` });
    if (images[pageNumber]) {
      content.push({ type: "input_image", image_url: images[pageNumber] });
    }
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      reasoning: { effort: "low" },
      input: [{ role: "user", content }],
      max_output_tokens: 900,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    if ((response.status === 401 || response.status === 403) && OPENAI_ENABLED) {
      OPENAI_ENABLED = false;
      if (!OPENAI_AUTH_WARNED) {
        OPENAI_AUTH_WARNED = true;
        console.warn("OpenAI auth failed; continuing batch in local mode.");
      }
    }
    throw new Error(`OpenAI request failed: ${response.status} ${JSON.stringify(data).slice(0, 500)}`);
  }

  const text = typeof data.output_text === "string"
    ? data.output_text
    : Array.isArray(data.output)
      ? data.output
          .flatMap((item: any) => item?.content || [])
          .map((part: any) => part?.text || "")
          .join("\n")
      : "";

  return extractJsonFromText(text);
}

async function processRecord(record: QueueRecord, idx: number): Promise<ResultRecord> {
  const pdfPath = await resolvePdfSource(record);

  if (!pdfPath) {
    const local = buildLocalSummary(record, { pageCount: 0, totalWords: 0, pages: [] }, [1]);
    return {
      queueIndex: idx,
      sourceQuestionId: record.sourceQuestionId,
      sourceCategory: record.sourceCategory,
      driveKey: record.driveKey,
      fileName: record.fileName,
      pdfPath,
      link: record.link,
      topperName: record.topperName,
      question: record.sourceQuestion,
      pageHint: record.page,
      syllabus: record.syllabus,
      marks: record.marks,
      pdf: { pageCount: 0, totalWords: 0, pages: [] },
      selectedPages: [],
      summary: local.summary,
      valueAdditions: local.valueAdditions,
      assetMentions: local.assetMentions,
      topicTags: local.topicTags,
      examinerRemarks: local.examinerRemarks,
      confidence: local.confidence,
      extractionMode: "local",
    };
  }

  const meta = extractPdfMeta(pdfPath);
  const selectedPages = choosePages(meta, record.page);
  const local = buildLocalSummary(record, meta, selectedPages);
  const model = await callOpenAI({ ...record, pdfPath }, meta, selectedPages).catch(() => null);

  const modelSummary = safe(model?.summary || "");
  const result: ResultRecord = {
    queueIndex: idx,
    sourceQuestionId: record.sourceQuestionId,
    sourceCategory: record.sourceCategory,
    driveKey: record.driveKey,
    fileName: record.fileName,
    pdfPath,
    link: record.link,
    topperName: record.topperName,
    question: record.sourceQuestion,
    pageHint: record.page,
    syllabus: record.syllabus,
    marks: record.marks,
    pdf: meta,
    selectedPages,
    summary: modelSummary || local.summary,
    valueAdditions: Array.isArray(model?.valueAdditions) && model.valueAdditions.length ? model.valueAdditions : local.valueAdditions,
    assetMentions: Array.isArray(model?.assetMentions) && model.assetMentions.length ? model.assetMentions : local.assetMentions,
    topicTags: Array.isArray(model?.topicTags) && model.topicTags.length ? model.topicTags : local.topicTags,
    examinerRemarks: safe(model?.examinerRemarks || "") || local.examinerRemarks,
    confidence: typeof model?.confidence === "number" ? model.confidence : local.confidence,
    extractionMode: model ? "hybrid" : "local",
    model: model || undefined,
  };

  return result;
}

async function main() {
  if (!fs.existsSync(QUEUE_FILE)) {
    throw new Error(`Queue file not found: ${QUEUE_FILE}. Run build-ingest-queue first.`);
  }

  const queueData = readJson<{ records?: QueueRecord[] } | QueueRecord[]>(QUEUE_FILE, { records: [] });
  const records = Array.isArray(queueData)
    ? queueData.slice(OFFSET, OFFSET + LIMIT)
    : (queueData.records || []).slice(OFFSET, OFFSET + LIMIT);
  console.log(`Loaded ${Array.isArray(queueData) ? queueData.length : (queueData.records || []).length} queue records; offset=${OFFSET}, limit=${LIMIT}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(RAW_DIR, { recursive: true });

  const results: ResultRecord[] = [];
  for (let i = 0; i < records.length; i++) {
    const result = await processRecord(records[i], i);
    results.push(result);
    fs.writeFileSync(path.join(RAW_DIR, `record-${String(OFFSET + i).padStart(4, "0")}.json`), JSON.stringify(result, null, 2));
    console.log(`Processed ${OFFSET + i + 1}/${OFFSET + records.length}: ${records[i].fileName || records[i].driveKey || records[i].sourceQuestionId}`);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    limit: LIMIT,
    offset: OFFSET,
    processed: results.length,
    model: OPENAI_MODEL,
    hasApiKey: Boolean(OPENAI_API_KEY),
    mode: OPENAI_API_KEY ? "hybrid" : "local",
    results,
  };

  fs.writeFileSync(RUN_FILE, JSON.stringify(payload, null, 2));
  console.log(`Processed ${results.length} queued records`);
  console.log(`Output: ${RUN_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
