import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const QUESTIONS_FILE = path.join(ROOT, "data", "app", "questions.json");
const LOCAL_PDFS_DIR = path.join(ROOT, "local-pdfs");
const DATA_DIR = path.join(ROOT, "data", "app");
const OUT_DIR = path.join(DATA_DIR, "ingest");
const OUT_FILE = path.join(OUT_DIR, "queue.json");

type RawTopper = {
  filename?: string;
  links?: string;
  page?: string;
  introduction?: string;
  subject_marks?: string;
  topperName?: string;
  name?: string;
  value_adds?: { type?: string; value?: string }[];
};

type RawQuestion = {
  id: number;
  question: string;
  category?: string;
  syllabus_tags?: string[];
  toppers?: RawTopper[];
};

type QueueRecord = {
  sourceQuestionId: number;
  sourceCategory: string;
  sourceQuestion: string;
  driveKey: string;
  fileName: string;
  link: string;
  pdfPath: string;
  page: string;
  introduction: string;
  syllabus: string;
  topperName: string;
  marks: string;
  valueAdds: { type: string; value: string }[];
};

function safe(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeFileKey(value: string): string {
  return safe(value)
    .replace(/\.pdf$/i, "")
    .replace(/^drive_/, "")
    .toLowerCase();
}

function extractDriveKey(value: string): string {
  const normalized = safe(value);
  const fromDrive = normalized.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/)?.[1];
  if (fromDrive) return fromDrive;
  const fromDrivePrefix = normalized.match(/^drive_([a-zA-Z0-9_-]{10,})/i)?.[1];
  if (fromDrivePrefix) return fromDrivePrefix;
  return normalizeFileKey(normalized);
}

function buildPdfIndex() {
  const index = new Map<string, string>();
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.toLowerCase().endsWith(".pdf")) continue;
      const relative = path.relative(ROOT, full);
      index.set(normalizeFileKey(entry.name), relative);
      index.set(normalizeFileKey(path.basename(entry.name)), relative);
      index.set(extractDriveKey(entry.name), relative);
    }
  };
  walk(LOCAL_PDFS_DIR);
  return index;
}

function main() {
  if (!fs.existsSync(QUESTIONS_FILE)) {
    throw new Error(`Questions file not found: ${QUESTIONS_FILE}`);
  }

  const pdfIndex = buildPdfIndex();
  const questions = JSON.parse(fs.readFileSync(QUESTIONS_FILE, "utf8")) as RawQuestion[];
  const queue: QueueRecord[] = [];
  const seen = new Set<string>();

  for (const question of questions) {
    for (const topper of question.toppers || []) {
      const fileName = safe(topper.filename);
      const link = safe(topper.links);
      const driveKey = extractDriveKey(link || fileName);
      const pdfPath = (
        pdfIndex.get(driveKey) ||
        (fileName ? pdfIndex.get(normalizeFileKey(fileName)) : "") ||
        (fileName ? pdfIndex.get(normalizeFileKey(path.basename(fileName))) : "") ||
        ""
      );
      const resolvedLink = link || pdfPath;
      const docKey = pdfPath || resolvedLink || driveKey || `${question.id}:${fileName}`;
      if (seen.has(docKey)) continue;
      seen.add(docKey);

      queue.push({
        sourceQuestionId: question.id,
        sourceCategory: safe(question.category),
        sourceQuestion: safe(question.question),
        driveKey,
        fileName,
        link: resolvedLink,
        pdfPath,
        page: safe(topper.page),
        introduction: safe(topper.introduction),
        syllabus: (question.syllabus_tags || []).join(" | "),
        topperName: safe(topper.topperName || topper.name),
        marks: safe(topper.subject_marks),
        valueAdds: (topper.value_adds || [])
          .filter((item) => safe(item?.value))
          .map((item) => ({ type: safe(item?.type), value: safe(item?.value) })),
      });
    }
  }

  const limited = queue.slice(0, Number(process.env.INGEST_LIMIT || "250"));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    limit: limited.length,
    totalQueued: queue.length,
    records: limited,
  }, null, 2));

  console.log(`Queued ${limited.length} unique PDFs out of ${queue.length}`);
  console.log(`Output: ${OUT_FILE}`);
}

main();
