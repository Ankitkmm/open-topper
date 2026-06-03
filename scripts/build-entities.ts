/**
 * build-entities.ts — Master Relational Engine Builder
 *
 * Reads the flat questions.json, performs entity resolution, and outputs
 * a normalized relational dataset:
 *
 *   public/data/entities/
 *     toppers.json         — Unique topper entities (de-duplicated identities)
 *     questions.json       — Canonical questions with year/subject/marks
 *     topper-answers.json  — Join table: topper × question × page × OCR
 *     themes.json          — Theme entities with cross-subject links
 *     theme-questions.json — Many-to-many theme ↔ question
 *
 * Designed for incremental OCR updates — just re-run after adding
 * more OCR files to UPSC_topper_md/ and re-running build-ocr-links.ts
 *
 * Usage: npx tsx scripts/build-entities.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

const ROOT = path.resolve(__dirname, "..");
const INPUT = path.join(ROOT, "public", "data", "questions.json");
const OCR_MAP = path.join(ROOT, "public", "data", "ocr-summaries.json");
const R2_MAP = path.join(ROOT, "public", "data", "pdf-r2-map.json");
const OUT_DIR = path.join(ROOT, "public", "data", "entities");

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface RawTopper {
  filename: string;
  rank: string;
  subject_marks: string;
  introduction: string;
  page: string;
  links: string;
  value_adds: { type: string; value: string }[];
}

interface RawQuestion {
  id: number;
  question: string;
  syllabus_tags: string[];
  category: string;
  toppers: RawTopper[];
  keywords?: string[];
}

interface TopperEntity {
  id: string;
  displayName: string;
  aliases: string[];
  rank: number | null;
  year: number | null;
  optionalSubject: string | null;
  gsMarks: string | null;
  answerCount: number;
  questionIds: number[];
  driveIds: string[];
}

interface QuestionEntity {
  id: number;
  canonicalText: string;
  rawText: string;
  year: number | null;
  subject: string;
  paper: string;
  marks: number | null;
  syllabusTags: string[];
  themeIds: string[];
  topperAnswerCount: number;
}

interface TopperAnswerEntity {
  id: string;
  topperId: string;
  questionId: number;
  driveId: string | null;
  pageNumber: number | null;
  introduction: string | null;
  ocrSummary: string | null;
  valueAdds: { type: string; value: string }[];
  marksObtained: string | null;
  linkType: "r2-cdn" | "google-drive" | "none";
  cdnUrl: string | null;
  rawFilename: string;
}

interface ThemeEntity {
  id: string;
  name: string;
  questionCount: number;
  subjects: string[];
  crossSubjectLinks: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function hash(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 10);
}

function cleanName(raw: string): string {
  return raw
    .replace(/\.pdf$/i, "")
    .replace(/^drive_/, "")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Smart name extraction from PDF filenames.
 *
 * Filename patterns observed:
 *   "VisionIAS Toppers Answer Booklet ANIMESH PRADHAN socio.pdf"
 *   "Avdhija-Gupta_Full-Test-II_Medieval-India.pdf"
 *   "srushti_deshmukh_rank_5 Sociology Paper 1.pdf"
 *   "1746423149-Chhaya-Kumari-9.pdf"
 *   "ae2b9681-923a-4cfe-a897-5b46adc6561c.pdf"  ← UUID, not a person
 *   "Test 5.pdf"                                   ← not a person
 */

/** Strip known metadata prefixes from raw filename text */
const STRIP_PREFIXES = [
  /^vision\s*ias\s*toppers?\s*answer\s*booklet\s*/i,
  /^toppers?\s*answer\s*booklet\s*/i,
  /^toppers?\s*copy\s*/i,
  /^answer\s*booklet\s*/i,
  /^\d{4}\s*(?:public|gs|optional|paper|test|copy|answer|mains|prelims|syllabus|question)\b[^a-z]*/i, // "2023 PUBLIC ADMINISTRATION..."
  /^\d{10,}[-\s]*/i,               // Timestamp prefix like "1746423149-"
  /^_\s*/,
];

/** Patterns that indicate the extracted text is NOT a real person name */
const NOT_A_PERSON = [
  /^[a-f0-9]{8}[-]?[a-f0-9]{4}[-]?[a-f0-9]{4}[-]?[a-f0-9]{4}[-]?[a-f0-9]{6,}$/i, // UUID
  /^[a-f0-9]{20,}$/i,              // Long hex string
  /^test\s*\d*$/i,                 // "Test 5", "test"
  /^question\s*(paper\s*)?\d*$/i,  // "Question Paper 6"
  /^copy\s*\d*$/i,                 // "Copy 1"
  /^sectional\s*(test\s*)?\d*$/i,  // "Sectional Test"
  /^full\s*(test\s*)?\d*$/i,       // "Full Test"
  /^mains\s*(answer|test)?\s*\d*$/i,
  /^model\s*answer\s*\d*$/i,
  /^pyq\s*\d*$/i,
  /^gs\s*[1-4]$/i,
  /^optional\s*\d*$/i,
  /^paper\s*[IVX0-9]*$/i,
  /^file\s*\d*$/i,
  /^untitled$/i,
  /^document\s*\d*$/i,
  /^scan\s*\d*$/i,
  /^img[_\s]*\d*$/i,
  /^drive[_\s]*\d*$/i,
  /^\d{4}\s+\w+\s+\d+/i,          // "2023 PUBLIC ADMINISTRATION..."
  /^pratham/i,                      // Test series name
  /^top\s*scorer/i,
  /^evaluated/i,
  /top\s*scorer/i,                  // "TOP SCORER" anywhere
  /for\s*pratham/i,                 // "For Pratham" anywhere
  /^[a-f0-9]{1,8}[\s-][a-f0-9]{1,8}[\s-][a-f0-9]{1,8}/i, // UUID segments with spaces
];

/** Detects if a string looks like it contains a person's name */
function looksLikePersonName(text: string): boolean {
  if (!text || text.length < 3) return false;

  // Check against NOT_A_PERSON patterns
  for (const pat of NOT_A_PERSON) {
    if (pat.test(text.trim())) return false;
  }

  // Must have at least 2 alphabetic chars
  const alpha = (text.match(/[a-zA-Z]/g) || []).length;
  if (alpha < 3) return false;

  // Favor strings with TitleCase patterns (indicating proper names)
  const titleCaseWords = (text.match(/\b[A-Z][a-z]+\b/g) || []).length;

  // If entirely UPPERCASE with numbers, it's probably a code
  if (/^[A-Z0-9\s_\-]{3,}$/.test(text) && alpha < 5) return false;

  return true;
}

function extractDisplayName(filename: string): string {
  let raw = cleanName(filename);
  if (!raw) return "";

  // Step 1: Strip known metadata prefixes
  for (const pat of STRIP_PREFIXES) {
    raw = raw.replace(pat, "").trim();
  }

  // Step 2: Remove subject/topic suffixes and test metadata
  raw = raw
    .replace(/\b(?:Paper|Test|Copy|Sectional|Full|Mains|Answer|Model|PYQ|Optional|GS|Evaluated|Pratham|Vision|Forum|Next|Drishti)\s*(?:-?\s*[IVX0-9]+)?\b/gi, " ")
    .replace(/\b(?:World History|Modern India|Ancient India|Medieval India|Indian History|Anthropology|Sociology|Geography|History|Polity|Economy|Ethics|Essay|Socio)\b/gi, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b\d{10,}\b/g, " ")   // Timestamps
    .replace(/\b\d{4}\s+\d+\b/g, " ") // Date patterns
    .replace(/\s+/g, " ")
    .trim();

  if (!looksLikePersonName(raw)) return "";

  // Title case each word
  raw = raw.replace(/\b\w/g, (c) => c.toUpperCase());
  return raw.slice(0, 50);
}

function extractRank(filename: string): number | null {
  const m = filename.match(/AIR\s*(\d+)/i);
  if (m) return parseInt(m[1]);
  const m2 = filename.match(/Rank\s*(\d+)/i);
  if (m2) return parseInt(m2[1]);
  // Handle "Medha AIR 13 Copy 1"
  const m3 = filename.match(/\bAIR[_\s]*(\d{1,3})\b/i);
  if (m3) return parseInt(m3[1]);
  return null;
}

function extractYear(filename: string): number | null {
  let m = filename.match(/(?:Year|YR)[_\s]*(\d{4})/i);
  if (m) return parseInt(m[1]);
  m = filename.match(/\b((?:20)\d{2})\b/);
  if (m) {
    const y = parseInt(m[1]);
    if (y >= 2000 && y <= 2030) return y;
  }
  m = filename.match(/(\d{4})/);
  if (m) {
    const y = parseInt(m[1]);
    if (y >= 2000 && y <= 2030) return y;
  }
  return null;
}

function extractMarks(questionText: string): number | null {
  const m = questionText.match(/\((\d{1,3})\s*Marks?\)/i);
  if (m) return parseInt(m[1]);
  const m2 = questionText.match(/\b(\d{1,3})\s*Marks?\b/i);
  if (m2) return parseInt(m2[1]);
  return null;
}

function extractQuestionYear(questionText: string, category: string): number | null {
  // Try to find year in question text like "2023", "2022"
  const m = questionText.match(/\b((?:20)\d{2})\b/);
  if (m) {
    const y = parseInt(m[1]);
    if (y >= 2013 && y <= 2030) return y;
  }
  return null;
}

function extractDriveId(link: string): string | null {
  if (!link) return null;
  // Google Drive URL
  let m = link.match(/\/file\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  // R2 URL: /drive_XXXXX.pdf
  m = link.match(/\/drive_(.+?)\.pdf/i);
  if (m) return m[1];
  return null;
}

function getLinkType(link: string): "r2-cdn" | "google-drive" | "none" {
  if (!link) return "none";
  if (link.includes("r2.dev") || link.includes("pub-")) return "r2-cdn";
  if (link.includes("drive.google.com")) return "google-drive";
  return "r2-cdn";
}

function normalizeSubject(cat: string): string {
  const map: Record<string, string> = {
    "GS 1": "gs1", "GS 2": "gs2", "GS 3": "gs3", "GS 4": "gs4",
    Essay: "essay", Geography: "geography", Sociology: "sociology",
    PSIR: "psir", "Public Administration": "public-administration",
    Anthropology: "anthropology", History: "gs1",
  };
  return map[cat] || cat.toLowerCase().replace(/\s+/g, "-");
}

function normalizeNameForMatching(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "").trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 1: Topper Entity Resolution
// ═══════════════════════════════════════════════════════════════════════════

function resolveToppers(
  questions: RawQuestion[],
  r2Map: Record<string, string>,
  ocrMap: Record<string, { summary: string }>,
): { toppers: TopperEntity[]; topperIndex: Map<string, string> } {
  console.log("\n🔍 Phase 1: Resolving topper identities...");

  // Collect all candidate topper names from all question groups
  const candidateMap = new Map<string, {
    names: Set<string>;
    ranks: Set<number>;
    years: Set<number>;
    questionIds: Set<number>;
    driveIds: Set<string>;
    gsMarks: Set<string>;
    answerCount: number;
  }>();

  let skippedNonPerson = 0;
  let skippedEmpty = 0;

  for (const q of questions) {
    for (const t of q.toppers) {
      const displayName = extractDisplayName(t.filename);
      const rawName = cleanName(t.filename);

      // Only create topper entities for confidently-identified people
      if (!displayName) {
        skippedNonPerson++;
        continue; // Skip non-person filenames (UUIDs, "Test 5", etc.)
      }
      if (!rawName) { skippedEmpty++; continue; }

      const key = normalizeNameForMatching(displayName);
      if (!key || key.length < 3) { skippedEmpty++; continue; }

      if (!candidateMap.has(key)) {
        candidateMap.set(key, {
          names: new Set(),
          ranks: new Set(),
          years: new Set(),
          questionIds: new Set(),
          driveIds: new Set(),
          gsMarks: new Set(),
          answerCount: 0,
        });
      }

      const entry = candidateMap.get(key)!;
      if (displayName) entry.names.add(displayName);
      entry.names.add(rawName);

      const rank = extractRank(t.filename);
      if (rank) entry.ranks.add(rank);

      const year = extractYear(t.filename);
      if (year) entry.years.add(year);

      entry.questionIds.add(q.id);

      const did = extractDriveId(t.links);
      if (did) entry.driveIds.add(did);

      if (t.subject_marks && t.subject_marks.trim()) {
        entry.gsMarks.add(t.subject_marks.trim());
      }

      entry.answerCount++;
    }
  }

  // Build resolved topper entities
  const toppers: TopperEntity[] = [];
  const topperIndex = new Map<string, string>(); // normalized name key → topper ID

  for (const [key, entry] of candidateMap) {
    // Pick best display name (shortest = cleanest extracted person name, not raw filename)
    const names = Array.from(entry.names).filter((n) => n.length > 0 && n.length < 80);
    // Prefer names that look like person names (shorter, title case)
    const personNames = names.filter((n) => /^[A-Z][a-z]+(\s[A-Z][a-z]+)+$/.test(n));
    const displayName = (personNames.length > 0 ? personNames[0] : names[0]) || "Unknown";

    // Pick most confident rank (lowest rank number that appears most)
    const ranks = Array.from(entry.ranks);
    const bestRank = ranks.length > 0 ? Math.min(...ranks) : null;

    // Pick most common year
    const years = Array.from(entry.years);
    const bestYear = years.length > 0
      ? years.sort((a, b) =>
          years.filter((y) => y === b).length - years.filter((y) => y === a).length
        )[0]
      : null;

    const topperId = `t_${hash(key)}`;
    const entity: TopperEntity = {
      id: topperId,
      displayName,
      aliases: names.filter((n) => n !== displayName).slice(0, 5),
      rank: bestRank,
      year: bestYear,
      optionalSubject: null,
      gsMarks: entry.gsMarks.size > 0 ? Array.from(entry.gsMarks)[0] : null,
      answerCount: entry.answerCount,
      questionIds: Array.from(entry.questionIds),
      driveIds: Array.from(entry.driveIds),
    };

    toppers.push(entity);
    topperIndex.set(key, topperId);
  }

  // Sort by answer count descending
  toppers.sort((a, b) => b.answerCount - a.answerCount);

  console.log(`   Resolved ${toppers.length.toLocaleString()} unique toppers (named people only)`);
  console.log(`   Skipped ${skippedNonPerson.toLocaleString()} non-person filenames (UUIDs, test labels, etc.)`);
  console.log(`   Top: ${toppers[0]?.displayName} (${toppers[0]?.answerCount} answers, AIR ${toppers[0]?.rank || "?"})`);

  return { toppers, topperIndex };
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2: Question Canonicalization
// ═══════════════════════════════════════════════════════════════════════════

function buildQuestions(
  rawQuestions: RawQuestion[],
): { questions: QuestionEntity[] } {
  console.log("\n📋 Phase 2: Canonicalizing questions...");

  const questions: QuestionEntity[] = [];

  for (const rq of rawQuestions) {
    const subject = normalizeSubject(rq.category);
    const paper = rq.category;
    const year = extractQuestionYear(rq.question, rq.category);
    const marks = extractMarks(rq.question);

    // Clean question text: strip Q-number prefix
    let cleanText = rq.question.replace(/^Q\d+[a-z]?\s*/i, "").trim();

    const entity: QuestionEntity = {
      id: rq.id,
      canonicalText: cleanText,
      rawText: rq.question,
      year,
      subject,
      paper,
      marks,
      syllabusTags: rq.syllabus_tags || [],
      themeIds: (rq.keywords || []).map((k) => `theme_${hash(k.toLowerCase())}`),
      topperAnswerCount: rq.toppers.length,
    };

    questions.push(entity);
  }

  // Back-propagate years from topper filenames to questions
  const questionYearVotes = new Map<number, Map<number, number>>();
  for (const rq of rawQuestions) {
    for (const t of rq.toppers) {
      const y = extractYear(t.filename);
      if (y && y >= 2013 && y <= 2030) {
        if (!questionYearVotes.has(rq.id)) questionYearVotes.set(rq.id, new Map());
        const votes = questionYearVotes.get(rq.id)!;
        votes.set(y, (votes.get(y) || 0) + 1);
      }
    }
  }

  let yearBackfilled = 0;
  for (const q of questions) {
    if (q.year === null) {
      const votes = questionYearVotes.get(q.id);
      if (votes && votes.size > 0) {
        let bestYear = 0, bestCount = 0;
        for (const [y, c] of votes) { if (c > bestCount) { bestCount = c; bestYear = y; } }
        if (bestYear > 0) { q.year = bestYear; yearBackfilled++; }
      }
    }
  }

  const withYear = questions.filter((q) => q.year !== null).length;
  const withMarks = questions.filter((q) => q.marks !== null).length;
  const pctYear = Math.round(withYear / questions.length * 100);
  console.log(`   ${questions.length.toLocaleString()} questions canonicalized`);
  console.log(`   ${withYear.toLocaleString()} have year (${yearBackfilled.toLocaleString()} from toppers, ${pctYear}%)`);
  console.log(`   ${withMarks.toLocaleString()} have marks extracted (${Math.round(withMarks / questions.length * 100)}%)`);

  return { questions };
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3: Topper-Answers Join Table
// ═══════════════════════════════════════════════════════════════════════════

function buildAnswers(
  rawQuestions: RawQuestion[],
  topperIndex: Map<string, string>,
  r2Map: Record<string, string>,
  ocrMap: Record<string, { summary: string }>,
): TopperAnswerEntity[] {
  console.log("\n🔗 Phase 3: Building topper-answer links...");

  const answers: TopperAnswerEntity[] = [];
  let ocrLinked = 0;
  let noOcr = 0;

  let unresolvedCount = 0;

  for (const rq of rawQuestions) {
    for (const t of rq.toppers) {
      const displayName = extractDisplayName(t.filename);
      const rawName = cleanName(t.filename);
      const nameKey = normalizeNameForMatching(displayName);
      let topperId = topperIndex.get(nameKey);

      // For unidentified files, use drive-ID-based key
      if (!topperId) {
        unresolvedCount++;
        const did = extractDriveId(t.links);
        if (did) {
          topperId = `t_drive_${did.slice(0, 12)}`;
        } else {
          continue; // No identity at all — skip
        }
      }

      const driveId = extractDriveId(t.links);
      const linkType = getLinkType(t.links);

      // Resolve CDN URL
      let cdnUrl: string | null = null;
      if (driveId) {
        // Check R2 map
        for (const [k, v] of Object.entries(r2Map)) {
          if (k.includes(driveId) || driveId.includes(k)) {
            cdnUrl = v;
            break;
          }
        }
        if (!cdnUrl && linkType === "r2-cdn") {
          cdnUrl = t.links;
        }
      }

      // Link OCR
      let ocrSummary: string | null = null;
      if (driveId && ocrMap[driveId]) {
        ocrSummary = ocrMap[driveId].summary;
        ocrLinked++;
      } else if (driveId) {
        noOcr++;
      }

      const pageNum = t.page ? parseInt(t.page.replace(/[^0-9]/g, "")) : null;

      const ansId = `ans_${hash(`${topperId}_${rq.id}_${t.filename}`)}`;

      answers.push({
        id: ansId,
        topperId,
        questionId: rq.id,
        driveId,
        pageNumber: pageNum && pageNum > 0 ? pageNum : null,
        introduction: t.introduction?.trim() || null,
        ocrSummary,
        valueAdds: t.value_adds || [],
        marksObtained: t.subject_marks?.trim() || null,
        linkType,
        cdnUrl,
        rawFilename: t.filename,
      });
    }
  }

  console.log(`   ${answers.length.toLocaleString()} answer links built`);
  console.log(`   ${unresolvedCount.toLocaleString()} from unidentified toppers (drive-ID keyed)`);
  console.log(`   ${ocrLinked.toLocaleString()} linked to OCR summaries`);
  console.log(`   ${noOcr.toLocaleString()} have drive ID but no OCR yet`);

  return answers;
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 4: Theme Graph
// ═══════════════════════════════════════════════════════════════════════════

function buildThemes(
  rawQuestions: RawQuestion[],
): { themes: ThemeEntity[]; themeQuestions: { themeId: string; questionId: number }[] } {
  console.log("\n🎨 Phase 4: Building theme graph...");

  // Collect all keywords → question IDs
  const kwMap = new Map<string, { questionIds: Set<number>; subjects: Set<string> }>();

  for (const rq of rawQuestions) {
    const subject = normalizeSubject(rq.category);
    for (const kw of rq.keywords || []) {
      const key = kw.toLowerCase().trim();
      if (!key) continue;

      if (!kwMap.has(key)) {
        kwMap.set(key, { questionIds: new Set(), subjects: new Set() });
      }
      kwMap.get(key)!.questionIds.add(rq.id);
      kwMap.get(key)!.subjects.add(subject);
    }
  }

  const themes: ThemeEntity[] = [];
  const themeQuestions: { themeId: string; questionId: number }[] = [];

  for (const [name, data] of kwMap) {
    const themeId = `theme_${hash(name)}`;
    const subjects = Array.from(data.subjects);

    themes.push({
      id: themeId,
      name,
      questionCount: data.questionIds.size,
      subjects,
      crossSubjectLinks: [],
    });

    for (const qid of data.questionIds) {
      themeQuestions.push({ themeId, questionId: qid });
    }
  }

  // Find cross-subject themes
  const crossSubject = themes.filter((t) => t.subjects.length > 1);
  themes.sort((a, b) => b.questionCount - a.questionCount);

  console.log(`   ${themes.length} unique themes`);
  console.log(`   ${crossSubject.length} cross-subject themes`);
  console.log(`   ${themeQuestions.length.toLocaleString()} theme-question links`);

  return { themes, themeQuestions };
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

function main() {
  console.log("🏗️  Building relational entity engine...\n");

  // Load inputs
  console.log("📖 Loading data...");
  const rawQuestions: RawQuestion[] = JSON.parse(fs.readFileSync(INPUT, "utf-8"));
  console.log(`   ${rawQuestions.length.toLocaleString()} question groups loaded`);

  let r2Map: Record<string, string> = {};
  if (fs.existsSync(R2_MAP)) {
    r2Map = JSON.parse(fs.readFileSync(R2_MAP, "utf-8"));
    console.log(`   ${Object.keys(r2Map).length.toLocaleString()} R2 CDN mappings`);
  }

  let ocrMap: Record<string, { summary: string }> = {};
  if (fs.existsSync(OCR_MAP)) {
    ocrMap = JSON.parse(fs.readFileSync(OCR_MAP, "utf-8"));
    console.log(`   ${Object.keys(ocrMap).length} OCR summaries`);
  }

  // Phase 1: Resolve toppers
  const { toppers, topperIndex } = resolveToppers(rawQuestions, r2Map, ocrMap);

  // Phase 2: Canonicalize questions
  const { questions } = buildQuestions(rawQuestions);

  // Phase 3: Build answer links
  const answers = buildAnswers(rawQuestions, topperIndex, r2Map, ocrMap);

  // Phase 4: Theme graph
  const { themes, themeQuestions } = buildThemes(rawQuestions);

  // ── Write outputs ──
  fs.mkdirSync(OUT_DIR, { recursive: true });

  fs.writeFileSync(path.join(OUT_DIR, "toppers.json"), JSON.stringify(toppers));
  fs.writeFileSync(path.join(OUT_DIR, "questions.json"), JSON.stringify(questions));
  fs.writeFileSync(path.join(OUT_DIR, "topper-answers.json"), JSON.stringify(answers));
  fs.writeFileSync(path.join(OUT_DIR, "themes.json"), JSON.stringify(themes));
  fs.writeFileSync(path.join(OUT_DIR, "theme-questions.json"), JSON.stringify(themeQuestions));

  // ── Indexes ──
  const topperNameIndex: Record<string, string> = {};
  for (const t of toppers) {
    for (const alias of [t.displayName, ...t.aliases]) {
      const key = alias.toLowerCase().trim();
      if (key) topperNameIndex[key] = t.id;
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, "topper-name-index.json"), JSON.stringify(topperNameIndex));

  const topperQuestionIndex: Record<string, number[]> = {};
  for (const a of answers) {
    if (!topperQuestionIndex[a.topperId]) topperQuestionIndex[a.topperId] = [];
    topperQuestionIndex[a.topperId].push(a.questionId);
  }
  fs.writeFileSync(path.join(OUT_DIR, "topper-question-index.json"), JSON.stringify(topperQuestionIndex));

  // ── Summary ──
  const sizes = fs.readdirSync(OUT_DIR).map((f) => {
    const stat = fs.statSync(path.join(OUT_DIR, f));
    return { file: f, kb: Math.round(stat.size / 1024) };
  });

  console.log("\n═══════════════════════════════════════");
  console.log("✅ Relational engine built!");
  console.log(`   Toppers:         ${toppers.length.toLocaleString()}`);
  console.log(`   Questions:       ${questions.length.toLocaleString()}`);
  console.log(`   Answers:         ${answers.length.toLocaleString()}`);
  console.log(`   Themes:          ${themes.length}`);
  console.log(`   Theme links:     ${themeQuestions.length.toLocaleString()}`);
  console.log("\n📁 Output files:");
  for (const { file, kb } of sizes) {
    console.log(`   ${file.padEnd(30)} ${kb.toLocaleString().padStart(6)} KB`);
  }
  console.log("═══════════════════════════════════════\n");
}

main();
