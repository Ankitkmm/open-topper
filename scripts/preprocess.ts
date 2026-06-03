/**
 * preprocess.ts — Aggressive Grouping Pipeline
 *
 * Reads public/data.json (merged Excel data),
 * groups records by fuzzy-matched question key,
 * extracts dynamic columns, filters value-adds,
 * and outputs question-grouped JSON.
 *
 * Usage: npx tsx scripts/preprocess.ts
 */

import * as fs from "fs";
import * as path from "path";

const INPUT = path.join(process.cwd(), "public", "data.json");
const OUTPUT_DIR = path.join(process.cwd(), "public", "data");
const QUESTIONS_OUT = path.join(OUTPUT_DIR, "questions.json");
const CATEGORIES_OUT = path.join(OUTPUT_DIR, "categories.json");
const PDF_MAP_FILE = path.join(OUTPUT_DIR, "pdf-map.json");
const LOCAL_PDFS_DIR = path.join(process.cwd(), "public", "pdfs");

// ─── Fuzzy matching: strip ALL punctuation, spaces, casing ──────────────────

function fuzzyKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "") // strip ALL punctuation
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();
}

// ─── Aggressive value-add filtering ─────────────────────────────────────────

const SKIP_VALUES = new Set([
  "",
  "na",
  "n/a",
  "-",
  "--",
  "none",
  "nil",
  "not provided",
  "not mentioned",
  "no diagram",
  "no",
  "nope",
  "...",
  "....",
]);

function isValid(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  const s = String(val).trim();
  const lower = s.toLowerCase();
  if (SKIP_VALUES.has(lower)) return false;
  if (lower.startsWith("not ")) return false;
  return s.length > 0;
}

// ─── Category detection ─────────────────────────────────────────────────────

function detectCategory(rec: Record<string, unknown>): string {
  const sourceFile = String(rec.source_file || "").toLowerCase();
  const sheetName = String(rec.sheet_name || "").toLowerCase();
  const syl = String(rec.syllabus || "").toLowerCase();
  const combined = sourceFile + " " + sheetName;

  if (combined.includes("essay")) return "Essay";
  if (combined.includes("gs4") || combined.includes("ethics")) return "GS 4";
  if (
    syl.includes("gs3") ||
    syl.includes("paper iii") ||
    syl.includes("paper 3")
  )
    return "GS 3";
  if (
    syl.includes("gs2") ||
    syl.includes("paper ii") ||
    syl.includes("paper 2")
  )
    return "GS 2";
  if (combined.includes("gs1") || syl.includes("gs1")) return "GS 1";
  if (combined.includes("geography")) return "Geography";
  if (combined.includes("sociology")) return "Sociology";
  if (combined.includes("psir")) return "PSIR";
  if (combined.includes("public")) return "Public Administration";
  if (combined.includes("anthropology")) return "Anthropology";
  if (combined.includes("history")) return "History";
  return "Other";
}

// ─── Dynamic column mapping ─────────────────────────────────────────────────

function extractMarks(rec: Record<string, unknown>): string {
  const val =
    rec.subject_marks || rec.marks || rec.total_marks || rec.test_marks;
  return val ? String(val).trim() : "";
}

function extractRank(rec: Record<string, unknown>): string {
  const raw = rec.rank || rec.air || rec.final_rank || "";
  return String(raw).trim().replace(/[^\d]/g, "");
}

function extractName(rec: Record<string, unknown>): string {
  const raw =
    rec.filename ||
    rec.name ||
    rec.topper_name ||
    rec.topper_copies ||
    "Unknown Topper";
  return String(raw).trim();
}

function extractLinks(rec: Record<string, unknown>): string {
  const raw = rec.links || rec.link || rec.direct_link_for_entire_folder || "";
  return String(raw).trim();
}

function extractPage(rec: Record<string, unknown>): string {
  return String(rec.page || "")
    .replace(/^page\s*/i, "")
    .trim();
}

function extractIntroduction(rec: Record<string, unknown>): string {
  return String(rec.introduction || "").trim();
}

// ─── Value-add extraction ───────────────────────────────────────────────────

const VA_FIELDS = [
  "diagram",
  "thinkers",
  "casestudy",
  "examples",
  "teachings",
  "datareports",
  "analysis",
  "tribe",
  "uniqueculturalpractice",
];

function extractValueAdds(rec: Record<string, unknown>) {
  const result: { type: string; value: string }[] = [];
  for (const field of VA_FIELDS) {
    if (isValid(rec[field])) {
      result.push({ type: field, value: String(rec[field]).trim() });
    }
  }
  return result;
}

// ─── Main ───────────────────────────────────────────────────────────────────

function loadPdfMap(): Record<string, string> {
  if (fs.existsSync(PDF_MAP_FILE)) {
    return JSON.parse(fs.readFileSync(PDF_MAP_FILE, "utf-8"));
  }
  return {};
}

/** Scan public/pdfs/ for local PDF files and build a filename match map */
function buildLocalPdfMap(): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(LOCAL_PDFS_DIR)) return map;

  function scan(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(full);
      } else if (entry.name.toLowerCase().endsWith(".pdf")) {
        const relative = "/pdfs/" + path.relative(LOCAL_PDFS_DIR, full);
        // Index by filename (without extension)
        const baseName = entry.name.replace(/\.pdf$/i, "").toLowerCase();
        map.set(baseName, relative);
        // Extract the raw name without extension
        const nameNoExt = entry.name.replace(/\.pdf$/i, "");
        // Strip "drive_" prefix if present (from download script naming)
        const cleanName = nameNoExt.replace(/^drive_/, "");
        // Index by clean name (actual Google Drive file ID)
        const fileIdMatch = cleanName.match(/([a-zA-Z0-9_-]{20,})/);
        if (fileIdMatch) {
          const fileId = fileIdMatch[1];
          map.set(fileId.toLowerCase(), relative);
          map.set(cleanName.toLowerCase(), relative);
          map.set(
            `https://drive.google.com/file/d/${fileId}/view`.toLowerCase(),
            relative,
          );
        }
      }
    }
  }

  scan(LOCAL_PDFS_DIR);
  return map;
}

function main() {
  console.log("Reading data.json...");
  const raw = fs.readFileSync(INPUT, "utf-8");
  const records: Record<string, unknown>[] = JSON.parse(raw);
  console.log(`Loaded ${records.length.toLocaleString()} raw records.`);

  // Load local PDF map (replaces Google Drive links with local paths)
  const pdfMap = loadPdfMap();
  if (Object.keys(pdfMap).length > 0) {
    console.log(
      `📂 Loaded PDF map: ${Object.keys(pdfMap).length} local replacements`,
    );
  }

  // Scan for local PDFs in public/pdfs/
  const localPdfMap = buildLocalPdfMap();
  if (localPdfMap.size > 0) {
    console.log(`📁 Found ${localPdfMap.size} local PDF index entries`);
  }

  const groupMap = new Map<
    string,
    {
      id: number;
      question: string;
      syllabus_tags: string[];
      category: string;
      toppers: Record<string, unknown>[];
    }
  >();

  for (const rec of records) {
    const questionText = String(rec.question || rec.essay_title || "").trim();
    if (!isValid(questionText)) continue;

    const key = fuzzyKey(questionText);

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        id: 0, // assigned later
        question: questionText,
        syllabus_tags: [],
        category: detectCategory(rec),
        toppers: [],
      });
    }

    const group = groupMap.get(key)!;

    // Collect unique syllabus tags
    const syl = String(rec.syllabus || "").trim();
    if (syl && !group.syllabus_tags.includes(syl)) {
      group.syllabus_tags.push(syl);
    }

    // Build topper entry
    let links = extractLinks(rec);
    // Replace Google Drive link with local PDF path if available
    if (links && pdfMap[links]) {
      links = pdfMap[links];
    } else if (links && localPdfMap.size > 0) {
      // Try matching by filename
      const fname = String(rec.filename || "")
        .replace(/\.pdf$/i, "")
        .toLowerCase();
      if (localPdfMap.has(fname)) {
        links = localPdfMap.get(fname)!;
      } else {
        // Try matching by Google Drive file ID
        const fileIdMatch = links.match(/\/file\/d\/([a-zA-Z0-9_-]{20,})/);
        if (fileIdMatch && localPdfMap.has(fileIdMatch[1].toLowerCase())) {
          links = localPdfMap.get(fileIdMatch[1].toLowerCase())!;
        }
      }
    }

    group.toppers.push({
      filename: extractName(rec),
      rank: extractRank(rec),
      subject_marks: extractMarks(rec),
      introduction: extractIntroduction(rec),
      page: extractPage(rec),
      links,
      value_adds: extractValueAdds(rec),
    });
  }

  // Convert Map to Array
  const allQuestions = Array.from(groupMap.values());

  // Assign sequential IDs
  const questions = allQuestions.map((q, i) => ({
    id: i + 1,
    question: q.question,
    syllabus_tags: q.syllabus_tags,
    category: q.category,
    toppers: q.toppers,
  }));

  const categoryCounts: Record<string, number> = {};
  let totalToppers = 0;

  questions.forEach((q) => {
    categoryCounts[q.category] = (categoryCounts[q.category] || 0) + 1;
    totalToppers += q.toppers.length;
  });

  fs.writeFileSync(QUESTIONS_OUT, JSON.stringify(questions));
  fs.writeFileSync(
    CATEGORIES_OUT,
    JSON.stringify({
      categories: Object.entries(categoryCounts).map(([name, count]) => ({
        name,
        count,
      })),
      total_questions: questions.length,
      total_toppers: totalToppers,
    }),
  );

  console.log(
    `✅ Success: ${questions.length} questions and ${totalToppers} toppers processed.`,
  );
}

main();
