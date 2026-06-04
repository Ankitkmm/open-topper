create table if not exists ingest_runs (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  source_limit integer not null,
  total_queued integer not null,
  status text not null default 'queued',
  notes text
);

create table if not exists sheet_rows (
  id bigserial primary key,
  workbook text not null,
  sheet_name text not null,
  row_number integer not null,
  file_name text,
  link text,
  question text,
  introduction text,
  page_hint text,
  syllabus text,
  topper_name text,
  marks text,
  raw jsonb not null default '{}'::jsonb,
  unique(workbook, sheet_name, row_number)
);

create table if not exists source_documents (
  id bigserial primary key,
  drive_key text unique,
  file_name text,
  local_path text,
  source_url text,
  page_count integer,
  title text,
  topper_name text,
  subject text,
  paper text,
  created_at timestamptz not null default now()
);

create table if not exists source_pages (
  id bigserial primary key,
  source_document_id bigint not null references source_documents(id) on delete cascade,
  page_number integer not null,
  extracted_text text,
  ocr_text text,
  is_scanned boolean not null default false,
  extraction_confidence numeric,
  unique(source_document_id, page_number)
);

create table if not exists answer_pages (
  id bigserial primary key,
  sheet_row_id bigint not null references sheet_rows(id) on delete cascade,
  source_document_id bigint references source_documents(id) on delete set null,
  page_number integer,
  answer_text text,
  answer_summary text,
  examiner_remarks text,
  value_additions jsonb not null default '[]'::jsonb,
  asset_mentions jsonb not null default '[]'::jsonb,
  match_confidence numeric,
  created_at timestamptz not null default now()
);

create table if not exists embeddings (
  id bigserial primary key,
  object_type text not null,
  object_id bigint not null,
  embedding vector(1536),
  unique(object_type, object_id)
);

create index if not exists idx_sheet_rows_question on sheet_rows using gin (to_tsvector('english', coalesce(question, '') || ' ' || coalesce(syllabus, '') || ' ' || coalesce(topper_name, '')));
create index if not exists idx_answer_pages_source on answer_pages (source_document_id, page_number);
create index if not exists idx_source_pages_document on source_pages (source_document_id, page_number);

create table if not exists vault_subjects (
  id bigserial primary key,
  subject_key text not null unique,
  subject_label text not null,
  question_count integer not null default 0,
  answer_count integer not null default 0,
  topper_count integer not null default 0,
  topic_count integer not null default 0,
  syllabus_count integer not null default 0,
  search_text text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists vault_questions (
  id text primary key,
  question text not null,
  paper text not null,
  category text not null,
  estimated_year integer,
  subject_key text not null,
  subject_label text not null,
  syllabus_tags jsonb not null default '[]'::jsonb,
  keywords jsonb not null default '[]'::jsonb,
  topper_count integer not null default 0,
  answer_count integer not null default 0,
  source_available_count integer not null default 0,
  topic_tags jsonb not null default '[]'::jsonb,
  search_text text not null default '',
  search_tsv tsvector generated always as (to_tsvector('english', coalesce(search_text, ''))) stored,
  created_at timestamptz not null default now()
);

create table if not exists vault_answers (
  id text primary key,
  question_id text not null references vault_questions(id) on delete cascade,
  question text not null,
  paper text not null,
  category text not null,
  estimated_year integer,
  subject_key text not null,
  subject_label text not null,
  syllabus_tags jsonb not null default '[]'::jsonb,
  keywords jsonb not null default '[]'::jsonb,
  topic_tags jsonb not null default '[]'::jsonb,
  topper_name text,
  rank integer,
  year integer,
  institute text,
  marks text,
  source_drive_id text,
  source_url text,
  source_available boolean not null default false,
  source_status text not null default 'unknown',
  link_source text,
  original_filename text,
  clean_filename text,
  page_raw text,
  page_normalized integer,
  page_status text not null default 'missing',
  page_count integer,
  local_pdf_path text,
  summary text,
  summary_status text not null default 'missing',
  summary_source text not null default 'inferred',
  value_adds jsonb not null default '[]'::jsonb,
  asset_mentions jsonb not null default '[]'::jsonb,
  examiner_remarks text,
  extraction_mode text not null default 'local',
  confidence numeric,
  primary_match_score numeric,
  primary_match_elo integer,
  related_matches jsonb not null default '[]'::jsonb,
  search_text text not null default '',
  search_tsv tsvector generated always as (to_tsvector('english', coalesce(search_text, ''))) stored,
  created_at timestamptz not null default now()
);

create table if not exists vault_matches (
  id bigserial primary key,
  answer_id text not null references vault_answers(id) on delete cascade,
  question_id text not null references vault_questions(id) on delete cascade,
  match_rank integer not null,
  match_score numeric not null,
  match_elo integer not null,
  match_type text not null,
  match_reasons jsonb not null default '[]'::jsonb,
  shared_syllabus_tags jsonb not null default '[]'::jsonb,
  shared_keywords jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique(answer_id, question_id)
);

create index if not exists idx_vault_questions_subject on vault_questions (subject_key, estimated_year);
create index if not exists idx_vault_questions_search on vault_questions using gin (search_tsv);
create index if not exists idx_vault_answers_question on vault_answers (question_id, subject_key);
create index if not exists idx_vault_answers_search on vault_answers using gin (search_tsv);
create index if not exists idx_vault_matches_answer on vault_matches (answer_id, match_rank);
