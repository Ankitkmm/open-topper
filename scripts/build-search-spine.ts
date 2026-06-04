import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { loadLocalEnv } from "../src/lib/bootstrap-env";
import { withDb } from "../src/lib/db";
import { isPublishableQuestionText, normalizePublicTopperName } from "../src/lib/public-records";

loadLocalEnv();

const ROOT = process.cwd();
const VAULT_DIR = path.join(ROOT, "data", "app", "vault", "db");
const QUESTIONS_FILE = path.join(VAULT_DIR, "questions.json");
const ANSWERS_FILE = path.join(VAULT_DIR, "answers.json");
const SUBJECTS_FILE = path.join(VAULT_DIR, "subjects.json");
const SYLLABI_FILE = path.join(VAULT_DIR, "syllabi.json");
const DUPLICATES_FILE = path.join(VAULT_DIR, "duplicate-review.json");
const SCHEMA_FILE = path.join(ROOT, "scripts", "schema-search-spine.sql");
const CANONICAL_ANSWERS_FILE = path.join(ROOT, "data", "app", "topper-answer-canonical.json");

type VaultQuestion = {
  id: string;
  question: string;
  paper: string;
  category: string;
  estimatedYear: number | null;
  subjectKey: string;
  subjectLabel: string;
  syllabusTags: string[];
  keywords: string[];
  topicTags: string[];
};

type VaultAnswer = {
  id: string;
  questionId: string;
  question: string;
  paper: string;
  category: string;
  estimatedYear: number | null;
  subjectKey: string;
  subjectLabel: string;
  syllabusTags: string[];
  keywords: string[];
  topicTags: string[];
  topperName: string;
  rank: number | null;
  year: number | null;
  institute: string | null;
  marks: string | null;
  sourceDriveId: string | null;
  sourceUrl: string | null;
  sourceAvailable: boolean;
  sourceStatus: string;
  linkSource: string;
  cleanFilename: string | null;
  summary: string;
  valueAdds: string[];
  pageNormalized: number | null;
  primaryMatch: {
    score: number;
    elo: number;
    matchType: string;
    reasons: string[];
  };
  relatedMatches: Array<{
    questionId: string;
    score: number;
    elo: number;
    matchType: string;
    reasons: string[];
  }>;
  searchText: string;
};

type VaultSubject = {
  subjectKey: string;
  subjectLabel: string;
  questionCount: number;
  answerCount: number;
  topperCount: number;
  topicCount: number;
  syllabusCount: number;
  searchText: string;
};

type VaultSyllabus = {
  name: string;
  subjectKey: string;
  questionCount: number;
  answerCount: number;
  topperCount: number;
  topQuestions: string[];
  topAnswers: string[];
};

type DuplicateReview = {
  duplicateKey: string;
  keptAnswerId: string;
  droppedAnswerIds: string[];
  questionId: string;
  topperName: string;
  pageHint: string | number | null;
  sourceDriveId: string | null;
};

type CanonicalAnswerRecord = {
  answerId: string;
  topperName?: string | null;
  rank?: number | null;
  year?: number | null;
  institute?: string | null;
  marksObtained?: string | null;
  sourceStatus?: string | null;
  sourceAvailable?: boolean;
  pageNormalized?: number | null;
  pageStatus?: "valid" | "missing" | "fallback" | "out_of_range" | null;
};

async function main() {
  const subjects = readJson<VaultSubject[]>(SUBJECTS_FILE, []);
  const syllabi = readJson<VaultSyllabus[]>(SYLLABI_FILE, []);
  const questions = readJson<VaultQuestion[]>(QUESTIONS_FILE, []);
  const canonicalAnswers = readJson<{ records: CanonicalAnswerRecord[] }>(CANONICAL_ANSWERS_FILE, { records: [] }).records;
  const canonicalByAnswerId = new Map(canonicalAnswers.map((record) => [record.answerId, record]));
  const answers = readJson<VaultAnswer[]>(ANSWERS_FILE, [])
    .map((answer) => hydrateAnswer(answer, canonicalByAnswerId.get(answer.id)))
    .filter((answer) => answer.sourceAvailable && isPublishableQuestionText(answer.question));
  const duplicates = readJson<DuplicateReview[]>(DUPLICATES_FILE, []);
  const schema = readFileSync(SCHEMA_FILE, "utf-8");

  await withDb(async (client) => {
    await client.query("begin");
    try {
      await client.query(schema);

      await truncateAll(client);

      await insertBatches(
        client,
        "subjects",
        ["subject_key", "subject_label", "question_count", "answer_count", "topper_count", "topic_count", "syllabus_count", "search_text"],
        subjects.map((subject) => [
          subject.subjectKey,
          subject.subjectLabel,
          subject.questionCount,
          subject.answerCount,
          subject.topperCount,
          subject.topicCount,
          subject.syllabusCount,
          subject.searchText,
        ]),
        250,
        "subjects",
      );

      await insertBatches(
        client,
        "syllabus_nodes",
        ["node_id", "subject_key", "node_label", "question_count", "answer_count", "topper_count", "top_question_ids", "top_answer_ids", "search_text"],
        syllabi.map((syllabus) => [
          stableId("syl", syllabus.subjectKey, syllabus.name),
          syllabus.subjectKey,
          syllabus.name,
          syllabus.questionCount,
          syllabus.answerCount,
          syllabus.topperCount,
          syllabus.topQuestions,
          syllabus.topAnswers,
          normalize([syllabus.subjectKey, syllabus.name].join(" ")),
        ]),
        250,
        "syllabus_nodes",
      );

      await insertBatches(
        client,
        "questions",
        ["question_id", "canonical_question", "paper", "category", "subject_key", "subject_label", "estimated_year", "marks", "directive", "syllabus_path", "topic_tags", "keywords", "search_text"],
        questions.map((question) => [
          question.id,
          question.question,
          question.paper,
          question.category,
          question.subjectKey,
          question.subjectLabel,
          question.estimatedYear,
          extractMarks(question.question),
          extractDirective(question.question),
          question.syllabusTags,
          question.topicTags,
          question.keywords,
          normalize([question.question, question.paper, question.category, ...question.syllabusTags, ...question.topicTags, ...question.keywords].join(" ")),
        ]),
        250,
        "questions",
      );

      await insertBatches(
        client,
        "question_aliases",
        ["alias_id", "question_id", "alias_text", "alias_normalized"],
        questions.map((question) => [
          stableId("qal", question.id, question.question),
          question.id,
          question.question,
          normalize(question.question),
        ]),
        500,
        "question_aliases",
      );

      const topperMap = new Map<string, string>();
      const topperRows: unknown[][] = [];
      const topperAttemptRows: unknown[][] = [];
      const sourceDocumentRows: unknown[][] = [];
      const answerRows: unknown[][] = [];
      const searchDocumentRows: unknown[][] = [];
      const duplicateRows: unknown[][] = [];

      for (const answer of answers) {
        const topperId = stableId("top", answer.topperName || "anonymous", String(answer.rank || ""), String(answer.year || ""));
        if (!topperMap.has(topperId)) {
          topperMap.set(topperId, topperId);
          topperRows.push([
            topperId,
            answer.topperName || "Name unavailable",
            normalize(answer.topperName || ""),
            answer.rank,
            answer.year ?? answer.estimatedYear ?? null,
            answer.marks,
            answer.institute,
            [answer.topperName || "Name unavailable"],
            normalize([answer.topperName, answer.institute, answer.year || "", answer.rank || ""].join(" ")),
          ]);

          topperAttemptRows.push([
            stableId("att", topperId, String(answer.year ?? answer.estimatedYear ?? "")),
            topperId,
            answer.year ?? answer.estimatedYear ?? null,
            answer.rank,
            answer.marks,
            inferOptionalSubject(answer.subjectKey),
          ]);
        }

        const sourceDocumentId = stableId("src", answer.id, answer.sourceDriveId || answer.cleanFilename || answer.id);
        const r2Key = `answers/${answer.id}.pdf`;
        const r2PublicUrl = answer.sourceUrl && answer.sourceUrl.includes(".r2.") ? canonicalPublicUrl(answer.sourceUrl, r2Key) : answer.sourceUrl;

        sourceDocumentRows.push([
          sourceDocumentId,
          answer.id,
          answer.sourceDriveId,
          answer.sourceUrl,
          r2Key,
          r2PublicUrl,
          null,
          answer.cleanFilename,
          `${answer.id}.pdf`,
          answer.linkSource,
          answer.sourceAvailable,
        ]);

        answerRows.push([
          answer.id,
          answer.questionId,
          topperId,
          sourceDocumentId,
          answer.question,
          answer.paper,
          answer.category,
          answer.subjectKey,
          answer.subjectLabel,
          answer.year ?? answer.estimatedYear ?? null,
          answer.rank,
          answer.marks,
          answer.institute,
          answer.topperName,
          answer.syllabusTags,
          answer.topicTags,
          answer.keywords,
          answer.valueAdds,
          answer.summary,
          answer.sourceStatus,
          answer.sourceAvailable,
          answer.pageNormalized,
          answer.pageStatus || (answer.pageNormalized ? "valid" : "missing"),
          answer.primaryMatch?.score ?? 0,
          answer.primaryMatch?.elo ?? 0,
        ]);

        searchDocumentRows.push([
          answer.id,
          answer.questionId,
          answer.subjectKey,
          answer.year ?? answer.estimatedYear ?? null,
          answer.primaryMatch?.score ?? 0,
          answer.primaryMatch?.elo ?? 0,
          answer.sourceAvailable,
          compactSearchText(answer),
        ]);
      }

      const seenDuplicateKeys = new Set<string>();
      for (const duplicate of duplicates) {
        if (seenDuplicateKeys.has(duplicate.duplicateKey)) continue;
        seenDuplicateKeys.add(duplicate.duplicateKey);
        duplicateRows.push([
          duplicate.duplicateKey,
          duplicate.keptAnswerId,
          duplicate.droppedAnswerIds,
          duplicate.questionId,
          duplicate.topperName,
          duplicate.pageHint === null || duplicate.pageHint === undefined ? null : String(duplicate.pageHint),
          duplicate.sourceDriveId,
        ]);
      }

      await insertBatches(client, "toppers", ["topper_id", "topper_name", "normalized_name", "rank", "attempt_year", "marks_obtained", "institute", "aliases", "search_text"], topperRows, 250, "toppers");
      await insertBatches(client, "topper_attempts", ["attempt_id", "topper_id", "attempt_year", "rank", "marks_obtained", "optional_subject"], topperAttemptRows, 500, "topper_attempts");
      await insertBatches(client, "source_documents", ["source_document_id", "answer_id", "drive_key", "source_url", "r2_key", "r2_public_url", "page_count", "file_name", "canonical_file_name", "link_source", "source_available"], sourceDocumentRows, 250, "source_documents");
      await insertBatches(client, "answers", ["answer_id", "question_id", "topper_id", "source_document_id", "question_text", "paper", "category", "subject_key", "subject_label", "attempt_year", "rank", "marks_obtained", "institute", "topper_name", "syllabus_path", "topic_tags", "keywords", "value_adds", "summary", "source_status", "pdf_available", "pdf_page", "page_status", "primary_match_score", "primary_match_elo"], answerRows, 250, "answers");
      await insertBatches(client, "search_documents", ["answer_id", "question_id", "subject_key", "attempt_year", "primary_match_score", "primary_match_elo", "pdf_available", "search_text"], searchDocumentRows, 250, "search_documents");
      await insertBatches(client, "duplicate_reviews", ["duplicate_key", "kept_answer_id", "dropped_answer_ids", "question_id", "topper_name", "page_hint", "source_drive_id"], duplicateRows, 250, "duplicate_reviews");

      await client.query(
        `insert into ingest_audit (ingest_kind, status, source_file, notes)
         values ($1,$2,$3,$4)`,
        ["search-spine-import", "complete", "data/app/vault/db", `Imported ${questions.length} questions and ${answers.length} source-available answers.`],
      );

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });

  console.log(`Imported search spine into Postgres: ${questions.length.toLocaleString()} questions, ${answers.length.toLocaleString()} answers`);
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function normalize(value: string) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function stableId(prefix: string, ...parts: string[]) {
  return `${prefix}_${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16)}`;
}

function extractMarks(text: string) {
  const match = String(text || "").match(/\b(10|15|20|25|125|250)\s*marks?\b/i) || String(text || "").match(/\((10|15|20|25)\s*m/i);
  return match ? Number(match[1]) : null;
}

function extractDirective(text: string) {
  const directives = ["discuss", "examine", "critically examine", "analyse", "analyze", "comment", "evaluate", "justify", "elucidate", "compare", "differentiate"];
  const normalized = normalize(text);
  const found = directives.find((directive) => normalized.includes(directive));
  return found || null;
}

function inferOptionalSubject(subjectKey: string) {
  return ["geography", "sociology", "psir", "public-administration", "anthropology", "history"].includes(subjectKey) ? subjectKey : null;
}

function canonicalPublicUrl(currentUrl: string | null, r2Key: string) {
  const base = process.env.R2_PUBLIC_URL?.replace(/\/$/, "");
  if (!base) return currentUrl;
  return `${base}/${r2Key}`;
}

function summarize(value: string, max = 420) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const clipped = clean.slice(0, max + 1);
  const boundary = Math.max(clipped.lastIndexOf(" "), clipped.lastIndexOf("."), clipped.lastIndexOf(","), clipped.lastIndexOf(";"));
  return `${clipped.slice(0, boundary > max * 0.5 ? boundary : max).trim()}...`;
}

function compactSearchText(answer: VaultAnswer) {
  return summarize(
    normalize([
      answer.question,
      answer.paper,
      answer.category,
      answer.topperName,
      answer.rank ? `AIR ${answer.rank}` : "",
      answer.year || "",
      answer.institute || "",
      answer.syllabusTags.slice(0, 5).join(" "),
      answer.topicTags.slice(0, 6).join(" "),
      answer.valueAdds.slice(0, 4).join(" "),
      answer.summary,
    ].join(" ")),
    900,
  );
}

function hydrateAnswer(answer: VaultAnswer, canonical: CanonicalAnswerRecord | undefined): VaultAnswer & {
  pageStatus?: "valid" | "missing" | "fallback" | "out_of_range" | null;
} {
  const topperName = normalizePublicTopperName(canonical?.topperName ?? answer.topperName) || "";

  return {
    ...answer,
    topperName,
    rank: canonical?.rank ?? answer.rank,
    year: canonical?.year ?? answer.year,
    institute: canonical?.institute ?? answer.institute,
    marks: canonical?.marksObtained ?? answer.marks,
    sourceAvailable: canonical?.sourceAvailable ?? answer.sourceAvailable,
    sourceStatus: canonical?.sourceStatus ?? answer.sourceStatus,
    pageNormalized: canonical?.pageNormalized ?? answer.pageNormalized,
    pageStatus: canonical?.pageStatus ?? (answer.pageNormalized ? "valid" : "missing"),
  };
}

async function truncateAll(client: { query: (sql: string) => Promise<unknown> }) {
  await client.query(`truncate table
    duplicate_reviews,
    search_documents,
    answers,
    question_aliases,
    questions,
    source_documents,
    topper_attempts,
    toppers,
    topics,
    syllabus_nodes,
    subjects
    restart identity cascade`);
}

async function insertBatches(
  client: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
  table: string,
  columns: string[],
  rows: unknown[][],
  batchSize: number,
  label: string,
) {
  if (!rows.length) return;
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const values: unknown[] = [];
    const tuples = batch.map((row) => {
      const placeholders = row.map((value) => {
        values.push(value);
        return `$${values.length}`;
      });
      return `(${placeholders.join(",")})`;
    });

    await client.query(
      `insert into ${table} (${columns.join(", ")}) values ${tuples.join(", ")}`,
      values,
    );

    if ((start / batchSize) % 20 === 0 || start + batchSize >= rows.length) {
      console.log(`Inserted ${Math.min(start + batchSize, rows.length).toLocaleString()} / ${rows.length.toLocaleString()} ${label}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
