/**
 * build-themes.ts
 *
 * Generates theme/keyword clusters per subject from questions.json.
 * Groups keywords by category, with question counts and cross-subject links.
 *
 * Usage: npx tsx scripts/build-themes.ts
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const QUESTIONS_PATH = path.join(ROOT, "public", "data", "questions.json");
const OUTPUT = path.join(ROOT, "public", "data", "themes.json");

interface QuestionGroup {
  id: number;
  question: string;
  category: string;
  keywords: string[];
  syllabus_tags: string[];
  toppers: unknown[];
}

interface ThemeEntry {
  keyword: string;
  count: number;
  /** IDs of questions with this keyword */
  questionIds: number[];
}

interface SubjectThemes {
  subject: string;
  label: string;
  totalQuestions: number;
  themes: ThemeEntry[];
}

function normalizeSubject(cat: string): string {
  const map: Record<string, string> = {
    "GS 1": "gs 1",
    "GS 2": "gs 2",
    "GS 3": "gs 3",
    "GS 4": "gs 4",
    Essay: "essay",
    Geography: "geography",
    Sociology: "sociology",
    PSIR: "psir",
    "Public Administration": "public administration",
    Anthropology: "anthropology",
    History: "gs 1",
  };
  return map[cat] || cat.toLowerCase();
}

const SUBJECT_LABELS: Record<string, string> = {
  "gs 1": "GS Paper I",
  "gs 2": "GS Paper II",
  "gs 3": "GS Paper III",
  "gs 4": "GS Paper IV",
  essay: "Essay",
  geography: "Geography",
  sociology: "Sociology",
  psir: "PSIR",
  "public administration": "Public Admin",
  anthropology: "Anthropology",
};

function main() {
  console.log("🔨 Building theme clusters...");

  const raw = fs.readFileSync(QUESTIONS_PATH, "utf-8");
  const questions: QuestionGroup[] = JSON.parse(raw);
  console.log(`   Loaded ${questions.length.toLocaleString()} questions`);

  // Group keywords by subject
  const subjectMap = new Map<string, Map<string, Set<number>>>();

  for (const q of questions) {
    const subj = normalizeSubject(q.category);
    if (!subj || subj === "other") continue;

    if (!subjectMap.has(subj)) {
      subjectMap.set(subj, new Map());
    }
    const kwMap = subjectMap.get(subj)!;

    for (const kw of q.keywords || []) {
      if (!kwMap.has(kw)) {
        kwMap.set(kw, new Set());
      }
      kwMap.get(kw)!.add(q.id);
    }
  }

  // Build output
  const themes: SubjectThemes[] = [];
  for (const [subj, kwMap] of subjectMap.entries()) {
    const totalQs = new Set<number>();
    const entries: ThemeEntry[] = [];

    for (const [keyword, ids] of kwMap) {
      for (const id of ids) totalQs.add(id);
      entries.push({
        keyword,
        count: ids.size,
        questionIds: Array.from(ids),
      });
    }

    // Sort by count descending
    entries.sort((a, b) => b.count - a.count);

    themes.push({
      subject: subj,
      label: SUBJECT_LABELS[subj] || subj,
      totalQuestions: totalQs.size,
      themes: entries,
    });
  }

  // Sort subjects by total questions
  themes.sort((a, b) => b.totalQuestions - a.totalQuestions);

  fs.writeFileSync(OUTPUT, JSON.stringify(themes));
  const sizeKb = Math.round(fs.statSync(OUTPUT).size / 1024);

  console.log(`\n✅ Themes built:`);
  for (const t of themes) {
    console.log(`   ${t.label.padEnd(20)} ${t.themes.length.toLocaleString().padStart(4)} themes  ${t.totalQuestions.toLocaleString().padStart(6)} questions`);
  }
  console.log(`\n   Output: ${OUTPUT} (${sizeKb.toLocaleString()} KB)`);
}

main();
