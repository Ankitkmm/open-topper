@AGENTS.md

# Claude Code Configuration for UPSCat

## Multi-Agent Context

This project uses multiple AI tools (Kiro, Claude Code/Codex). Memory is NOT shared.
The repo and `docs/ai-*.md` files are the only shared state.

**Before every session:**
1. Read `docs/ai-context.md`, `docs/ai-tasks.md`, `docs/ai-decisions.md`, `docs/ai-handoff.md`
2. Continue from the latest handoff in `docs/ai-handoff.md`

**After meaningful work:**
- Update `docs/ai-handoff.md` with summary, files changed, decisions, blockers, exact next step
- Record architecture/security decisions in `docs/ai-decisions.md`

## Skills

- **graphify** (`~/.claude/skills/graphify/SKILL.md`) - knowledge graph builder. Trigger: `/graphify`

## Project Rules

- **Never** use `git add .` — dangerous untracked files exist at repo root
- **Never** expose raw PDF URLs, OCR text, R2/S3 URLs, or `.env.local` values
- **Never** commit: `extracted_data/`, `local-pdfs/`, `vault_merged_docs/`, `new/`, `untitled folder/`
- Stage specific files only. Small focused commits.
- This is Next.js 16 with breaking changes — read `node_modules/next/dist/docs/` before unfamiliar APIs
- Use `pdfjs-dist/legacy/build/pdf.mjs` (NOT standard build) — Safari compatibility

## Verification Commands

```bash
npm run lint          # ESLint
npm run typecheck     # tsc --noEmit
npm run test          # node --test
npm run build         # full Next.js build
npm run smoke         # production route smoke test
node scripts/check-no-public-pdf-url-leaks.js
node scripts/check-function-sizes.js
```

## Architecture Quick Reference

- **Stack:** Next.js 16, React 19, TypeScript 5, Tailwind v4, Supabase SSR
- **Data:** Postgres + pgvector, R2/S3 for PDFs
- **Auth:** Currently QA-disabled (`TEMPORARY_QA_AUTH_DISABLED = true`)
- **PDF flow:** client → answerId → `/api/answer-source` → R2 (never expose direct URLs)
- **Hot paths:** `/`, `/browse`, `/gs1-4`, `/essay`, `/optional/*`, `/api/search`, `/pdf/[answerId]`
