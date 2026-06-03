# OpenTopper Architecture Recommendations

This project should not become "an LLM that reads PDFs." That will be slow, costly, and vague. Build it as a retrieval product first, then let LLMs reason over small, precise packets of evidence.

## What Gemini Got Right

- A plain vector database is not enough. UPSC value lives in relations: question, syllabus topic, directive, topper, answer page, rank, marks, source, OCR snippet, value additions, and similar PYQs.
- Pre-computation matters. The website should serve indexed facts and links, not run heavy LLM extraction while a user waits.
- Parent-child chunking is the right pattern: search small answer parts, then return the full answer/page as context.
- A distilled wiki layer is useful, but it should be generated from structured data, not replace the database.

## What To Ignore

- Do not jump straight to Neo4j. The current data is messy, and the web app needs fast filters, search, pagination, user state, and PDF links. Postgres plus a search index is a better first production spine.
- Do not build an "agent swarm" until ingestion quality is strong. Multiple agents over bad entities will only make confident noise.
- Do not rely on live LLMs for ordinary browsing. Search pages must be deterministic and cacheable.
- Do not store the whole product in Markdown/Obsidian. Markdown is excellent as an export and wiki surface, not as the source of truth.

## Recommended Production Shape

### 1. Source Of Truth

Use Postgres with these core tables:

- `sources`: coaching platform, workbook, HAR scrape, OCR file, PDF location.
- `toppers`: canonical person entity, aliases, rank, attempt year, optional subject, known marks.
- `questions`: canonical question, raw variants, paper, year, marks, directive, syllabus path.
- `answers`: one topper answer to one question, with source PDF, page range, known score, remarks, OCR status.
- `answer_chunks`: intro/body/conclusion/diagram/quote/example chunks with embeddings and page coordinates where available.
- `concepts`: normalized themes such as courage, Article 44, CAG, federalism, emotional intelligence.
- `edges`: typed links for `tests_concept`, `uses_asset`, `similar_to`, `cross_subject_link`, `mentions_thinker`.

Postgres can model this graph well enough at your current scale. Add `pgvector` for semantic lookup and proper indexes for filters.

### 2. Search Serving Layer

Use a denormalized search index for the website: Typesense, Meilisearch, or Elasticsearch/OpenSearch.

Each searchable document should represent a question-answer result card:

- question text, category, syllabus tags, directive, year
- topper name, rank, marks if known
- OCR preview, intro, value adds
- concepts and aliases
- PDF URL, page number, link type
- related question IDs and cross-subject IDs

The website queries this index for fast search and filters. Postgres remains the truth; the index is disposable and rebuildable.

### 3. Ingestion Pipeline

Treat ingestion like a compiler:

1. Parse raw Excel/HAR/OCR/PDF metadata into staging tables.
2. Normalize names, drive IDs, page numbers, sources, and categories.
3. Resolve entities with deterministic rules first, embeddings second, LLM last.
4. Split OCR into answer-level and chunk-level records.
5. Extract concepts, value additions, diagrams, examples, quotes, judgments, committees, articles, and thinker mentions.
6. Build similarity edges between questions and answer chunks.
7. Generate denormalized search documents.
8. Generate markdown/wiki rollups from the database.

Every extraction should keep `source_id`, `source_file`, `page`, and confidence. If the system cannot explain where a fact came from, it should not show it as truth.

### 4. LLM Layer

Use LLMs only after retrieval:

- Compare my answer to 3-8 tightly matched topper answers.
- Distill theme notes like "courage in GS4 and essay."
- Extract high-yield assets from OCR chunks.
- Explain why two questions are similar.

The LLM prompt should receive structured evidence, not a pile of PDFs.

### 5. Current Repo Next Steps

- Move away from loading `public/data/questions.json` into memory for every search path.
- Add a local search index build target before adding more UI features.
- Add stable IDs for questions, answers, toppers, concepts, and source documents.
- Add confidence and provenance fields to entity files.
- Split `QuestionCards.tsx`; it currently owns search state, pagination, PDF viewing, OCR loading, related PYQs, and rendering.
- Add tests for filtering, pagination, PDF link extraction, and topper-name normalization.

## Minimal Scalable Milestone

Before any agent feature, build this:

1. A Postgres schema and importer for the existing `public/data` and `public/data/entities`.
2. A search index builder that produces the current browse cards from Postgres.
3. A `/api/search` endpoint backed by the search index.
4. A `/question/[id]` page showing all answers, related PYQs, concepts, and source PDFs.
5. A "theme page" for a concept such as courage, federalism, or CAG.

That gives you the real UPSC Path-style web product. Then comparison agents become much easier, because they can retrieve exact answer packets instead of wandering through raw OCR.
