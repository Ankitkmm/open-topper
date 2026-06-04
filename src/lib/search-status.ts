import { readFileSync } from "fs";
import { join } from "path";
import { APP_DATA_DIR } from "./paths";
import { hasDatabaseUrl } from "./env";
import { queryDb } from "./db";
import { hasEmbeddingApi } from "./embeddings";

const VAULT_DB_DIR = join(APP_DATA_DIR, "vault", "db");

type DuplicateReviewRecord = {
  duplicate_key: string;
  kept_answer_id: string;
  dropped_answer_ids: string[];
  question_id: string;
  topper_name: string;
  page_hint: string | null;
  source_drive_id: string | null;
};

export async function getSearchStatus() {
  if (!hasDatabaseUrl()) {
    return fallbackStatus();
  }

  const [questionCount, answerCount, searchCount, embeddedCount, audit] = await Promise.all([
    queryDb<{ count: string }>("select count(*)::text as count from questions"),
    queryDb<{ count: string }>("select count(*)::text as count from answers"),
    queryDb<{ count: string }>("select count(*)::text as count from search_documents"),
    queryDb<{ total: string; embedded: string }>("select count(*)::text as total, count(embedding)::text as embedded from search_documents"),
    queryDb<{ ingest_kind: string; status: string; source_file: string | null; notes: string | null; created_at: string }>(
      "select ingest_kind, status, source_file, notes, created_at::text from ingest_audit order by created_at desc limit 5",
    ),
  ]);

  return {
    source: "database",
    embeddingsAvailable: hasEmbeddingApi(),
    questions: Number(questionCount.rows[0]?.count || 0),
    answers: Number(answerCount.rows[0]?.count || 0),
    searchDocuments: Number(searchCount.rows[0]?.count || 0),
    embeddedSearchDocuments: Number(embeddedCount.rows[0]?.embedded || 0),
    totalSearchDocuments: Number(embeddedCount.rows[0]?.total || 0),
    latestRuns: audit.rows,
  };
}

export async function getDuplicateReviewRecords(limit = 200) {
  if (hasDatabaseUrl()) {
    const maybe = await queryDb<DuplicateReviewRecord>(
      `select duplicate_key, kept_answer_id, dropped_answer_ids, question_id, topper_name, page_hint, source_drive_id
       from duplicate_reviews
       order by question_id asc
       limit $1`,
      [limit],
    ).catch(() => null);
    if (maybe) return maybe.rows;
  }

  try {
    return JSON.parse(readFileSync(join(VAULT_DB_DIR, "duplicate-review.json"), "utf-8")).slice(0, limit);
  } catch {
    return [];
  }
}

export async function getAnalyticsSummary() {
  if (!hasDatabaseUrl()) {
    const fallback = fallbackStatus();
    return {
      source: "file",
      counts: fallback,
    };
  }

  const [subjects, syllabi, topicCounts, directives, pageStatus] = await Promise.all([
    queryDb<{ subject_key: string; count: string }>("select subject_key, count(*)::text as count from search_documents group by subject_key order by count desc"),
    queryDb<{ label: string; count: string }>("select unnest(syllabus_path) as label, count(*)::text as count from search_documents group by label order by count desc limit 30"),
    queryDb<{ label: string; count: string }>("select unnest(topic_tags) as label, count(*)::text as count from search_documents group by label order by count desc limit 30"),
    queryDb<{ directive: string; count: string }>(`
      select coalesce(directive, 'unknown') as directive, count(*)::text as count
      from questions
      group by directive
      order by count desc
      limit 20
    `),
    queryDb<{ page_status: string; count: string }>(`
      select page_status, count(*)::text as count
      from answers
      group by page_status
      order by count desc
    `),
  ]);

  return {
    source: "database",
    subjects: subjects.rows,
    syllabi: syllabi.rows,
    topics: topicCounts.rows,
    directives: directives.rows,
    pageStatus: pageStatus.rows,
  };
}

export type DbAnalyticsSummary = {
  source: "database";
  subjects: Array<{ subject_key: string; count: string }>;
  syllabi: Array<{ label: string; count: string }>;
  topics: Array<{ label: string; count: string }>;
  directives: Array<{ directive: string; count: string }>;
  pageStatus: Array<{ page_status: string; count: string }>;
};

export function isDbAnalytics(
  analytics: Awaited<ReturnType<typeof getAnalyticsSummary>>,
): analytics is DbAnalyticsSummary {
  return analytics.source === "database";
}

function fallbackStatus() {
  try {
    const manifest = JSON.parse(readFileSync(join(VAULT_DB_DIR, "manifest.json"), "utf-8"));
    return {
      source: "file",
      embeddingsAvailable: hasEmbeddingApi(),
      questions: manifest.counts.questions,
      answers: manifest.counts.answers,
      searchDocuments: manifest.counts.answersWithSource,
      embeddedSearchDocuments: 0,
      totalSearchDocuments: manifest.counts.answersWithSource,
      latestRuns: [{ ingest_kind: "vault-db-export", status: "complete", source_file: "data/app/vault/db", notes: JSON.stringify(manifest.counts), created_at: manifest.generatedAt }],
    };
  } catch {
    return {
      source: "file",
      embeddingsAvailable: hasEmbeddingApi(),
      questions: 0,
      answers: 0,
      searchDocuments: 0,
      embeddedSearchDocuments: 0,
      totalSearchDocuments: 0,
      latestRuns: [],
    };
  }
}
