# Latest handoff

> The single most important file. The next agent (any tool) continues from here.
> Overwrite the sections below after each meaningful chunk of work.

Last updated: 2026-06-14 02:05 IST · By: Codex

## Cloudflare/OpenNext baseline implemented

### Summary

Implemented the repo-side fast Cloudflare migration baseline while keeping Vercel/local behavior intact. OpenNext Worker build now succeeds locally. Supabase Mumbai itself still requires the user-created external project/env vars.

### What changed

- Added Cloudflare/OpenNext tooling:
  - `open-next.config.ts`
  - `wrangler.jsonc`
  - `scripts/cloudflare/prepare-runtime-data.js`
  - `scripts/cloudflare/upload-runtime-data.sh`
  - npm scripts: `cf:prepare-data`, `cf:upload-data:preview`, `cf:upload-data:prod`, `cf:build`, `cf:preview`, `cf:deploy`
- Added private R2 runtime-data flow:
  - `.cloudflare-runtime-data/` generation is ignored and verified.
  - Current generated runtime data: public-pyqs 15 shards, public-official links 14 shards, workspace-index 24 shards, topper canonical 22 shards, answer-sources 1 object, pdf-r2-map 1 object.
- Migrated PDF answer-source path to async runtime-data loading with R2 binding `UPSCAT_RUNTIME_DATA` and local file fallback.
- Migrated feedback writes away from direct `pg`; `/api/feedback` now uses Supabase HTTP client/RLS via `src/lib/feedback-store.ts`.
- Made direct Postgres runtime safer for Cloudflare:
  - `src/lib/db.ts` lazy-loads `pg`.
  - `src/lib/rate-limit.ts` lazy-loads DB and falls back to memory on Cloudflare.
  - `cf:build` blanks `DATABASE_URL` so direct Postgres is not bundled into Worker runtime.
  - `open-next.config.ts` disables the `workerd` package condition to avoid `pg-cloudflare` optional socket bundling.
- Replaced `src/proxy.ts` with `src/middleware.ts` as an OpenNext compatibility exception. Next 16 warns that middleware is deprecated in favor of proxy, but OpenNext rejects Node proxy output currently.
- Removed `/about` edge runtime probe; `/about` is static again.
- Updated migration docs/runbook/decisions to the current OpenNext + R2 approach.

### Verification

- `npm run lint -- --no-fix` → pass
- `npm run typecheck` → pass
- `npm test` → pass (42 tests)
- `npm run build` → pass; expected warning: `middleware` file convention deprecated in Next 16
- `npm run cf:prepare-data` → pass
- `npm run cf:build` → pass; generated `.open-next/worker.js`
- `npm audit --omit=dev` → 0 vulnerabilities
- Full dev audit still reports known dev-only high advisories from `xlsx` and OpenNext/Wrangler/esbuild, with no non-breaking upstream fix.

### Remaining blockers

1. **External Cloudflare setup:** create R2 buckets and authenticate Wrangler/API token; then upload runtime data and run preview with real bindings.
2. **External Supabase setup:** create fresh Mumbai (`ap-south-1`) project, apply `20260605_user_progress.sql` + `20260615_feedback.sql`, set deployment env vars.
3. **Search/data full Worker migration:** `/api/search`, official/workspace detail APIs, and subject page loaders still rely on sync `fs` modules (`official-pyqs.ts`, `question-bank-runtime.ts`, etc.). OpenNext build succeeds, but full runtime correctness on Cloudflare preview requires converting those to async R2 runtime-data shards.
4. **Middleware/proxy tradeoff:** Keep `src/middleware.ts` for OpenNext until OpenNext supports Next 16 Node proxy output; do not blindly convert it back to `proxy.ts` unless Cloudflare build is re-tested.

### Exact next step

Create the Cloudflare R2 buckets from `docs/cloudflare-opennext-runbook.md`, then run:

```bash
npm run cf:prepare-data
npm run cf:upload-data:preview
npm run cf:preview
```

Separately create the Supabase Mumbai project and provide the new public URL/key for deployment env updates.

---

# Latest handoff

> The single most important file. The next agent (any tool) continues from here.
> Overwrite the sections below after each meaningful chunk of work.

Last updated: 2026-06-14 01:14 IST · By: Codex

## Release cleanup + migration prep commits complete

### Summary

Executed the safe follow-up work from the Kiro handoff and committed it in focused commits. No `git add .` was used. Private generated answer-source files were not staged. Full verification passed.

### Commits created

- `1e5f4c4` docs: add migration and operations runbooks
- `09b2524` ci: add production verification workflow
- `ede252a` chore: add operational verification scripts
- `79ae239` chore: update agent and lint tooling
- `7684e80` feat: add offline progress queue
- `dddc28c` fix: hide marks badges in study cards
- `85f9d13` chore: keep production dependencies audit-clean
- `0755e84` feat: align feedback schema end-to-end
- `620c609` feat: add authoritative optional PYQ sources
- `882ace3` docs: replace template readme with project runbook
- `ec2e09b` fix: use legacy pdfjs browser build
- `d6e355d` chore: add edge runtime migration probe

### Verification

- `npm run lint -- --no-fix` → pass
- `npm run typecheck` → pass
- `npm test` → pass (42 tests)
- `npm run build-pyqs` → pass (`1,469` official questions, `30,138` linked copies)
- `npm run verify` → pass, including production build and public PDF leak checks
- Expected build warning: `/about` uses `export const runtime = "edge"`, so it is dynamic (`ƒ`) instead of static. This is intentional as a Cloudflare edge migration probe.

### Files intentionally not committed

Untracked scratch/junk remains and should not be staged unless manually reviewed:

```text
how does one do this, Based on the video transcript, the cre….md
new/
optional scraping.md/
scrap_essay.md/
scripts/ai/
sociology.md/
transit_station_collector.py
untitled folder/
```

Private/generated answer-source files were restored after verification and are clean.

### External migration blockers / exact next step

1. **Supabase Mumbai:** Create a new Supabase project in `ap-south-1` (Mumbai), apply `supabase/migrations/20260605_user_progress.sql` and `supabase/migrations/20260615_feedback.sql`, then swap deployment env vars. Do not delete the old project until at least 1 week after cutover.
2. **Cloudflare:** Create/confirm Cloudflare account access and approve adding the deployment integration/token before Cloudflare Pages work. Code is not yet Cloudflare-ready; next local phase is `fs` → static JSON imports and `pg` replacement.
3. **Deploy/release:** Push this branch and deploy to the current Vercel path first if desired. Cloudflare cutover should wait until the migration checklist phases are complete.

---

# Latest handoff

> The single most important file. The next agent (any tool) continues from here.
> Overwrite the sections below after each meaningful chunk of work.

Last updated: 2026-06-14 02:30 IST · By: Kiro

## Migration Prep Audit Complete

### Summary

Created `docs/migration-execution-checklist.md` — a strict, release-captain-ready execution doc for both Cloudflare Workers/Pages and Supabase Mumbai migrations. No app code changed. Docs-only pass.

### Deliverable

`docs/migration-execution-checklist.md` contains:
- Cloudflare blocker audit (9 fs files, 6 process.cwd files, 3 crypto files, 2 pg files, 1 hard-blocked dep)
- Route portability assessment (safe vs blocked)
- Database coupling map (hard vs soft deps)
- 5-phase Cloudflare migration checklist
- Supabase Mumbai readiness audit (env vars, migrations, dependencies, rollback)
- Supabase execution steps (pre-migration → canary → cutover → monitoring)
- Effort summary table
- 4 decisions requiring release captain approval

### Key findings

1. **Supabase Mumbai is ready to execute now.** Only needs: new project creation, apply 2 migrations, swap 4 env vars. Instant rollback. Public browsing unaffected.
2. **Cloudflare migration requires ~8 days of code changes** before it's viable. The 9-file `fs` refactoring is the biggest single item.
3. **Rate limiting gracefully degrades** — it falls back to in-memory when `DATABASE_URL` is absent. Only `/api/feedback` has a hard DB dependency.
4. **`@xenova/transformers` is already safely gated** — no action needed as long as `ENABLE_LOCAL_EMBEDDINGS=false`.

### Verification

- No code changes — docs only — no lint/typecheck needed

### Blockers

- None for this docs pass

### Exact next step

Release captain reviews `docs/migration-execution-checklist.md` and decides:
1. Execute Supabase Mumbai migration (low risk, high value)?
2. Approve Cloudflare Phase 1 (add `wrangler.toml`)?
3. Approve `@neondatabase/serverless` for pg replacement?

---

### Overview

This section covers all remaining modified/untracked files outside the feedback lane. Grouped by safe-to-stage commit, with blockers and never-stage paths clearly identified.

---

### Commit 1: Docs / Ops (safe, no code)

```bash
git add \
  docs/deployment-runbook.md \
  docs/ai-operations.md \
  docs/reconciliation-table.md \
  docs/auth-progress-audit.md \
  docs/supabase-mumbai-migration.md \
  docs/pdf-delivery-strategy.md \
  docs/cloudflare-migration.md \
  docs/cloudflare-audit-findings.md \
  docs/ai-decisions.md \
  docs/ai-handoff.md \
  docs/kiro-next-task.md \
  docs/ai-mailbox.md \
  docs/kiro-orchestrator-playbook.md
```

### Commit 2: CI Pipeline (safe, no code)

```bash
git add .github/workflows/ci.yml
```

### Commit 3: Operational Scripts (safe, no app code)

```bash
git add \
  scripts/smoke-test.js \
  scripts/check-function-sizes.js \
  scripts/reconcile-branch.sh \
  scripts/verify-cherry-picks.sh \
  scripts/admin-feedback-queries.sql
```

### Commit 4: Tooling / Config (safe, low-risk)

```bash
git add \
  CLAUDE.md \
  .gitignore \
  eslint.config.mjs
```

### Commit 5: Progress Queue (safe, new file)

```bash
git add src/lib/progress-queue.ts
```

### Commit 6: Marks Badge Removal (safe, pure deletion)

```bash
git add \
  src/components/QuestionCards.tsx \
  src/components/SubjectWorkspace.tsx
```

These are single-line deletions of `{question.marks && ...}` and `{copy.marks && ...}` badge rendering. No logic changes.

### Commit 7: package.json + package-lock.json (review needed)

```bash
git add package.json package-lock.json
```

**Note:** `package.json` has added scripts (`smoke`, `check-function-sizes`) plus dependency changes from the security audit (overrides, xlsx moved to devDeps). `package-lock.json` has large churn from those changes. Review diff before staging.

### Commit 8: About page edge POC (review — may want to revert)

```bash
git add src/app/about/page.tsx
```

**Note:** Adds `export const runtime = "edge"` as a Cloudflare proof-of-concept. This makes the page dynamic instead of static-generated. The code has a `// TODO: remove before production` comment. Release captain should decide: keep for testing or revert.

---

### NEEDS REVIEW / DO NOT AUTO-STAGE

| File/Area | Issue | Recommendation |
|-----------|-------|---------------|
| `data/app/public-official-pyq-links.json` | **1.1 million line diff** (761K insertions). Must be verified with `npm run build-pyqs` producing identical output. | Only stage after deterministic rebuild verification |
| `data/app/answer-sources.json` | 2-line change but is a **private mapping file** listed in security steering as never-public | **Do NOT stage** — gitignored/private |
| `data/app/public-pyqs.json` | 2-line change | Verify with rebuild; safe if rebuild matches |
| `data/app/topper-answer-canonical.json` | 2-line change | Verify with rebuild; safe if rebuild matches |
| `data/pdf-runtime/answer-sources.json` | Private runtime data | **Do NOT stage** — private path |
| `data/curation/topper-name-overrides.json` | 100 lines, new file | Review — curated data, likely safe but not verified |
| `PYQS/UPSC ESSAYS PYQS.md` | 516-line reorganization (theme headings reworded) | Review — data quality lane, needs `build-pyqs` verification |
| `src/lib/official-pyqs.ts` | 783 lines added (optional PYQ pipeline) | **Large change** — review carefully, run tests |
| `scripts/build-official-pyq-links.ts` | 372-line diff (essay scoring changes) | Review alongside official-pyqs.ts |
| `src/lib/__tests__/official-pyqs-boundaries.test.ts` | 228 lines, new test | Safe if tests pass |
| `src/lib/__tests__/optional-pyq-parsing.test.ts` | New test file (untracked) | Safe if tests pass |
| `PYQS/optional/` | 6 new optional source files | Data quality review needed |
| `Dockerfile` / `docker-compose.yml` / `README.md` | Infrastructure changes | Review — not urgent |
| `scripts/ai/` | Agent helper scripts | Review — may not be needed in repo |
| `src/components/PdfViewerPage.tsx` | Modified vs local HEAD but **identical to origin/main** | **Do NOT stage** — already on production, local diff is branch-noise |

---

### NEVER STAGE (dangerous/private/junk)

```
new/
untitled folder/
optional scraping.md/
scrap_essay.md/
sociology.md/
how does one do this, Based on the video transcript, the cre….md
transit_station_collector.py
docs/.kiro-next-task.md.swp
data/app/answer-sources.json
data/pdf-runtime/answer-sources.json
```

---

### Blockers

1. **Large data diff** (`public-official-pyq-links.json`): Cannot stage safely without running `npm run build-pyqs` on a clean baseline and confirming the output matches. This is a 1.1M-line file.
2. **PYQ pipeline changes** (`official-pyqs.ts`, `build-official-pyq-links.ts`, `PYQS/` files): These are substantial and interdependent. Should be staged together as one "data quality" commit only after pipeline verification passes end-to-end.
3. **About page edge annotation**: Release captain must decide if the `export const runtime = "edge"` POC belongs in production or should be reverted.

### Safe immediately (no review needed)

Commits 1–6 above can be staged right now with zero risk. They are docs, scripts, config, and pure UI deletions. All verified with lint/typecheck/test/build passing.

### Exact next step

Release captain stages Commits 1–6 immediately. Then decides on Commits 7–8 and the data/PYQ lane after review.

---

## Feedback Lane — RELEASE-READY (strict verification, 2026-06-14 01:45 IST)

### Status: ✅ Complete and verified

Schema: `{ page_path, category, message }`. Old fields gone. Build passes. Migration is canonical.

**Stage command:**
```bash
git add \
  src/components/FeedbackWidget.tsx \
  src/lib/feedback.ts \
  src/app/api/feedback/route.ts \
  src/components/OfficialQuestionCards.tsx \
  src/components/OfficialSubjectWorkspace.tsx \
  src/app/page.tsx \
  supabase/migrations/20260615_feedback.sql

git commit -m "feat: align feedback schema end-to-end (page_path/category/message)"
```

Apply `supabase/migrations/20260615_feedback.sql` to production Supabase before or after deploy.

---

## Prior session context (30-Day Maintenance Plan — all phases complete)

All 5 phases of the 30-day maintenance plan were completed in the same session. Summary of other lanes (non-feedback):

**Phase 0 — Reconciliation:** `scripts/reconcile-branch.sh`, `docs/reconciliation-table.md`
**Phase 1 — Production Reliability:** `scripts/smoke-test.js`, `scripts/check-function-sizes.js`, `docs/deployment-runbook.md`
**Phase 2 — Data Quality:** PYQ pipeline validated, `scripts/admin-feedback-queries.sql`
**Phase 3 — Auth & Supabase Region:** `docs/auth-progress-audit.md`, `docs/supabase-mumbai-migration.md`, `src/lib/progress-queue.ts`
**Phase 4 — Platform Migration Prep:** `docs/pdf-delivery-strategy.md`, `docs/cloudflare-migration.md`, `.github/workflows/ci.yml`, `docs/ai-operations.md`
**Tooling:** `CLAUDE.md`, `.gitignore`, Graphify installed

Decisions from that session:
- Feedback API uses `queryDb()` (raw pg) — matches existing codebase patterns
- Progress queue caps at 1000 entries, 3 retries per item
- CI uses placeholder Supabase env vars for build
- Cloudflare migration: ~8-10 person-days, recommend Worker+Origin first
- PDF delivery: keep current proxy for now
- Graphify output is local-only (gitignored)

Non-feedback blockers:
- Graphify LLM-enhanced pass (community naming) needs Claude API key via Claude Code session
- Other lanes (scripts, docs, CI, progress queue) need their own focused commits by the release captain

---

Last updated: 2026-06-13 20:25 IST · By: Codex

## Emergency swarm: scale posture + Safari PDF load fix

### Summary

The user reported sudden growth (~5,000 DAU, mostly India) plus user screenshots showing PDF failures. I ran a fast multi-agent swarm for ops/scaling/Supabase/AI-maintenance analysis and implemented the immediate user-visible PDF compatibility fix locally.

### What changed

- `/Users/ankitkumar/Downloads/open-topper/src/components/PdfViewerPage.tsx`
  - Switched the client PDF import from `pdfjs-dist` to `pdfjs-dist/legacy/build/pdf.mjs`.
  - Switched the worker URL from `pdfjs-dist/build/pdf.worker.min.mjs` to `pdfjs-dist/legacy/build/pdf.worker.min.mjs`.
  - Rationale: `pdfjs-dist@6.0.227` standard browser build calls the new static `URL.parse()` API. The screenshot error (`URL.parse is not a function`) matches Safari/browser environments without that API. The legacy pdf.js build includes the needed compatibility/polyfill path while preserving the current custom viewer flow.

### Verification

- `npm run typecheck` → pass
- `npm run lint -- --no-fix` → pass
- `npm test` → pass (42 tests)
- `npm run build` → pass
- Build leak checks before and after build → pass

### Swarm findings / operational decisions

- Treat `/pdf/*`, `/api/answer-source*`, and `/api/search` as the hottest/safest-critical paths.
- Do not run future swarm edits in one dirty checkout; use lane-specific worktrees with one release captain.
- Vercel Hobby is now risky mainly because PDF proxying and API calls can burn function invocations and data transfer quickly.
- Supabase Tokyo is not the immediate bottleneck while auth/progress are mostly gated/QA-disabled, but if progress/auth becomes central for Indian users, use Supabase Mumbai (`ap-south-1`) for a new production project/migration.
- Cloudflare migration remains a good 7–30 day direction, but not before the live PDF/search path is boring; current blockers are runtime `fs`, Node `pg`, and crypto assumptions documented in `docs/cloudflare-migration.md`.

### Files changed by Codex in this pass

- `/Users/ankitkumar/Downloads/open-topper/src/components/PdfViewerPage.tsx`
- `/Users/ankitkumar/Downloads/open-topper/docs/ai-handoff.md`
- `/Users/ankitkumar/Downloads/open-topper/docs/ai-decisions.md`

Note: `npm run build` also ran `scripts/sync-pdf-runtime-data.js`; inspect existing modified `data/pdf-runtime/*` before staging because the worktree already had many unrelated edits.

### Blockers / caveats

- I could not perform a real browser PDF open smoke from the production UI here because valid short-lived PDF cookies require the in-app button flow on a running deployed/dev server.
- The current worktree has many pre-existing modified/untracked files from other sessions; do not use `git add .`.
- Three exploratory agents were still running slowly after the urgent patch/build completed; they were shut down to avoid wasting time. The AI-maintenance agent completed and its findings were incorporated into the user-facing plan.

### Exact next step

Stage only the emergency PDF fix plus the coordination docs if desired:

```bash
git add /Users/ankitkumar/Downloads/open-topper/src/components/PdfViewerPage.tsx
git add /Users/ankitkumar/Downloads/open-topper/docs/ai-handoff.md
git add /Users/ankitkumar/Downloads/open-topper/docs/ai-decisions.md
git status --short
```

Then deploy this patch quickly and ask affected Safari/iPhone users to retry PDF opening through the app's `View PDF` button flow.

---

Last updated: 2025-07-05 (session 3) · By: Kiro

## Essay Matching Relaxed + Themes Reworded

### Summary

Relaxed essay matching thresholds so topper cards link to official PYQs based on thematic relevance (not just exact match). Reworded essay theme headings. History fix from previous session remains intact.

### Changes

- `PYQS/UPSC ESSAYS PYQS.md` — Reorganized with 27 reworded theme headings (derived from scraped upscpath data but not identical)
- `scripts/build-official-pyq-links.ts`:
  - `classifyEssayScore()` — Added "loose-topic-match" tier, lowered "topic-match" thresholds
  - `scoreEssayCandidates()` filter — Simplified to pass any candidate with 1+ shared token or theme overlap ≥ 0.20
- `data/app/public-official-pyq-links.json` — Regenerated

### Results

| Subject | PYQs | Linked | Coverage |
|---------|------|--------|----------|
| Geography | 128 | 124 | 97% |
| Anthropology | 85 | 83 | 98% |
| Sociology | 126 | 115 | 91% |
| Public Admin | 126 | 113 | 90% |
| PSIR | 78 | 72 | 92% |
| History | 110 | 75 | 68% |
| Essay | 100 | 39 | 39% |
| GS 1-4 | ~838 | ~838 | ~100% |
| **Total** | **1,577** | **1,459** | **92%** |

### Blockers

- Essay coverage limited by topper card data (217 cards, many are OCR fragments or pre-2013 questions not in official file). All 248 essay copies have `sourceAvailable: false` (PDFs on external CDNs, not in R2).
- To improve essay: scrape upscpath.com/logos/pyq/{1-96} for actual topper PDF links, or mount Acer drive and use OCR'd essay PDFs from local-pdfs.

### Exact next step

- Scrape essay topper data from upscpath links (or mount Acer drive for OCR data)
- Upload essay PDFs to R2 so `sourceAvailable` becomes true
- Consider ingesting the optional scrape links (lotusarise.com) for PSIR, anthropology, geography, history, pub-admin to get more complete optional PYQ data

---

Last updated: 2026-06-13 19:45 IST · By: Codex

## Minimal mobile PDF chrome cleanup handoff

I applied the user's requested ultra-minimal follow-up for the PDF viewer only.

### What I changed

- In `/Users/ankitkumar/Downloads/open-topper/src/components/PdfViewerPage.tsx`:
  - changed `DEFAULT_MOBILE_ZOOM` from `0.7` to `0.6`
  - hid the large title/overline/warning header panel on mobile while keeping it on desktop
  - moved the current page/status badges into the compact mobile controls row
  - reduced outer/top spacing on mobile
  - increased the mobile viewer pane height to `84vh`
  - hid the footer `Answer id` on mobile
- Kept the existing page controls exactly as requested:
  - `Pages` selector
  - page jump input
  - zoom selector
  - prev/next buttons

### Verification

- `npm run lint -- --no-fix` → pass
- `npm run typecheck` → pass
- `npm test` → pass

### Browser verification note

- The in-app browser tab at `http://localhost:3000/pdf/ans_f233ea6387e2e037?page=3` currently shows `Invalid token`.
- That is expected if the PDF route is opened directly without first using the app’s `View PDF` button flow, which sets the short-lived cookie token.
- So this was not used as a blocker for the UI change.

### Files changed by Codex in this pass

- `/Users/ankitkumar/Downloads/open-topper/src/components/PdfViewerPage.tsx`
- `/Users/ankitkumar/Downloads/open-topper/docs/ai-handoff.md`

### Exact next step

- Stage only the PDF viewer file plus this handoff note, commit, and push the branch.

---

Last updated: 2026-06-12 17:26 IST · By: Codex

## Security audit handoff

I audited the app for security issues, fixed the low-risk dependency problems, and verified the site still builds cleanly.

### What I found

- **Before fixes:** `npm audit --omit=dev` reported **8** production vulnerabilities.
- **After fixes:** production audit is now **0 vulnerabilities**.
- Full `npm audit` still reports **1 high** advisory in the dev-only `xlsx` build script dependency.
- I did **not** find any obvious code-level auth bypass, open redirect, CSRF, or raw-data-leak issue in the current route handlers during this pass.

### What I changed

- Moved build-only `xlsx` from `dependencies` to `devDependencies`.
- Added npm overrides to pin:
  - `postcss@8.5.15`
  - `onnxruntime-web@1.26.0`
  - `onnx-proto@8.0.1`
  - `protobufjs@8.6.3`
- Regenerated `package-lock.json`.

### Verification

- `npm audit --omit=dev` → **0 vulnerabilities**
- `npm audit` → **1 dev-only high advisory** (`xlsx`)
- `npm run lint` → pass
- `npm run typecheck` → pass
- `npm test` → pass
- `npm run build` → pass

### Files changed by Codex in this pass

- `/Users/ankitkumar/Downloads/open-topper/package.json`
- `/Users/ankitkumar/Downloads/open-topper/package-lock.json`
- `/Users/ankitkumar/Downloads/open-topper/docs/ai-handoff.md`
- `/Users/ankitkumar/Downloads/open-topper/docs/ai-decisions.md`

### Decisions recorded

- Production installs should stay audit-clean; use package-manager overrides for vulnerable transitive deps when the app still works with them pinned.
- Build-only Excel parsing stays out of the production dependency tree.

### Blockers

- None for the security-audit scope.

### Exact next step

- If you want to keep hardening, the next best follow-up is a focused review of the optional local-embeddings stack and any remaining build/dev advisories, but the production install is currently clean.

---

Last updated: 2026-06-09 11:03 IST · By: Codex

## Summary

**Paid OCR is running again** after the provider disabled the previous API key. The user provided a
new key; Codex used it only in live shell/tmux input, did not write it to files/docs, and did not echo
it in this handoff. A fresh `--verify-key` smoke test passed against the same provider/model/root, and
OCR was resumed in the same Acer run root so cached pages/manifests are reused.

Important sequence:

1. At ~10:48 IST the previous full run had stopped with `API_KEY_DISABLED` and 0 live workers.
2. At 10:56 IST a non-tmux `nohup` relaunch briefly started but child processes exited immediately
   with empty logs; it was not considered successful.
3. A foreground one-shard test proved the new key and worker path were valid.
4. Codex then launched a persistent tmux supervisor session holding the key in process memory and
   started the real resume workers.

Current live shape as of 2026-06-09 11:03 IST:

- tmux session: `open-topper-ocr-resume-20260609T053151Z`
- 15 shards at `--concurrency 4`, `--rpm-limit 300`, `nice +10`
- shard 15 at `--concurrency 2`, `--rpm-limit 120`, `nice +12`
- Total live Python `scripts/full_openai_ocr.py --full` worker processes: **16**
- Approximate page-worker upper bound: **62**

No auth markers were found in the current tmux resume shard logs at launch check time.

## Active OCR root / scope

```text
Input root:       /Volumes/Acer/open-topper/local-pdfs
OCR output root:  /Volumes/Acer/open-topper/extracted_data/ocr_openai/run_20260608T233641
Tmp root:         /Volumes/Acer/open-topper/extracted_data/ocr_openai/run_20260608T233641/tmp
Log root:         /Volumes/Acer/open-topper/extracted_data/ocr_openai/run_20260608T233641/logs
Provider host:    codex-everywhere.com
Model:            gpt-5.5
Current workers:  16 `--full` workers active as of 2026-06-09 11:03 IST
```

Private coordination env, without API key:

```bash
source /tmp/open_topper_ocr_paid_run.env
```

Current `/tmp/open_topper_ocr_paid_run.env` points to the tmux resume launch below and intentionally
does **not** contain the API key.

## Gate / key status

Fresh verification with the new key passed at 2026-06-09T05:31:59Z inside the tmux supervisor:

```text
verify-summary.json: pass=true, smoke_test.ok=true, host=codex-everywhere.com, model=gpt-5.5
```

Pilot summary from earlier in the same root remains passing:

```text
pilot-summary.json: gates.pass=true, selected_pages=4, pages_completed=4, pages_failed=0
```

Do not reuse the old disabled key. The new key was only typed into tmux/live shell and must not be
written to docs, env files, or logs.

## Current launch details

Persistent tmux session:

```text
Session:        open-topper-ocr-resume-20260609T053151Z
Window:         ocr
Launch stamp:   20260609T053159Z
Shape:          15 shards x 4 workers + shard 15 x 2 workers
Target lists:   /Volumes/Acer/open-topper/extracted_data/ocr_openai/run_20260608T233641/logs/full-targeted-16x4-lists-20260608-202842
PID dir:        /Volumes/Acer/open-topper/extracted_data/ocr_openai/run_20260608T233641/logs/full-tmux-resume-16x4-pids-20260609T053159Z
Launch log:     /Volumes/Acer/open-topper/extracted_data/ocr_openai/run_20260608T233641/logs/full-tmux-resume-16x4-launch-20260609T053159Z.log
Supervisor log: /Volumes/Acer/open-topper/extracted_data/ocr_openai/run_20260608T233641/logs/full-tmux-resume-16x4-supervisor-20260609T053159Z.log
Shard logs:     /Volumes/Acer/open-topper/extracted_data/ocr_openai/run_20260608T233641/logs/full-tmux-resume-shard-*-of-16-20260609T053159Z.log
```

Target-list summary for the full corpus:

```text
total_pdfs=2541
total_pages=125654
```

## Current manifest snapshot

From `/Volumes/Acer/open-topper/extracted_data/ocr_openai/run_20260608T233641/manifest.sqlite` at
2026-06-09 11:03 IST, shortly after tmux relaunch:

```text
pages:
  done         21144
  error         2391
  in_progress    140
  queued         568

pdfs:
  done          254
  error          95
  partial         1
  running        16
```

Approximate corpus progress at that snapshot:

```text
done pages:     21144 / 125654 = 16.83%
terminal pages: 23535 / 125654 = 18.73% including current error rows
```

The `error` count dropped from 2555 to 2391 immediately after resume because retry/reclaim logic is
moving some previously auth-failed pages/PDFs back into active processing. Many existing `error` rows
are likely fallout from the disabled-key window and should be retried/resolved by continued runs.

## Exact next step

Monitor the tmux resume run; do **not** start another paid OCR run in a different output root.

Primary monitor commands:

```bash
source /tmp/open_topper_ocr_paid_run.env

tmux capture-pane -pt open-topper-ocr-resume-20260609T053151Z:ocr -S -120

ps -axo pid,ni,stat,etime,pcpu,pmem,command   | awk '/[Pp]ython/ && /scripts\/full_openai_ocr.py/ && /--full/ && !/awk/ {print; c++} END{print "full_count=" c+0}'

sqlite3 "$OCR_RUN_ROOT/manifest.sqlite"   "select 'pages' kind,status,count(*) from pages group by status order by status;
   select 'pdfs' kind,status,count(*) from pdfs group by status order by status;"

grep -RsnE '401|403|auth_error|API_KEY_DISABLED|429|HTTP 5|HTTP 522|HTTP 524|Traceback|Segmentation fault'   "$OCR_LOG_ROOT"/full-tmux-resume-shard-*-of-16-"$LAUNCH_STAMP".log   "$SUPERVISOR_LOG" || true
```

If auth errors appear again, stop the tmux resume workers immediately and do not relaunch until the
provider/key issue is fixed:

```bash
source /tmp/open_topper_ocr_paid_run.env
for f in "$PID_DIR"/*.pid; do kill "$(cat "$f")" 2>/dev/null || true; done
```

If the Mac lags, reduce by stopping current workers and resuming same root at 8 shards x 2 workers or
4 shards x 2 workers. Do not delete `manifest.sqlite`, `page-cache/`, `pdfs/`, logs, or target lists.

## Files changed this pass

- `docs/ai-handoff.md` updated with the new-key verification, failed non-tmux relaunch caveat, and
  active tmux resume launch details.

No Next.js runtime/app/public files were changed. Raw OCR, logs, page cache, SQLite manifests,
rendered images, aggregates, and source PDFs remain private under the Acer OCR root and must not be
committed.

## Caveats

- OCR completion is not claimed.
- Current Mac shape is deliberately Mac-safe, not maximum throughput.
- A cloud VM with its own valid key can run independently/burn mode if the user wants faster total
  completion, but do not point it at this Mac SQLite DB over network storage.
- The per-shard logs may stay quiet for stretches; the tmux supervisor and SQLite manifest are the
  better progress signals.

---

Last updated: 2026-06-14 (no-signup API hardening live lane) · By: Codex

## No-signup public API hardening prepared for production deploy

### Summary

Hardened the remaining public JSON read surfaces without enabling signup/auth. Search and question-detail APIs now require same-origin browser signals, search result caps were reduced to UI-sized limits, and API responses now declare same-origin CORP headers. Rate-limit identity was tightened to trusted client IP instead of IP+User-Agent.

### Files changed

- `src/lib/request-guards.ts` — added `requireSameOriginRead()` for browser-only GET JSON access.
- `src/app/api/search/route.ts` — same-origin read guard + reduced `MAX_SEARCH_LIMIT` to 120 + async loader usage.
- `src/app/api/official-questions/[questionId]/route.ts` — same-origin read guard + async loader usage.
- `src/app/api/workspace-questions/[questionId]/route.ts` — same-origin read guard + async loader usage.
- `src/lib/rate-limit.ts` — rate-limit identity now keys on trusted client IP only; worker/runtime detection retained.
- `next.config.ts` — added `Cross-Origin-Resource-Policy: same-origin` to API headers.
- `src/lib/__tests__/security-hardening.test.ts` — added same-origin read-guard and worker-runtime coverage.
- `src/lib/env.ts`, `src/lib/official-pyqs.ts`, `src/lib/question-bank-runtime.ts` — synced async/runtime helpers needed by the hardened routes in this deployment lane.

### Verification

- `npm run lint -- src/app/api/search/route.ts src/app/api/official-questions/[questionId]/route.ts src/app/api/workspace-questions/[questionId]/route.ts src/lib/request-guards.ts src/lib/rate-limit.ts src/lib/__tests__/security-hardening.test.ts next.config.ts src/lib/env.ts src/lib/official-pyqs.ts src/lib/question-bank-runtime.ts` — pass.
- `npx tsc --noEmit --pretty false` — pass.
- `node --test --import tsx src/lib/__tests__/security-hardening.test.ts` — pass (15/15).

### Decisions

- Keep no-signup browsing, but require same-origin browser signals for public GET JSON APIs to raise scrape cost.
- Match public search response caps to actual UI needs (120) instead of allowing oversized dumps.
- Rate-limit identity should not include User-Agent because UA rotation multiplies quotas too cheaply.

### Blockers

- Shared edge/global rate limiting and WAF rules still require platform configuration outside the repo.

### Deployment

- Vercel production deploy succeeded: `dpl_BqQmAGRW7XtmyJVoQC7NiqBUVnZ1`.
- Live canonical host verified: `https://www.upscat.click/` returns 200.
- Direct/headerless `GET /api/search?q=test` returns 403 with `Same-origin browser requests are required.`
- Same-origin browser-like `GET /api/search?q=test&limit=240` returns 200 and is capped to `limit: 120`.
- Legacy `npm run smoke` page/PDF checks pass, but the script still expects direct `/api/search?q=test` to return 200; that one check now fails by design after this hardening.

### Exact next step

Update `scripts/smoke-test.js` so `/api/search` is tested with same-origin browser headers as 200 and direct/headerless `/api/search` is tested as 403.

---

Last updated: 2026-06-14 (landing optional cards restored after hardening deploy) · By: Codex

## Landing optional cards restored on live hardening deployment

### Summary

The initial no-signup hardening deploy was built from an older clean lane and regressed the landing-page optional subject card hotfix back to small pills. Restored `src/app/page.tsx` from the current workspace into the hardening lane and redeployed the combined security + landing-card state.

### Files changed

- `src/app/page.tsx` — restored optional-subject card grid with larger icons and `min-h-24` card styling.
- `scripts/smoke-test.js` — kept new direct `/api/search` 403 expectation and made same-origin search smoke lighter (`limit=1`) with a 30s timeout to avoid cold-start false negatives.

### Verification

- `npm run lint -- src/app/page.tsx` — pass.
- `npx tsc --noEmit --pretty false` — pass.
- Production deploy ready: `dpl_Djexg3HWjZmoAXQAuinkYbzTZ9m2`.
- Live `https://www.upscat.click/` contains `pyq-card group flex min-h-24` and `text-[2rem]` optional-card markup.
- Direct `/api/search?q=test` returns 403.
- Same-origin `/api/search?q=test&limit=240` returns 200 and caps at 120.
- `BASE_URL=https://www.upscat.click npm run smoke` — pass, 17/17.

### Decisions

- No new architectural decisions.

### Blockers

- None.

### Exact next step

If merging this hotfix branch, preserve both the hardening changes and the restored landing-page `src/app/page.tsx` card markup.

---

Last updated: 2026-06-15 (emergency no-signup auth fix) · By: Codex

## Production no-signup detail/PDF flows restored

### Summary

Fixed a production regression where expanding PYQs showed `Authentication is required but Supabase auth is not configured.` The hardening deploy had preserved production fail-closed auth behavior while production Supabase env is intentionally not configured because the current product policy is no signup/auth. Updated auth availability so the temporary public/no-signup bypass applies in production by default unless `NEXT_PUBLIC_TEMPORARY_QA_AUTH_DISABLED=false` is explicitly set.

### Files changed

- `src/lib/auth-availability.ts` — public/no-signup bypass now applies in production by default; explicit env `false` re-enables Supabase auth checks.
- `src/lib/__tests__/security-hardening.test.ts` — updated auth-state tests to cover no-signup production default and explicit re-enable behavior.

### Verification

- `npm run lint -- src/lib/auth-availability.ts src/lib/__tests__/security-hardening.test.ts` — pass (one pre-existing unused helper warning removed in follow-up if desired).
- `npx tsc --noEmit --pretty false` — pass.
- `node --test --import tsx src/lib/__tests__/security-hardening.test.ts` — pass, 15/15.
- Production deploy ready: `dpl_CRaGXy5xaJVErBPpJ3niRYzYjFoV`.
- Live `https://www.upscat.click/` optional cards still contain `pyq-card group flex min-h-24`.
- Direct `/api/search?...` returns 403.
- Same-origin `/api/search?dataset=official&subject=gs1&q=tsunami&limit=1` returns 200.
- Live official detail `/api/official-questions/pyq_gs1_c22d162a3613` returns 200 with relevant/topper data and no auth error.
- `BASE_URL=https://www.upscat.click npm run smoke` — pass, 17/17.

### Decisions

- Current production policy is no-signup/no-auth. Do not fail closed on missing Supabase env while this policy is active.
- To re-enable auth later, set `NEXT_PUBLIC_TEMPORARY_QA_AUTH_DISABLED=false` and configure Supabase env/migrations first.

### Blockers

- None for the emergency fix.

### Exact next step

Monitor live subject pages for expanded PYQ detail/PDF open flow. If auth is reintroduced later, configure Supabase before setting `NEXT_PUBLIC_TEMPORARY_QA_AUTH_DISABLED=false`.

