/**
 * Build a deterministic OCR vault from merged topper-copy markdown files.
 *
 * The output is intentionally JSON-first for the current app. It gives us a
 * fast local "database" now, while keeping the shape close to the Postgres
 * tables we should move to later.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_INPUT = path.join(ROOT, "vault_merged_docs");
const LEGACY_INPUT = path.join(ROOT, "UPSC_topper_md");
const INPUT_DIR = process.env.VAULT_DOCS_DIR
  ? path.resolve(process.env.VAULT_DOCS_DIR)
  : fs.existsSync(DEFAULT_INPUT)
    ? DEFAULT_INPUT
    : LEGACY_INPUT;

const DATA_DIR = path.join(ROOT, "data", "app");
const OUT_DIR = path.join(DATA_DIR, "vault");
const R2_MAP = path.join(DATA_DIR, "pdf-r2-map.json");
const KEYWORDS = path.join(DATA_DIR, "keywords.json");

type SourceType = "complete" | "master" | "page" | "unknown";

interface VaultDocument {
  id: string;
  title: string;
  sourceType: SourceType;
  topperName: string | null;
  rank: number | null;
  institute: string | null;
  subject: string | null;
  testName: string | null;
  pageCount: number;
  textPages: number;
  wordCount: number;
  diagramCount: number;
  remarkCount: number;
  questionCount: number;
  scoreCount: number;
  totalScore: number | null;
  maxMarks: number | null;
  concepts: string[];
  topAssets: string[];
  interpretation: string;
  valueAddSummary: string[];
  questionSamples: string[];
  hasSource: boolean;
}

interface VaultChunk {
  id: string;
  docId: string;
  page: number | null;
  title: string;
  topperName: string | null;
  subject: string | null;
  institute: string | null;
  sourceType: SourceType;
  interpretation: string;
  wordCount: number;
  hasDiagram: boolean;
  hasRemarks: boolean;
  concepts: string[];
  questions: string[];
  assets: string[];
}

interface VaultConcept {
  name: string;
  documentCount: number;
  chunkCount: number;
  subjects: string[];
}

interface VaultIndex {
  generatedAt: string;
  inputDir: string;
  documents: number;
  chunks: number;
  totalWords: number;
  completeFiles: number;
  masterFiles: number;
  pageFiles: number;
  diagrams: number;
  remarks: number;
  questions: number;
  concepts: VaultConcept[];
  subjects: { name: string; count: number }[];
  institutes: { name: string; count: number }[];
}

interface PageBlock {
  page: number | null;
  raw: string;
  text: string;
  hasDiagram: boolean;
  hasRemarks: boolean;
}

const INSTITUTE_PATTERNS: [string, RegExp][] = [
  ["Vision IAS", /vision\s+ias|visionias/i],
  ["GS Score", /gs\s*score|iasscore/i],
  ["Guidance IAS", /guidance\s+ias/i],
  ["ForumIAS", /forum\s*ias|forumias/i],
  ["NEXT IAS", /next\s+ias/i],
  ["Vajiram", /vajiram/i],
  ["Edukemy", /edukemy/i],
  ["Insights IAS", /insights\s+ias|insightsonindia/i],
  ["Drishti IAS", /drishti/i],
  ["Rau's IAS", /\brau'?s\s+ias/i],
  ["Lukmaan IAS", /lukmaan/i],
  ["Shankar IAS", /shankar\s+ias/i],
  ["Sriram IAS", /sriram/i],
  ["Nice IAS", /nice\s+ias/i],
  ["OnlyIAS", /only\s*ias/i],
  ["Decode Ethics", /decode\s+ethics/i],
];

const SUBJECT_PATTERNS: [string, RegExp][] = [
  ["Geography", /geography|geomorphology|climatology|urban\s+models|biogeography/i],
  ["Sociology", /sociology|sociological|durkheim|weber|marx|merton|parsons/i],
  ["PSIR", /psir|political\s+science|international\s+relations|western\s+political/i],
  ["Public Administration", /public\s+administration|administrative\s+thought|accountability|governance/i],
  ["Anthropology", /anthropology|tribal|kinship|evolutionism|primatology/i],
  ["History", /modern\s+india|world\s+history|medieval|quit\s+india|mughal/i],
  ["Essay", /\bessay\b/i],
  ["GS4 Ethics", /ethics|integrity|aptitude|case\s+study|attitude|emotional\s+intelligence/i],
  ["GS3", /economy|environment|security|disaster|agriculture|infrastructure/i],
  ["GS2", /polity|constitution|governance|judiciary|parliament|federalism/i],
  ["GS1", /society|culture|geography|history|women|urbanization/i],
];

const ASSET_PATTERNS: [string, RegExp][] = [
  ["Article", /\bArticle\s+\d+[A-Z]?\b/gi],
  ["Act", /\b[A-Z][A-Za-z\s-]{2,60}\s+Act,?\s*(?:19|20)\d{2}\b/g],
  ["Committee", /\b[A-Z][A-Za-z.\s-]{2,50}\s+(?:Committee|Commission)\b/g],
  ["Judgment", /\b[A-Z][A-Za-z.\s-]{2,40}\s+(?:v\.|vs\.?|versus)\s+[A-Z][A-Za-z.\s-]{2,40}\b/g],
  ["Report", /\b[A-Z][A-Za-z.\s-]{2,60}\s+Report\b/g],
  ["SDG", /\bSDG\s*\d{1,2}\b/gi],
];

const DIRECTIVE_WORDS = [
  "analyse",
  "analyze",
  "comment",
  "critically",
  "discuss",
  "elaborate",
  "elucidate",
  "evaluate",
  "examine",
  "explain",
  "highlight",
  "justify",
  "write",
  "compare",
  "distinguish",
];

function hash(value: string, length = 12): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, length);
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function extractJsonText(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return null;

  try {
    const parsed = JSON.parse(trimmed);
    const parts: string[] = [];
    const walk = (node: unknown) => {
      if (!node) return;
      if (typeof node === "string") return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (typeof node === "object") {
        const obj = node as Record<string, unknown>;
        if (typeof obj.text === "string") parts.push(obj.text);
        if (typeof obj.alt === "string") parts.push(`Diagram: ${obj.alt}`);
        Object.values(obj).forEach((value) => {
          if (Array.isArray(value) || (value && typeof value === "object")) walk(value);
        });
      }
    };
    walk(parsed);
    return parts.join("\n");
  } catch {
    return null;
  }
}

function stripHtml(raw: string): string {
  let text = raw;
  text = text.replace(/<img\b[^>]*\balt=["']([^"']+)["'][^>]*>/gi, "\nDiagram: $1\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(?:p|div|li|tr|h1|h2|h3|h4|table|thead|tbody|ul|ol)>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");
  return text;
}

function cleanText(raw: string): string {
  const jsonText = extractJsonText(raw);
  const source = jsonText ?? raw;
  return decodeEntities(stripHtml(source))
    .replace(/<\/?trans>/g, "\n")
    .replace(/^#{1,5}\s+.*$/gm, "")
    .replace(/^---+\s*$/gm, "")
    .replace(/\[\s*\{\s*"type"[\s\S]*?\}\s*\]\s*$/gm, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function publicSafeText(value: string): string {
  return value
    .replace(/[\w ()-]*\.pdf\b/gi, "")
    .replace(/\bdrive_[A-Za-z0-9_-]+\b/g, "")
    .replace(/\b(?:www\.)?pdfannotator\.com\b/gi, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "")
    .replace(/\b(?:\+?\d[\d -]{8,}\d)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitPages(raw: string): PageBlock[] {
  const pageHeading = /^###\s+(?:Source:\s*)?.*?_p(\d+)(?:_[A-Z]+)?\.md\s*$/gim;
  const matches = [...raw.matchAll(pageHeading)];

  if (matches.length === 0) {
    const text = cleanText(raw);
    return [{
      page: null,
      raw,
      text,
      hasDiagram: hasDiagram(raw, text),
      hasRemarks: hasRemarks(text),
    }];
  }

  const pages: PageBlock[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = (matches[i].index ?? 0) + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? raw.length : raw.length;
    const pageRaw = raw.slice(start, end);
    const text = cleanText(pageRaw);
    pages.push({
      page: Number(matches[i][1]),
      raw: pageRaw,
      text,
      hasDiagram: hasDiagram(pageRaw, text),
      hasRemarks: hasRemarks(text),
    });
  }
  return pages;
}

function hasDiagram(raw: string, text: string): boolean {
  return /data-label=["']Diagram["']|["']type["']\s*:\s*["']Diagram["']|Diagram:/i.test(raw)
    || /\b(flowchart|map|diagram|graph|figure)\b/i.test(text);
}

function hasRemarks(text: string): boolean {
  return /\bremarks?\b|evaluator|feedback|suggestions?|conclusion too short|add more|good attempt/i.test(text);
}

function getDriveId(filename: string): string | null {
  const m = filename.match(/^drive_(.+?)_(?:COMPLETE|MASTER|p\d+_COMPLETE)\.md$/);
  return m ? m[1] : null;
}

function getSourceType(filename: string): SourceType {
  if (/_COMPLETE\.md$/i.test(filename)) return "complete";
  if (/_MASTER\.md$/i.test(filename)) return "master";
  if (/_p\d+_COMPLETE\.md$/i.test(filename)) return "page";
  return "unknown";
}

function titleFromFilename(filename: string, driveId: string | null, index: number): string {
  const title = filename
    .replace(/\.md$/i, "")
    .replace(/^drive_[A-Za-z0-9_-]+_?/, "")
    .replace(driveId || "", "")
    .replace(/_(?:COMPLETE|MASTER|p\d+_COMPLETE)$/i, "")
    .replace(/\b(?:COMPLETE|MASTER)\b/gi, "")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!title || /^[A-Za-z0-9_-]{16,}$/.test(title) || /^drive\b/i.test(title)) {
    return `Interpreted Source ${String(index + 1).padStart(3, "0")}`;
  }

  return titleCase(title).slice(0, 72);
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\b(Ias|Gs|Psir|Air)\b/g, (c) => c.toUpperCase());
}

function normalizeConceptName(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  const upper = trimmed.toUpperCase();
  if (["CAG", "PSIR", "SDG", "SHG", "NGO", "GDP", "MSP"].includes(upper)) return upper;
  if (/^Article\s+\d+/i.test(trimmed)) return trimmed.replace(/^article/i, "Article");
  return titleCase(trimmed);
}

function sanitizeName(value: string | null): string | null {
  if (!value) return null;
  let cleaned = decodeEntities(value)
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\([^)]*@[^)]*\)/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\b(?:mobile|date|signature|email|roll|test|paper|geography|sociology|optional)\b.*$/i, " ")
    .replace(/[^A-Za-z\s.'-]/g, " ")
    .replace(/[-'\s.]+$/g, "")
    .replace(/^[-'\s.]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 5) return null;
  if (
    cleaned.length < 3
    || /\b(?:candidate|redacted|name|unknown|question|questions|marks|words|parenthesis|following|answer|answers|write|each|day|copy|test|topper|cse)\b/i.test(cleaned)
  ) return null;
  return titleCase(cleaned);
}

function extractTopperName(text: string, filename: string): string | null {
  const filenameName = extractNameFromFilename(filename);
  if (filenameName) return filenameName;

  const head = text.slice(0, 9000);
  const patterns = [
    /Name\s+of\s+(?:the\s+)?Candidate\s*[:\-]?\s*([A-Za-z][A-Za-z .'-]{2,60})/i,
    /\bName\s*[:\-]?\s*([A-Za-z][A-Za-z .'-]{2,60})/i,
    /\bFor\s+([A-Za-z][A-Za-z .'-]{2,60})\s*\(/i,
    /IAS\s+TOPPER'?S\s+TEST\s+COPY\s+([A-Za-z][A-Za-z .'-]{2,60})/i,
  ];

  for (const pattern of patterns) {
    const match = head.match(pattern);
    const name = sanitizeName(match?.[1] ?? null);
    if (name) return name;
  }

  const fromFile = filename
    .replace(/\.md$/i, "")
    .replace(/^drive_[A-Za-z0-9_-]+_/, "")
    .replace(/_(?:COMPLETE|MASTER)$/i, "")
    .replace(/[-_]/g, " ");
  return sanitizeName(fromFile);
}

function extractNameFromFilename(filename: string): string | null {
  const withoutExt = filename.replace(/\.md$/i, "");
  const airMatch = withoutExt.match(/(?:Evaluated\s*[-_]\s*)?([A-Za-z][A-Za-z .'-]{2,45})\s+AIR\s*\d{1,4}/i);
  if (airMatch) return sanitizeName(airMatch[1]);

  const answerSample = withoutExt.match(/Mains\s+Answer\s+Samples\s+by\s+([A-Za-z][A-Za-z .'-]{2,45})/i);
  if (answerSample) return sanitizeName(answerSample[1]);

  return null;
}

function extractRank(text: string, filename: string): number | null {
  const source = `${filename}\n${text.slice(0, 15000)}`;
  const m = source.match(/\bAIR\s*[-:]?\s*(\d{1,4})\b/i)
    || source.match(/\bRank\s*[-:]?\s*(\d{1,4})\b/i);
  return m ? Number(m[1]) : null;
}

function detectFromPatterns(text: string, patterns: [string, RegExp][]): string | null {
  const hits = patterns
    .map(([name, pattern]) => ({ name, count: (text.match(pattern) || []).length }))
    .filter((hit) => hit.count > 0)
    .sort((a, b) => b.count - a.count);
  return hits[0]?.name ?? null;
}

function extractTestName(text: string): string | null {
  const head = text.slice(0, 8000);
  const patterns = [
    /\b(?:Full\s+Length|Comprehensive|Sectional|Topical)?\s*Test\s*[-:]?\s*[A-Z0-9 /-]{1,40}/i,
    /\bPaper\s*[-:]?\s*[IVX1-4]\b/i,
    /\bTest\s+Code\s*[:\-]?\s*[A-Z0-9 /-]{2,30}/i,
  ];
  for (const pattern of patterns) {
    const m = head.match(pattern);
    if (m) return m[0].replace(/\s+/g, " ").trim().slice(0, 80);
  }
  return null;
}

function extractTotalScore(text: string): { totalScore: number | null; maxMarks: number | null } {
  const head = text.slice(0, 12000);
  const total = head.match(/\bTotal\s*(?:Marks|Score)?\s*[:=]\s*(\d{1,3}(?:\.\d+)?)\b/i)
    || head.match(/\bTotal\s*=\s*(\d{1,3}(?:\.\d+)?)\b/i);
  const max = head.match(/\b(?:Max(?:imum)?\.?\s*Marks|Total\s+Marks)\s*[:\-]?\s*(\d{2,3})\b/i);
  return {
    totalScore: total ? Number(total[1]) : null,
    maxMarks: max ? Number(max[1]) : null,
  };
}

function extractQuestions(text: string): string[] {
  const questions: string[] = [];
  const seen = new Set<string>();
  const lines = text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 28 && line.length <= 320);

  for (const line of lines) {
    const hasMarks = /\b\d{1,3}\s*marks?\b|\(\s*\d{1,3}\s*marks?\s*\)/i.test(line);
    const startsLikeQuestion = /^(?:Q\.?\s*)?\d{1,2}\s*(?:[.)]|\([a-e]\)|[a-e][.)])\s+/i.test(line)
      || /^\([a-e]\)\s+/i.test(line);
    const hasDirective = DIRECTIVE_WORDS.some((word) => new RegExp(`\\b${word}\\b`, "i").test(line));

    if (!hasMarks && !(startsLikeQuestion && hasDirective)) continue;
    if (/instructions?|time allowed|maximum marks|all questions|candidate|mobile|signature/i.test(line)) continue;

    const normalized = line.slice(0, 260);
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    questions.push(normalized);
    if (questions.length >= 80) break;
  }

  return questions;
}

function extractScoreHints(text: string): { count: number; total: number | null } {
  const matches = [...text.matchAll(/\b(?:Q\.?\s*)?(\d{1,2}\s*\(?[a-e]?\)?\.?)\s+(\d{1,3}(?:\.\d+)?)\s+(?:\/\s*)?(\d{1,3})\b/gi)];
  const scores = matches
    .map((m) => ({ score: Number(m[2]), max: Number(m[3]) }))
    .filter((s) => s.score <= s.max && s.max <= 250);
  if (scores.length === 0) return { count: 0, total: null };
  return {
    count: scores.length,
    total: scores.reduce((sum, item) => sum + item.score, 0),
  };
}

function extractAssets(text: string): string[] {
  const assets = new Map<string, string>();

  for (const [kind, pattern] of ASSET_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const value = match[0].replace(/\s+/g, " ").trim();
      if (value.length < 4 || value.length > 90) continue;
      assets.set(`${kind}:${value.toLowerCase()}`, `${kind}: ${value}`);
      if (assets.size >= 60) return [...assets.values()];
    }
  }

  return [...assets.values()];
}

function makeConceptMatcher(): string[] {
  const keywords = readJson<{ keyword: string; count: number }[]>(KEYWORDS, [])
    .map((entry) => normalizeConceptName(entry.keyword))
    .filter(Boolean);

  const extras = [
    "courage",
    "integrity",
    "empathy",
    "compassion",
    "accountability",
    "transparency",
    "federalism",
    "governance",
    "urban floods",
    "global warming",
    "climate change",
    "CAG",
    "Article 44",
    "civil services",
    "women",
    "caste",
    "marriage",
    "tribal",
    "diaspora",
    "poverty",
    "migration",
    "agriculture",
    "disaster management",
    "emotional intelligence",
    "utilitarianism",
    "Gandhi",
    "Ambedkar",
    "Durkheim",
    "Weber",
    "Marx",
  ];

  return [...new Set([...keywords, ...extras].map((k) => normalizeConceptName(k)).filter((k) => k.length >= 3))]
    .sort((a, b) => b.length - a.length);
}

function findConcepts(text: string, conceptList: string[], limit = 30): string[] {
  const lower = text.toLowerCase();
  const hits: string[] = [];
  for (const concept of conceptList) {
    const c = concept.toLowerCase();
    const isPhrase = c.includes(" ");
    const found = isPhrase
      ? lower.includes(c)
      : new RegExp(`\\b${escapeRegExp(c)}\\b`, "i").test(text);
    if (!found) continue;
    hits.push(concept);
    if (hits.length >= limit) break;
  }
  return hits;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordCount(text: string): number {
  return (text.match(/[A-Za-z0-9]+/g) || []).length;
}

function previewFromPages(pages: PageBlock[]): string {
  const useful = pages
    .map((page) => page.text)
    .find((text) => wordCount(text) > 45 && !/instructions?|scan qr|batch begins/i.test(text))
    || pages.map((page) => page.text).find((text) => wordCount(text) > 20)
    || "";
  return useful.replace(/\s+/g, " ").trim().slice(0, 420);
}

function interpretText(text: string, concepts: string[], assets: string[], questions: string[], flags: { hasDiagram: boolean; hasRemarks: boolean }): string {
  const safeQuestions = questions.map(publicSafeText).filter(Boolean);
  const safeAssets = assets.map(publicSafeText).filter(Boolean);
  const signals: string[] = [];
  if (safeQuestions.length > 0) signals.push(`question demand: ${stripQuestionPrefix(safeQuestions[0]).slice(0, 140)}`);
  if (concepts.length > 0) signals.push(`themes: ${concepts.slice(0, 5).join(", ")}`);
  if (safeAssets.length > 0) signals.push(`value additions: ${safeAssets.slice(0, 3).join("; ")}`);
  if (flags.hasDiagram) signals.push("uses visual presentation such as a map, flowchart, table, or diagram");
  if (flags.hasRemarks) signals.push("contains evaluator feedback or margin guidance");

  if (signals.length > 0) {
    return `This source is useful for ${signals.join(". ")}.`;
  }

  const clean = publicSafeText(text)
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\b(?:mobile|email|signature|scanned with camscanner)\b.*$/gim, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean
    ? `This page appears to discuss ${clean.split(" ").slice(0, 24).join(" ")}.`
    : "This page has limited readable OCR, so only metadata signals are available.";
}

function stripQuestionPrefix(question: string): string {
  return question.replace(/^(?:Q\.?\s*)?\d{1,2}\s*(?:[.)]|\([a-e]\)|[a-e][.)])\s*/i, "").trim();
}

function build() {
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`Vault input directory not found: ${INPUT_DIR}`);
    process.exit(1);
  }

  const r2Map = readJson<Record<string, string>>(R2_MAP, {});
  const concepts = makeConceptMatcher();
  const files = fs.readdirSync(INPUT_DIR)
    .filter((file) => file.endsWith(".md"))
    .sort();

  console.log(`Building vault from ${files.length} markdown files in ${INPUT_DIR}`);

  const documents: VaultDocument[] = [];
  const chunks: VaultChunk[] = [];
  const conceptDocs = new Map<string, Set<string>>();
  const conceptChunks = new Map<string, number>();
  const conceptSubjects = new Map<string, Set<string>>();

  for (const [fileIndex, filename] of files.entries()) {
    const sourcePath = path.join(INPUT_DIR, filename);
    const raw = fs.readFileSync(sourcePath, "utf-8");
    const driveId = getDriveId(filename);
    const id = driveId ? `doc_${hash(`${driveId}:${filename}`)}` : `doc_${hash(filename)}`;
    const sourceType = getSourceType(filename);
    const pages = splitPages(raw);
    const fullText = pages.map((page) => page.text).join("\n\n");
    const docConcepts = findConcepts(fullText, concepts, 40);
    const institute = detectFromPatterns(fullText.slice(0, 20000), INSTITUTE_PATTERNS);
    const subject = detectFromPatterns(`${filename}\n${fullText.slice(0, 40000)}`, SUBJECT_PATTERNS);
    const topperName = extractTopperName(fullText, filename);
    const rank = extractRank(fullText, filename);
    const testName = extractTestName(fullText);
    const scores = extractScoreHints(fullText);
    const totalScore = extractTotalScore(fullText);
    const questions = extractQuestions(fullText);
    const assets = extractAssets(fullText);
    const diagramCount = pages.filter((page) => page.hasDiagram).length;
    const remarkCount = pages.filter((page) => page.hasRemarks).length;
    const docWordCount = wordCount(fullText);
    const interpretation = interpretText(previewFromPages(pages), docConcepts, assets, questions, {
      hasDiagram: diagramCount > 0,
      hasRemarks: remarkCount > 0,
    });

    const document: VaultDocument = {
      id,
      title: topperName ? `${topperName} - ${subject || titleFromFilename(filename, driveId, fileIndex)}` : titleFromFilename(filename, driveId, fileIndex),
      sourceType,
      topperName,
      rank,
      institute,
      subject,
      testName,
      pageCount: pages.length,
      textPages: pages.filter((page) => wordCount(page.text) > 8).length,
      wordCount: docWordCount,
      diagramCount,
      remarkCount,
      questionCount: questions.length,
      scoreCount: scores.count,
      totalScore: totalScore.totalScore ?? scores.total,
      maxMarks: totalScore.maxMarks,
      concepts: docConcepts,
      topAssets: assets.map(publicSafeText).filter(Boolean).slice(0, 12),
      interpretation,
      valueAddSummary: assets.map(publicSafeText).filter(Boolean).slice(0, 8),
      questionSamples: questions.map(publicSafeText).filter(Boolean).slice(0, 5).map(stripQuestionPrefix),
      hasSource: !!(driveId && r2Map[driveId]),
    };

    documents.push(document);

    for (const concept of docConcepts) {
      if (!conceptDocs.has(concept)) conceptDocs.set(concept, new Set());
      conceptDocs.get(concept)!.add(id);
      if (subject) {
        if (!conceptSubjects.has(concept)) conceptSubjects.set(concept, new Set());
        conceptSubjects.get(concept)!.add(subject);
      }
    }

    const chunkPages = pages.filter((page) => wordCount(page.text) > 8);
    for (const page of chunkPages) {
      const pageQuestions = extractQuestions(page.text).slice(0, 8);
      const pageAssets = extractAssets(page.text).slice(0, 10);
      const pageConcepts = findConcepts(page.text, concepts, 16);
      const chunk: VaultChunk = {
        id: `chunk_${hash(`${id}:${page.page ?? chunks.length}`)}`,
        docId: id,
        page: page.page,
        title: document.title,
        topperName,
        subject,
        institute,
        sourceType,
        interpretation: interpretText(page.text, pageConcepts, pageAssets, pageQuestions, {
          hasDiagram: page.hasDiagram,
          hasRemarks: page.hasRemarks,
        }),
        wordCount: wordCount(page.text),
        hasDiagram: page.hasDiagram,
        hasRemarks: page.hasRemarks,
        concepts: pageConcepts,
        questions: pageQuestions.map(publicSafeText).filter(Boolean),
        assets: pageAssets.map(publicSafeText).filter(Boolean),
      };
      chunks.push(chunk);

      for (const concept of pageConcepts) {
        conceptChunks.set(concept, (conceptChunks.get(concept) || 0) + 1);
      }
    }
  }

  const subjectCounts = countBy(documents.map((doc) => doc.subject).filter(Boolean) as string[]);
  const instituteCounts = countBy(documents.map((doc) => doc.institute).filter(Boolean) as string[]);
  const conceptIndex: VaultConcept[] = [...conceptDocs.entries()]
    .map(([name, docs]) => ({
      name,
      documentCount: docs.size,
      chunkCount: conceptChunks.get(name) || 0,
      subjects: [...(conceptSubjects.get(name) || new Set<string>())].sort(),
    }))
    .sort((a, b) => b.documentCount - a.documentCount || a.name.localeCompare(b.name));

  const index: VaultIndex = {
    generatedAt: new Date().toISOString(),
    inputDir: path.relative(ROOT, INPUT_DIR),
    documents: documents.length,
    chunks: chunks.length,
    totalWords: documents.reduce((sum, doc) => sum + doc.wordCount, 0),
    completeFiles: documents.filter((doc) => doc.sourceType === "complete").length,
    masterFiles: documents.filter((doc) => doc.sourceType === "master").length,
    pageFiles: documents.filter((doc) => doc.sourceType === "page").length,
    diagrams: documents.reduce((sum, doc) => sum + doc.diagramCount, 0),
    remarks: documents.reduce((sum, doc) => sum + doc.remarkCount, 0),
    questions: documents.reduce((sum, doc) => sum + doc.questionCount, 0),
    concepts: conceptIndex.slice(0, 300),
    subjects: subjectCounts,
    institutes: instituteCounts,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "documents.json"), JSON.stringify(documents));
  fs.writeFileSync(path.join(OUT_DIR, "chunks.json"), JSON.stringify(chunks));
  fs.writeFileSync(path.join(OUT_DIR, "concepts.json"), JSON.stringify(conceptIndex));
  fs.writeFileSync(path.join(OUT_DIR, "index.json"), JSON.stringify(index, null, 2));

  console.log(`Vault built: ${documents.length} documents, ${chunks.length} chunks`);
  console.log(`Words: ${index.totalWords.toLocaleString()}, diagrams: ${index.diagrams.toLocaleString()}, remarks: ${index.remarks.toLocaleString()}`);
  console.log(`Output: ${path.relative(ROOT, OUT_DIR)}`);
}

function countBy(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

build();
