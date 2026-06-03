/**
 * rebuild-all.js
 *
 * Full pipeline in plain Node.js (no tsx dependency):
 * 1. Reads public/data.json (all records)
 * 2. Groups records by fuzzy-matched question
 * 3. Matches Google Drive links to local PDFs in public/pdfs/
 * 4. Outputs questions.json and categories.json (NO 100-question cap)
 *
 * Usage: node scripts/rebuild-all.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const INPUT = path.join(ROOT, "data-sources", "data.json");
const OUTPUT_DIR = path.join(ROOT, "public", "data");
const QUESTIONS_OUT = path.join(OUTPUT_DIR, "questions.json");
const CATEGORIES_OUT = path.join(OUTPUT_DIR, "categories.json");
const PDFS_DIR = path.join(ROOT, "local-pdfs");

// ─── Fuzzy key ──────────────────────────────────────────────────────────────
function fuzzyKey(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Value-add filtering ────────────────────────────────────────────────────
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

function isValid(val) {
  if (val === null || val === undefined) return false;
  const s = String(val).trim();
  const lower = s.toLowerCase();
  if (SKIP_VALUES.has(lower)) return false;
  if (lower.startsWith("not ")) return false;
  return s.length > 0;
}

// ─── Category detection ─────────────────────────────────────────────────────
function detectCategory(rec) {
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

// ─── Field extraction ───────────────────────────────────────────────────────
function extractName(rec) {
  const raw =
    rec.filename ||
    rec.name ||
    rec.topper_name ||
    rec.topper_copies ||
    "Unknown Topper";
  return String(raw).trim();
}

function extractRank(rec) {
  const raw = rec.rank || rec.air || rec.final_rank || "";
  return String(raw).trim().replace(/[^\d]/g, "");
}

function extractMarks(rec) {
  const val =
    rec.subject_marks || rec.marks || rec.total_marks || rec.test_marks;
  return val ? String(val).trim() : "";
}

function extractPage(rec) {
  return String(rec.page || "")
    .replace(/^page\s*/i, "")
    .trim();
}

function extractIntroduction(rec) {
  return String(rec.introduction || "").trim();
}

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

function extractValueAdds(rec) {
  const result = [];
  for (const field of VA_FIELDS) {
    if (isValid(rec[field])) {
      result.push({ type: field, value: String(rec[field]).trim() });
    }
  }
  return result;
}

// ─── Local PDF map ──────────────────────────────────────────────────────────
function buildPdfMap() {
  const map = new Map();
  if (!fs.existsSync(PDFS_DIR)) return map;

  const entries = fs.readdirSync(PDFS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.name.toLowerCase().endsWith(".pdf")) continue;

    const relativePath = "/pdfs/" + entry.name;
    const nameNoExt = entry.name.replace(/\.pdf$/i, "");
    const cleanId = nameNoExt.replace(/^drive_/, "");

    map.set(cleanId.toLowerCase(), relativePath);
    map.set(
      `https://drive.google.com/file/d/${cleanId}/view`.toLowerCase(),
      relativePath,
    );
    map.set(nameNoExt.toLowerCase(), relativePath);
  }
  return map;
}

function resolveLink(rawLink, pdfMap) {
  if (!rawLink || typeof rawLink !== "string") return rawLink;
  if (rawLink.startsWith("/pdfs/")) return rawLink;

  const lower = rawLink.toLowerCase().trim();
  if (pdfMap.has(lower)) return pdfMap.get(lower);

  const m = rawLink.match(/\/file\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) {
    const fileId = m[1].toLowerCase();
    if (pdfMap.has(fileId)) return pdfMap.get(fileId);
  }

  return rawLink;
}

// ─── Main ───────────────────────────────────────────────────────────────────
function main() {
  console.log("🔍 Building local PDF map...");
  const pdfMap = buildPdfMap();
  console.log(
    `   ${pdfMap.size} index entries from ${fs.readdirSync(PDFS_DIR).filter((f) => f.endsWith(".pdf")).length} PDFs`,
  );

  console.log("📖 Reading data.json...");
  const records = JSON.parse(fs.readFileSync(INPUT, "utf-8"));
  console.log(`   ${records.length.toLocaleString()} raw records`);

  const groupMap = new Map();
  let skippedNoQuestion = 0;

  for (const rec of records) {
    const questionText = String(rec.question || rec.essay_title || "").trim();
    if (!isValid(questionText)) {
      skippedNoQuestion++;
      continue;
    }

    const key = fuzzyKey(questionText);

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        question: questionText,
        syllabus_tags: [],
        category: detectCategory(rec),
        toppers: [],
      });
    }

    const group = groupMap.get(key);

    const syl = String(rec.syllabus || "").trim();
    if (syl && !group.syllabus_tags.includes(syl)) {
      group.syllabus_tags.push(syl);
    }

    const rawLink =
      rec.links || rec.link || rec.direct_link_for_entire_folder || "";
    const links = resolveLink(String(rawLink).trim(), pdfMap);

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

  // Convert to array and assign sequential IDs
  const allQuestions = Array.from(groupMap.values()).map((q, i) => ({
    id: i + 1,
    ...q,
  }));

  console.log(
    `   ${skippedNoQuestion.toLocaleString()} records skipped (no question text)`,
  );
  console.log(
    `   ${allQuestions.length.toLocaleString()} unique question groups`,
  );

  // Stats
  const categoryCounts = {};
  let totalToppers = 0;
  let localLinks = 0;
  let driveLinks = 0;

  for (const q of allQuestions) {
    categoryCounts[q.category] = (categoryCounts[q.category] || 0) + 1;
    for (const t of q.toppers) {
      totalToppers++;
      if (t.links.startsWith("/pdfs/")) localLinks++;
      else if (t.links.includes("drive.google.com")) driveLinks++;
    }
  }

  console.log(`   Total topper entries: ${totalToppers.toLocaleString()}`);
  console.log(`   ✅ Local PDF links: ${localLinks.toLocaleString()}`);
  console.log(
    `   ⚠️  Google Drive links (PDF missing): ${driveLinks.toLocaleString()}`,
  );

  // Write output
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(QUESTIONS_OUT, JSON.stringify(allQuestions));
  fs.writeFileSync(
    CATEGORIES_OUT,
    JSON.stringify({
      categories: Object.entries(categoryCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      total_questions: allQuestions.length,
      total_toppers: totalToppers,
    }),
  );

  console.log("\n🎉 Done! Output written to public/data/");
  console.log(`   questions.json: ${allQuestions.length} questions`);
  console.log(
    `   categories.json: ${Object.keys(categoryCounts).length} categories`,
  );

  // Auto-apply R2 link mapping
  applyR2Mapping();
}

function applyR2Mapping() {
  const R2_MAP = path.join(OUTPUT_DIR, "pdf-r2-map.json");
  if (!fs.existsSync(R2_MAP)) {
    console.log(
      "   ⚠️  No pdf-r2-map.json found — skipping R2 link replacement",
    );
    return;
  }

  const questions = JSON.parse(fs.readFileSync(QUESTIONS_OUT, "utf-8"));
  const r2Map = JSON.parse(fs.readFileSync(R2_MAP, "utf-8"));

  let replaced = 0;
  for (const q of questions) {
    for (const t of q.toppers) {
      if (!t.links || !t.links.startsWith("/pdfs/")) continue;
      const pdfPath = t.links.replace("/pdfs/", "");
      const nameNoExt = pdfPath.replace(/\.pdf$/i, "");
      const cleanId = nameNoExt.replace(/^drive_/, "");
      let r2Url = r2Map[cleanId] || r2Map[nameNoExt];
      if (!r2Url) {
        const lowerId = cleanId.toLowerCase();
        for (const [k, v] of Object.entries(r2Map)) {
          if (k.toLowerCase() === lowerId) {
            r2Url = v;
            break;
          }
        }
      }
      if (r2Url) {
        t.links = r2Url;
        replaced++;
      }
    }
  }

  fs.writeFileSync(QUESTIONS_OUT, JSON.stringify(questions));
  console.log(`   🔗 R2 links applied: ${replaced} replaced`);
}

main();
