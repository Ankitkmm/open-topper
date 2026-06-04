create extension if not exists vector;

create table if not exists subjects (
  subject_key text primary key,
  subject_label text not null,
  question_count integer not null default 0,
  answer_count integer not null default 0,
  topper_count integer not null default 0,
  topic_count integer not null default 0,
  syllabus_count integer not null default 0,
  search_text text not null default ''
);

create table if not exists syllabus_nodes (
  node_id text primary key,
  subject_key text not null references subjects(subject_key) on delete cascade,
  node_label text not null,
  question_count integer not null default 0,
  answer_count integer not null default 0,
  topper_count integer not null default 0,
  top_question_ids text[] not null default '{}',
  top_answer_ids text[] not null default '{}',
  search_text text not null default ''
);

create table if not exists topics (
  topic_id text primary key,
  subject_key text not null references subjects(subject_key) on delete cascade,
  topic_label text not null,
  topic_group text,
  search_text text not null default ''
);

create table if not exists toppers (
  topper_id text primary key,
  topper_name text not null,
  normalized_name text not null,
  rank integer,
  attempt_year integer,
  marks_obtained text,
  institute text,
  aliases text[] not null default '{}',
  search_text text not null default ''
);

create table if not exists topper_attempts (
  attempt_id text primary key,
  topper_id text not null references toppers(topper_id) on delete cascade,
  attempt_year integer,
  rank integer,
  marks_obtained text,
  optional_subject text
);

create table if not exists source_documents (
  source_document_id text primary key,
  answer_id text,
  drive_key text,
  source_url text,
  r2_key text,
  r2_public_url text,
  page_count integer,
  file_name text,
  canonical_file_name text,
  link_source text,
  source_available boolean not null default false
);

create table if not exists questions (
  question_id text primary key,
  canonical_question text not null,
  paper text not null,
  category text not null,
  subject_key text not null references subjects(subject_key) on delete restrict,
  subject_label text not null,
  estimated_year integer,
  marks integer,
  directive text,
  syllabus_path text[] not null default '{}',
  topic_tags text[] not null default '{}',
  keywords text[] not null default '{}',
  search_text text not null default '',
  search_tsv tsvector generated always as (to_tsvector('english', coalesce(search_text, ''))) stored
);

create table if not exists question_aliases (
  alias_id text primary key,
  question_id text not null references questions(question_id) on delete cascade,
  alias_text text not null,
  alias_normalized text not null
);

create table if not exists answers (
  answer_id text primary key,
  question_id text not null references questions(question_id) on delete cascade,
  topper_id text references toppers(topper_id) on delete set null,
  source_document_id text references source_documents(source_document_id) on delete set null,
  question_text text not null,
  paper text not null,
  category text not null,
  subject_key text not null references subjects(subject_key) on delete restrict,
  subject_label text not null,
  attempt_year integer,
  rank integer,
  marks_obtained text,
  institute text,
  topper_name text not null,
  syllabus_path text[] not null default '{}',
  topic_tags text[] not null default '{}',
  keywords text[] not null default '{}',
  value_adds text[] not null default '{}',
  summary text not null default '',
  source_status text not null default 'unknown',
  pdf_available boolean not null default false,
  pdf_page integer,
  page_status text not null default 'missing',
  primary_match_score numeric not null default 0,
  primary_match_elo integer not null default 0
);

create table if not exists search_documents (
  answer_id text primary key references answers(answer_id) on delete cascade,
  question_id text not null references questions(question_id) on delete cascade,
  subject_key text not null references subjects(subject_key) on delete restrict,
  attempt_year integer,
  primary_match_score numeric not null default 0,
  primary_match_elo integer not null default 0,
  pdf_available boolean not null default false,
  search_text text not null default '',
  search_tsv tsvector generated always as (to_tsvector('english', coalesce(search_text, ''))) stored,
  embedding vector(256)
);

create table if not exists ingest_audit (
  audit_id bigserial primary key,
  ingest_kind text not null,
  status text not null,
  source_file text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists duplicate_reviews (
  duplicate_key text primary key,
  kept_answer_id text not null,
  dropped_answer_ids text[] not null default '{}',
  question_id text not null,
  topper_name text not null,
  page_hint text,
  source_drive_id text
);

create table if not exists api_rate_limits (
  scope text not null,
  client_key text not null,
  window_started_at timestamptz not null,
  hit_count integer not null default 0,
  expires_at timestamptz not null,
  primary key (scope, client_key, window_started_at)
);

create index if not exists idx_questions_subject on questions(subject_key, estimated_year);
create index if not exists idx_questions_search on questions using gin(search_tsv);
create index if not exists idx_answers_question on answers(question_id, subject_key);
create index if not exists idx_search_documents_search on search_documents using gin(search_tsv) where pdf_available = true;
create index if not exists idx_search_documents_subject on search_documents(subject_key, attempt_year) where pdf_available = true;
create index if not exists idx_search_documents_embedding_hnsw on search_documents using hnsw (embedding vector_cosine_ops) where pdf_available = true and embedding is not null;
