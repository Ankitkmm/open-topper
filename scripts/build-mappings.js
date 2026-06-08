/**
 * build-mappings.js
 *
 * Strict, deterministic question clustering pipeline.
 * Groups topper copies ONLY by exact canonical question match.
 * Outputs structured JSON files to data/mappings/pyqs/
 *
 * Usage: node scripts/build-mappings.js
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const INPUT = fs.existsSync(path.join(ROOT, "data", "app", "questions.json"))
  ? path.join(ROOT, "data", "app", "questions.json")
  : path.join(ROOT, "public", "data", "questions.json");
const OUTPUT_DIR = path.join(ROOT, "data", "mappings", "pyqs");
const INDEX_FILE = path.join(ROOT, "data", "mappings", "index.json");
const TOPPER_NAME_OVERRIDES_FILE = path.join(ROOT, "data", "curation", "topper-name-overrides.json");
const TOPPER_NAME_OVERRIDES = readJson(TOPPER_NAME_OVERRIDES_FILE, {
  suppressedNames: [],
  canonicalNames: [],
  sourceNameOverrides: [],
  answerNameOverrides: [],
  suppressedSources: [],
});
const SUPPRESSED_NAME_KEYS = new Set((TOPPER_NAME_OVERRIDES.suppressedNames || []).map(normalizeNameKey));

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Generate deterministic hash ID from question text */
function generateQuestionId(questionText, category, index) {
  // Normalize: lowercase, strip punctuation, collapse whitespace
  const normalized = questionText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  const hash = crypto
    .createHash("sha256")
    .update(normalized)
    .digest("hex")
    .slice(0, 12);

  // Extract paper number from category (e.g., "GS 1" → "gs1")
  const paper = category
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");

  return `pyq_${paper}_${hash}`;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function normalizeNameKey(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/&/g, " and ")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function compactNameKey(value) {
  return normalizeNameKey(value).replace(/[^a-z0-9]+/g, "");
}

function curatedTopperName(value) {
  const key = normalizeNameKey(value);
  const compact = compactNameKey(value);
  if (!key) return null;

  for (const entry of TOPPER_NAME_OVERRIDES.canonicalNames || []) {
    const matchKey = normalizeNameKey(entry.match);
    const matchCompact = compactNameKey(entry.match);
    if (!matchKey) continue;
    if (key.includes(matchKey) || compact.includes(matchCompact)) return entry.name;
  }

  return null;
}

function sourceOverrideName(topper) {
  const filename = normalizeNameKey(topper?.filename || "");
  const link = String(topper?.links || "");
  const driveId = link.match(/drive\.google\.com\/file\/d\/([^/?#]+)/)?.[1]
    || link.match(/\/drive_([^/?#]+?)\.pdf(?:[?#]|$)/)?.[1]
    || String(topper?.filename || "").match(/^drive_([^/]+?)\.pdf$/i)?.[1]
    || "";

  for (const entry of TOPPER_NAME_OVERRIDES.sourceNameOverrides || []) {
    if (entry.driveId && driveId && entry.driveId === driveId) return entry.name;
    if (entry.filename && filename && normalizeNameKey(entry.filename) === filename) return entry.name;
    if (entry.sourceDocumentKey && filename && normalizeNameKey(entry.sourceDocumentKey) === filename) return entry.name;
  }

  return null;
}

function isSuppressedTopperName(value) {
  const clean = String(value || "").trim();
  const key = normalizeNameKey(clean);
  if (!key) return true;
  if (SUPPRESSED_NAME_KEYS.has(key)) return true;
  if (isLikelyMachineIdName(clean)) return true;

  return [
    /^pub(?:lic)?\s+adm(?:n|in)(?:istration)?$/i,
    /^anthro(?:pology)?\s+(?:society|theories|tribal)$/i,
    /^tsm\s+soc\s+nice\s+ias$/i,
    /^guidance\s+ias$/i,
    /^(?:geomorphology|climatology|biogeography|economic|population|environmental\s+geo|perspective|agriculture|tectonic\s+geomorphology)\b.*\b(?:handwritten|notes|watermarkedpdf)\b/i,
    /^(?:mts\s+nl\s+flt|flt)(?:\s+evaluated|\s+compressed)?$/i,
    /^evaluated(?:\s*copy)?$/i,
    /^anonymous\b/i,
    /^(?:test|class|question|copy|copies|topper\s+copies|checked|sent|scan)$/i,
  ].some((pattern) => pattern.test(clean));
}

function isLikelyMachineIdName(value) {
  const clean = String(value || "").trim();
  const key = normalizeNameKey(clean);
  if (!key) return true;

  const compact = key.replace(/\s+/g, "");
  if (/^[a-f0-9]{8,}$/i.test(compact) && /\d/.test(compact)) return true;
  if (/^[A-Za-z0-9_-]{18,}$/.test(clean) && /\d/.test(clean)) return true;
  if (/^[a-f]{6,}$/i.test(compact)) return true;

  const words = key.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.every((word) => /^[a-f]{1,6}$/i.test(word)) && compact.length >= 6;
}

/** Clean filename to extract human-readable topper name */
function extractTopperName(filename) {
  if (!filename || filename === "Unknown Topper") return null;

  const curated = curatedTopperName(filename);
  if (curated) return curated;

  const raw = filename.replace(/\.pdf$/i, "").replace(/^drive_/, "").trim();

  // Skip purely numeric/hex IDs
  if (/^[\d\s\-_]+$/.test(raw) || /^[a-f0-9]{20,}$/i.test(raw)) return null;
  if (/^unknown/i.test(raw)) return null;
  if (isSuppressedTopperName(raw)) return null;

  // Replace separators and clean
  let name = raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/watermarkedpdf/gi, " ")
    .replace(/watermark/gi, " ")
    .replace(/evaluated(?=[a-z])/gi, "evaluated ")
    .replace(/checked(?=[a-z])/gi, "checked ")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Remove test/copy identifiers
  name = name.replace(
    /\b(?:Paper|Test|Class|Copy|Copies|Sectional|Full|Mains|Answer|Model|PYQ|Optional|GS|VisionIAS|Vision\s+IAS|Next\s+IAS|ForumIAS|MGP|Evaluated|Checked|Rank|AIR|Marks?|Crash|Course|Program|Programme|Booklet|Topper|Toppers|FLT|MTS|NL|TA|TC)\s*(?:-?\s*[IVX0-9]+)?\b/gi,
    ""
  );
  name = name.replace(
    /\b(?:World History|Modern India|Ancient India|Medieval India|Indian History|Anthropology|Sociology|Geography|Public Administration|Pub Admn|Anthro|Geomorphology|Climatology|Handwritten|Notes|Society|Theories|Tribal|Guidance IAS|Nice IAS)\b/gi,
    ""
  );
  name = name.replace(/\b(?:19|20)\d{2}\b/g, " ");
  name = name.replace(/\b\d{4,}\b/g, " ");
  name = name.replace(/\b(?:r|t)\s*\d{1,4}\b/gi, " ");
  name = name.replace(/\b\d+(?:st|nd|rd|th)?\b/gi, " ");
  name = name.replace(/\([^)]*\)/g, "");
  name = name.replace(/\s+/g, " ").trim();

  const curatedAfterClean = curatedTopperName(name);
  if (curatedAfterClean) return curatedAfterClean;
  if (isSuppressedTopperName(name)) return null;

  if (!name || name.length < 2) {
    const words = raw
      .split(/[\s-_]+/)
      .filter((w) => w.length > 1 && !/^\d+$/.test(w));
    name = words.slice(0, 3).join(" ");
  }

  // Title case
  name = name.replace(/\b\w/g, (c) => c.toUpperCase());

  return name.slice(0, 50) || null;
}

/** Extract AIR rank from filename */
function extractRank(filename) {
  const m = filename.match(/AIR\s*(\d+)/i);
  if (m) return parseInt(m[1]);
  const m2 = filename.match(/Rank\s*(\d+)/i);
  if (m2) return parseInt(m2[1]);
  return null;
}

/** Extract year from filename */
function extractYear(filename) {
  let m = filename.match(/(?:Year|YR)[_\s]*(\d{4})/i);
  if (m) return parseInt(m[1]);
  m = filename.match(/\b((?:19|20)\d{2})\b/);
  if (m) {
    const y = parseInt(m[1]);
    if (y >= 2000 && y <= 2030) return y;
  }
  m = filename.match(/(\d{4})/);
  if (m) {
    const y = parseInt(m[1]);
    if (y >= 1900 && y <= 2030) return y;
  }
  return null;
}

/** Extract page number */
function extractPage(pageStr) {
  if (!pageStr) return null;
  const num = parseInt(String(pageStr).replace(/[^0-9]/g, ""));
  return num > 0 ? num : null;
}

/** Get clean CDN URL */
function getCdnUrl(link) {
  if (!link) return null;
  // Already an R2 URL
  if (link.includes("r2.dev") || link.includes("pub-")) return link;
  // Google Drive — keep as-is but mark
  if (link.includes("drive.google.com")) return link;
  return link || null;
}

/** Determine link source type */
function getLinkSource(link) {
  if (!link) return "missing";
  if (link.includes("r2.dev") || link.includes("pub-")) return "r2-cdn";
  if (link.includes("drive.google.com")) return "google-drive";
  return "unknown";
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Pipeline
// ═══════════════════════════════════════════════════════════════════════════

function main() {
  console.log("🔨 UPSC Path — Canonical Question Mapping Pipeline\n");

  // 1. Load data
  console.log("📖 Loading questions.json...");
  const questions = JSON.parse(fs.readFileSync(INPUT, "utf-8"));
  console.log(`   ${questions.length.toLocaleString()} question groups loaded\n`);

  // 2. Prepare output directory
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // 3. Process each question group
  const index = [];
  let totalToppers = 0;
  let totalMapped = 0;
  let skippedDuplicates = 0;
  let skippedNoName = 0;

  for (const group of questions) {
    const questionId = generateQuestionId(
      group.question,
      group.category,
      group.id
    );

    // Deduplicate toppers by filename + page
    const seen = new Set();
    const linkedAnswers = [];

    for (const topper of group.toppers) {
      const dedupeKey = topper.filename + "|" + (topper.page || "");
      if (seen.has(dedupeKey)) {
        skippedDuplicates++;
        continue;
      }
      seen.add(dedupeKey);

      const name = sourceOverrideName(topper) || extractTopperName(topper.filename);
      if (!name) {
        skippedNoName++;
        // Still include but with fallback
      }

      const pageNum = extractPage(topper.page);
      const cdnUrl = getCdnUrl(topper.links);
      const linkSource = getLinkSource(topper.links);

      linkedAnswers.push({
        topperName: name,
        rank: extractRank(topper.filename),
        year: extractYear(topper.filename),
        subjectMarks: topper.subject_marks || null,
        sourceCdnUrl: cdnUrl,
        linkSource: linkSource,
        exactPageNumber: pageNum,
        extractedIntroduction: topper.introduction || null,
        valueAdds: topper.value_adds || [],
        rawFilename: topper.filename,
      });

      totalToppers++;
    }

    // Skip questions with no linked answers
    if (linkedAnswers.length === 0) continue;

    // Determine paper and year from category and topper data
    const category = group.category;
    const paperMap = {
      "GS 1": "GS-1",
      "GS 2": "GS-2",
      "GS 3": "GS-3",
      "GS 4": "GS-4",
      Essay: "Essay",
      Geography: "Geography",
      Sociology: "Sociology",
      PSIR: "PSIR",
      "Public Administration": "Public-Administration",
      Anthropology: "Anthropology",
      History: "History",
    };

    // Estimate year from topper data (most common year)
    const yearCounts = {};
    for (const ans of linkedAnswers) {
      if (ans.year) {
        yearCounts[ans.year] = (yearCounts[ans.year] || 0) + 1;
      }
    }
    const estimatedYear = Object.entries(yearCounts).sort(
      (a, b) => b[1] - a[1]
    )[0];

    const mapping = {
      canonicalQuestionId: questionId,
      questionText: group.question,
      questionCategory: category,
      paper: paperMap[category] || category,
      estimatedYear: estimatedYear ? parseInt(estimatedYear[0]) : null,
      syllabusTags: group.syllabus_tags || [],
      keywords: group.keywords || [],
      totalLinkedToppers: linkedAnswers.length,
      linkedTopperAnswers: linkedAnswers,
    };

    // Write individual file
    const filePath = path.join(OUTPUT_DIR, `${questionId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(mapping, null, 2));

    // Add to index
    index.push({
      canonicalQuestionId: questionId,
      questionText: group.question.slice(0, 100),
      paper: mapping.paper,
      estimatedYear: mapping.estimatedYear,
      topperCount: linkedAnswers.length,
      file: `pyqs/${questionId}.json`,
    });

    totalMapped++;
  }

  // 4. Write index
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));

  // 5. Summary
  console.log("✅ Mapping complete!\n");
  console.log(`   Questions mapped:    ${totalMapped.toLocaleString()}`);
  console.log(`   Topper entries:       ${totalToppers.toLocaleString()}`);
  console.log(`   Duplicates skipped:   ${skippedDuplicates.toLocaleString()}`);
  console.log(`   No-name entries:      ${skippedNoName.toLocaleString()}`);
  console.log(`   Output directory:     data/mappings/pyqs/`);
  console.log(`   Index file:           data/mappings/index.json`);
  console.log(`   Files written:        ${totalMapped.toLocaleString()}`);

  // Show sample
  const sample = index[0];
  console.log(`\n📋 Sample entry:`);
  console.log(`   ID:    ${sample.canonicalQuestionId}`);
  console.log(`   Paper: ${sample.paper}`);
  console.log(`   Copies: ${sample.topperCount}`);
  console.log(`   Q:     ${sample.questionText}...`);
}

main();
