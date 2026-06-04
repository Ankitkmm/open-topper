import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, join } from "path";
import * as XLSX from "xlsx";

const ROOT = process.cwd();
const SOURCE_URL = "https://toppercopies.upsckata.com/questions.csv";
const RAW_DIR = join(ROOT, "data-sources", "upsckata");
const RAW_CSV = join(RAW_DIR, "questions.csv");
const QUESTIONS_FILE = join(ROOT, "data", "app", "questions.json");
const CATEGORIES_FILE = join(ROOT, "data", "app", "categories.json");

type ValueAdd = {
  type: string;
  value: string;
};

type TopperEntry = {
  filename: string;
  rank: string;
  subject_marks: string;
  introduction: string;
  page: string;
  links: string;
  value_adds: ValueAdd[];
};

type QuestionGroup = {
  id: number;
  question: string;
  syllabus_tags: string[];
  keywords: string[];
  category: string;
  toppers: TopperEntry[];
};

type CsvRow = {
  topper?: string;
  coaching?: string;
  subject?: string;
  page_number?: string | number;
  question?: string;
  metadata?: string;
  url?: string;
};

async function main() {
  console.log("Fetching UPSCKata source...");
  const csv = await fetchCsv();
  mkdirSync(RAW_DIR, { recursive: true });
  writeFileSync(RAW_CSV, csv);
  console.log(`Saved raw CSV: ${relativePath(RAW_CSV)}`);

  const rows = parseRows(csv);
  console.log(`Parsed ${rows.length.toLocaleString()} CSV rows`);

  const existingQuestions = JSON.parse(readFileSync(QUESTIONS_FILE, "utf-8")) as QuestionGroup[];
  const questionMap = new Map<string, QuestionGroup>();
  let maxId = 0;

  for (const group of existingQuestions) {
    questionMap.set(questionKey(group.question), group);
    maxId = Math.max(maxId, Number(group.id) || 0);
  }

  let createdQuestions = 0;
  let addedTopperEntries = 0;
  let duplicateTopperEntries = 0;
  let skippedRows = 0;

  for (const row of rows) {
    const question = normalizeWhitespace(row.question);
    const rawUrl = normalizeWhitespace(row.url);
    if (!question || !rawUrl) {
      skippedRows += 1;
      continue;
    }

    const key = questionKey(question);
    const category = mapCategory(row.subject, question);
    const links = stripHash(rawUrl);
    const page = extractPage(row.page_number);
    const topperEntry = {
      filename: buildFilename(row, category, links),
      rank: "",
      subject_marks: extractMarks(row.metadata),
      introduction: "",
      page,
      links,
      value_adds: [],
    } satisfies TopperEntry;

    let group = questionMap.get(key);
    if (!group) {
      group = {
        id: ++maxId,
        question,
        syllabus_tags: [],
        keywords: [],
        category,
        toppers: [],
      };
      questionMap.set(key, group);
      existingQuestions.push(group);
      createdQuestions += 1;
    } else if (!group.category || group.category === "Other") {
      group.category = category;
    }

    const dedupeKey = topperKey(topperEntry);
    const alreadyPresent = group.toppers.some((existing) => topperKey(existing) === dedupeKey);
    if (alreadyPresent) {
      duplicateTopperEntries += 1;
      continue;
    }

    group.toppers.push(topperEntry);
    addedTopperEntries += 1;
  }

  writeFileSync(QUESTIONS_FILE, JSON.stringify(existingQuestions));
  writeFileSync(CATEGORIES_FILE, JSON.stringify(buildCategories(existingQuestions)));

  console.log(`Merged into ${relativePath(QUESTIONS_FILE)}`);
  console.log(`Updated ${relativePath(CATEGORIES_FILE)}`);
  console.log(`New question groups: ${createdQuestions.toLocaleString()}`);
  console.log(`New topper entries: ${addedTopperEntries.toLocaleString()}`);
  console.log(`Duplicate topper entries skipped: ${duplicateTopperEntries.toLocaleString()}`);
  console.log(`Skipped rows: ${skippedRows.toLocaleString()}`);
}

async function fetchCsv() {
  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${SOURCE_URL}: HTTP ${response.status}`);
  }

  return await response.text();
}

function parseRows(csv: string) {
  const workbook = XLSX.read(csv, { type: "string" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" }) as CsvRow[];
}

function questionKey(value: string) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeWhitespace(value: unknown) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function mapCategory(subject: unknown, question: string) {
  const value = normalizeWhitespace(subject).toUpperCase();
  if (value === "GS1") return "GS 1";
  if (value === "GS2") return "GS 2";
  if (value === "GS3") return "GS 3";
  if (value === "GS4") return "GS 4";
  if (value === "ESSAY") return "Essay";

  // Blank subject rows in this source are predominantly essay prompts/pages.
  if (!value && looksLikeEssay(question)) return "Essay";
  return "Essay";
}

function looksLikeEssay(question: string) {
  return /\b(?:essay|quote|virtue|truth|humanity|education|wisdom|light|war)\b/i.test(question)
    || /^q\.\d+/i.test(question)
    || /^(\d+)[.)]\s/.test(question);
}

function stripHash(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    return url.toString();
  } catch {
    return rawUrl.split("#")[0] || rawUrl;
  }
}

function extractPage(value: unknown) {
  const match = String(value ?? "").match(/\d+/);
  return match ? match[0] : "";
}

function extractMarks(metadata: unknown) {
  const text = normalizeWhitespace(metadata);
  const match = text.match(/marks:\s*([^,]+)/i);
  return match ? normalizeWhitespace(match[1]) : "";
}

function buildFilename(row: CsvRow, category: string, cleanUrl: string) {
  const topper = safeFilenamePart(row.topper);
  const coaching = safeFilenamePart(row.coaching);
  const sourceBase = safeFilenamePart(pdfBasename(cleanUrl));
  const pieces = [topper || "Anonymous topper"];

  if (coaching) pieces.push(coaching);
  if (!topper && sourceBase) pieces.push(sourceBase);
  if (!topper && !sourceBase) pieces.push(category);

  return `${pieces.join(" ").replace(/\s+/g, " ").trim().slice(0, 140) || "Unknown Topper"}.pdf`;
}

function pdfBasename(rawUrl: string) {
  try {
    return basename(new URL(rawUrl).pathname).replace(/\.pdf$/i, "");
  } catch {
    return basename(rawUrl).replace(/\.pdf$/i, "");
  }
}

function safeFilenamePart(value: unknown) {
  return normalizeWhitespace(value)
    .replace(/[^\w .()-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function topperKey(entry: TopperEntry) {
  return [
    stripHash(entry.links).toLowerCase(),
    extractPage(entry.page),
    entry.filename.toLowerCase(),
  ].join("|");
}

function buildCategories(questions: QuestionGroup[]) {
  const categoryCounts: Record<string, number> = {};
  let totalToppers = 0;

  for (const group of questions) {
    categoryCounts[group.category] = (categoryCounts[group.category] || 0) + 1;
    totalToppers += group.toppers.length;
  }

  return {
    categories: Object.entries(categoryCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    total_questions: questions.length,
    total_toppers: totalToppers,
  };
}

function relativePath(file: string) {
  return file.replace(`${ROOT}/`, "");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
