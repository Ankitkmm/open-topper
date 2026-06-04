import type { PoolClient, QueryResultRow } from "pg";
import { hasDatabaseUrl, parsePositiveInteger } from "./env";
import { queryDb } from "./db";
import { embedText, toVectorLiteral } from "./embeddings";
import { isPublishableQuestionText, normalizePublicTopperName } from "./public-records";
import {
  getAnswerRecord,
  getQuestionAnswers,
  getQuestionRecord,
  loadQuestionIndex,
  loadSearchDocuments,
  getSyllabusBySubject,
  searchDocuments,
  type SearchQueryParams,
} from "./search-spine";

type SearchRow = {
  answer_id: string;
  question_id: string;
  subject_key: string;
  attempt_year: number | null;
  primary_match_score: number;
  primary_match_elo: number;
  pdf_available: boolean;
  canonical_question: string;
  paper: string;
  category: string;
  subject_label: string;
  rank: number | null;
  marks_obtained: string | null;
  institute: string | null;
  topper_name: string | null;
  syllabus_path: string[];
  topic_tags: string[];
  value_adds: string[];
  summary: string;
  pdf_page: number | null;
  page_status?: "valid" | "missing" | "fallback" | "out_of_range" | null;
  source_status: string;
};

type QuestionDbRow = QueryResultRow & Record<string, unknown>;

type SyllabusDbRow = QueryResultRow & {
  subject_key: string;
  name: string;
  question_count: number;
  answer_count: number;
  topper_count: number;
  topQuestions: string[];
  topAnswers: string[];
};

export async function searchAnswerCards(params: SearchQueryParams) {
  if (!hasDatabaseUrl()) return searchDocuments(params);

  const limit = clamp(parsePositiveInteger(String(params.limit ?? 24), 24), 1, 60);
  const offset = params.cursor ? Math.max(0, Number.parseInt(params.cursor, 10) || 0) : 0;
  const queryText = params.q?.trim() || "";
  const hasQuery = Boolean(queryText);
  const queryEmbedding = hasQuery ? await embedText(queryText).catch(() => null) : null;
  const vectorLiteral = queryEmbedding ? toVectorLiteral(queryEmbedding) : null;
  const filterValues: unknown[] = [];
  const bindFilter = (value: unknown) => {
    filterValues.push(value);
    return `$${filterValues.length}`;
  };
  const where: string[] = ["sd.pdf_available = true"];

  if (params.subject) where.push(`sd.subject_key = ${bindFilter(normalizeSubjectKey(params.subject))}`);
  if (params.paper) where.push(`lower(q.paper) like ${bindFilter(`%${String(params.paper).toLowerCase()}%`)}`);
  if (params.year) where.push(`sd.attempt_year = ${bindFilter(params.year)}`);
  if (params.topper) where.push(`lower(a.topper_name) like ${bindFilter(`%${String(params.topper).toLowerCase()}%`)}`);
  if (params.syllabus) where.push(`exists (select 1 from unnest(a.syllabus_path) as tag where lower(tag) like ${bindFilter(`%${String(params.syllabus).toLowerCase()}%`)})`);
  if (params.topic) where.push(`exists (select 1 from unnest(a.topic_tags) as tag where lower(tag) like ${bindFilter(`%${String(params.topic).toLowerCase()}%`)})`);

  const totalResult = await queryDb<{ count: string }>(
    `select count(*)::text as count
     from search_documents sd
     join answers a on a.answer_id = sd.answer_id
     join questions q on q.question_id = sd.question_id
     where ${where.join(" and ")}`,
    filterValues,
  );
  const total = Number(totalResult.rows[0]?.count || 0);

  const selectColumns = `
    sd.answer_id,
    sd.question_id,
    sd.subject_key,
    sd.attempt_year,
    sd.primary_match_score,
    sd.primary_match_elo,
    sd.pdf_available,
    q.canonical_question,
    q.paper,
    q.category,
    q.subject_label,
    a.rank,
    a.marks_obtained,
    a.institute,
    a.topper_name,
    a.syllabus_path,
    a.topic_tags,
    a.value_adds,
    a.summary,
    a.pdf_page,
    a.page_status,
    a.source_status
  `;
  const fromClause = `
    from search_documents sd
    join answers a on a.answer_id = sd.answer_id
    join questions q on q.question_id = sd.question_id
  `;

  let result;
  if (!hasQuery) {
    const values = [...filterValues, offset, limit];
    result = await queryDb<SearchRow & { score: number }>(
      `select
        ${selectColumns},
        ((least(sd.primary_match_score, 100)::numeric / 100.0) * 0.5 + (least(sd.primary_match_elo, 2200)::numeric / 2200.0) * 0.5) as score
       ${fromClause}
       where ${where.join(" and ")}
       order by score desc, sd.primary_match_elo desc, sd.answer_id asc
       offset $${filterValues.length + 1}
       limit $${filterValues.length + 2}`,
      values,
    );
  } else {
    const lexicalLimit = Math.max(120, limit * 8);
    const vectorLimit = Math.max(120, limit * 8);
    const values: unknown[] = [queryText];
    let vectorPlaceholder = "null";
    if (vectorLiteral) {
      values.push(vectorLiteral);
      vectorPlaceholder = `$${values.length}`;
    }
    values.push(...filterValues);
    const filterOffset = values.length - filterValues.length;
    const whereWithOffset = where.map((clause) =>
      clause.replace(/\$(\d+)/g, (_match, index) => `$${Number(index) + filterOffset}`),
    );
    const lexicalLimitPlaceholder = `$${values.push(lexicalLimit)}`;
    const vectorLimitPlaceholder = `$${values.push(vectorLimit)}`;
    const offsetPlaceholder = `$${values.push(offset)}`;
    const limitPlaceholder = `$${values.push(limit)}`;
    const lexicalOrder = "ts_rank_cd(sd.search_tsv, plainto_tsquery('english', $1::text)) desc, sd.primary_match_elo desc, sd.answer_id asc";
    const vectorCandidates = vectorLiteral
      ? `
    vector_candidates as (
      select
        sd.answer_id,
        null::double precision as lexical_score,
        (1 - (sd.embedding <=> ${vectorPlaceholder}::vector)) as vector_score
      from search_documents sd
      join answers a on a.answer_id = sd.answer_id
      join questions q on q.question_id = sd.question_id
      where ${whereWithOffset.join(" and ")} and sd.embedding is not null
      order by sd.embedding <=> ${vectorPlaceholder}::vector, sd.answer_id asc
      limit ${vectorLimitPlaceholder}
    ),`
      : "";
    const unionVector = vectorLiteral ? "\n        union all\n        select * from vector_candidates" : "";
    const finalScore = vectorLiteral
      ? "((coalesce(c.lexical_score, 0) * 0.35) + (coalesce(c.vector_score, 0) * 0.35) + (least(sd.primary_match_score, 100)::numeric / 100.0) * 0.15 + (least(sd.primary_match_elo, 2200)::numeric / 2200.0) * 0.15)"
      : "((coalesce(c.lexical_score, 0) * 0.55) + (least(sd.primary_match_score, 100)::numeric / 100.0) * 0.225 + (least(sd.primary_match_elo, 2200)::numeric / 2200.0) * 0.225)";

    result = await queryDb<SearchRow & { score: number }>(
      `with lexical_candidates as (
         select
           sd.answer_id,
           ts_rank_cd(sd.search_tsv, plainto_tsquery('english', $1::text)) as lexical_score,
           null::double precision as vector_score
         from search_documents sd
         join answers a on a.answer_id = sd.answer_id
         join questions q on q.question_id = sd.question_id
         where ${whereWithOffset.join(" and ")} and sd.search_tsv @@ plainto_tsquery('english', $1::text)
         order by ${lexicalOrder}
         limit ${lexicalLimitPlaceholder}
       ),
       ${vectorCandidates}
       candidates as (
         select
           answer_id,
           max(lexical_score) as lexical_score,
           max(vector_score) as vector_score
         from (
           select * from lexical_candidates${unionVector}
         ) merged
         group by answer_id
       )
       select
         ${selectColumns},
         ${finalScore} as score
       from candidates c
       join search_documents sd on sd.answer_id = c.answer_id
       join answers a on a.answer_id = sd.answer_id
       join questions q on q.question_id = sd.question_id
       order by score desc, sd.primary_match_elo desc, sd.answer_id asc
       offset ${offsetPlaceholder}
       limit ${limitPlaceholder}`,
      values,
    );
  }
  const nextCursor = offset + limit < total ? String(offset + limit) : null;

  return {
    total,
    nextCursor,
    results: result.rows
      .filter((row) => isPublishableQuestionText(row.canonical_question))
      .map((row) => ({
        answerId: row.answer_id,
        questionId: row.question_id,
        question: row.canonical_question,
        paper: row.paper,
        category: row.category,
        subjectKey: row.subject_key,
        subjectLabel: row.subject_label,
        attemptYear: row.attempt_year,
        rank: row.rank,
        marksObtained: row.marks_obtained,
        institute: row.institute,
        topperName: normalizePublicTopperName(row.topper_name),
        syllabusPath: row.syllabus_path,
        topicTags: row.topic_tags,
        valueAdds: row.value_adds,
        summary: row.summary,
        primaryMatchScore: row.primary_match_score,
        primaryMatchElo: row.primary_match_elo,
        pdfAvailable: row.pdf_available,
        pdfPage: row.pdf_page,
        pageStatus: row.page_status || null,
        sourceStatus: row.source_status,
        serverScore: Number(Number(row.score || 0).toFixed(4)),
        score: Number(Number(row.score || 0).toFixed(4)),
      })),
  };
}

export async function getQuestionDetail(questionId: string) {
  if (!hasDatabaseUrl()) {
    const question = getQuestionRecord(questionId);
    const answers = getQuestionAnswers(questionId);
    return question ? { question, answers } : null;
  }

  const questionResult = await queryDb<QuestionDbRow>(`select * from questions where question_id = $1 limit 1`, [questionId]);
  if (!questionResult.rows[0]) return null;
  const answerResult = await queryDb<QuestionDbRow>(
    `select
       sd.answer_id,
       sd.question_id,
       sd.subject_key,
       sd.attempt_year,
       sd.primary_match_score,
       sd.primary_match_elo,
       sd.pdf_available,
       a.question_text as question,
       a.paper,
       a.category,
       a.subject_label,
       a.rank,
       a.marks_obtained,
       a.institute,
       a.topper_name,
       a.syllabus_path,
       a.topic_tags,
       a.value_adds,
       a.summary,
       a.pdf_page,
       a.page_status,
       a.source_status
     from search_documents sd
     join answers a on a.answer_id = sd.answer_id
     where sd.question_id = $1 and sd.pdf_available = true
     order by sd.primary_match_elo desc, sd.primary_match_score desc
     limit 24`,
    [questionId],
  );
  return {
    question: questionResult.rows[0],
    answers: answerResult.rows,
  };
}

export async function getAnswerDetail(answerId: string) {
  if (!hasDatabaseUrl()) return getAnswerRecord(answerId);
  const result = await queryDb<QuestionDbRow>(
    `select
       sd.answer_id,
       sd.question_id,
       sd.subject_key,
       sd.attempt_year,
       sd.primary_match_score,
       sd.primary_match_elo,
       sd.pdf_available,
       q.canonical_question as question,
       a.question_text,
       a.paper,
       a.category,
       a.subject_label,
       a.rank,
       a.marks_obtained,
       a.institute,
       a.topper_name,
       a.syllabus_path,
       a.topic_tags,
       a.value_adds,
       a.summary,
       a.pdf_page,
       a.page_status,
       a.source_status
     from search_documents sd
     join answers a on a.answer_id = sd.answer_id
     join questions q on q.question_id = sd.question_id
     where sd.answer_id = $1
     limit 1`,
    [answerId],
  );
  return result.rows[0] || null;
}

export async function getSubjectSyllabus(subjectKey: string) {
  if (!hasDatabaseUrl()) return getSyllabusBySubject(subjectKey);
  const result = await queryDb<SyllabusDbRow>(
    `select subject_key, node_label as name, question_count, answer_count, topper_count, top_question_ids as "topQuestions", top_answer_ids as "topAnswers"
     from syllabus_nodes
     where subject_key = $1
     order by answer_count desc, node_label asc`,
    [normalizeSubjectKey(subjectKey)],
  );
  return result.rows;
}

export async function getSearchStats() {
  if (!hasDatabaseUrl()) {
    const docs = loadSearchDocuments();
    const questions = [...loadQuestionIndex().values()];
    const categoryCounts = new Map<string, number>();
    for (const question of questions) {
      categoryCounts.set(question.category, (categoryCounts.get(question.category) || 0) + 1);
    }
    return {
      totalQuestions: questions.length,
      answerLinks: docs.length,
      categoryCounts,
    };
  }

  const totalQuestions = await queryDb<{ count: string }>("select count(*)::text as count from questions");
  const totalAnswers = await queryDb<{ count: string }>("select count(*)::text as count from search_documents where pdf_available = true");
  const categories = await queryDb<{ category: string; count: string }>("select category, count(*)::text as count from questions group by category");
  return {
    totalQuestions: Number(totalQuestions.rows[0]?.count || 0),
    answerLinks: Number(totalAnswers.rows[0]?.count || 0),
    categoryCounts: new Map(categories.rows.map((row) => [row.category, Number(row.count)])),
  };
}

export async function ensurePgvector(client: PoolClient) {
  await client.query(`create extension if not exists vector`);
}

function normalizeSubjectKey(value: string) {
  return String(value || "").toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9-]/g, "");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
