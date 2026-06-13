# AI Operations

> How multiple AI agents collaborate on this repository without shared memory.

## Multi-Agent Coordination Protocol

### Agents

- **Kiro** — High-throughput implementation worker. Uses specs + hooks, works in the Kiro IDE. Best for focused feature tasks, property-based testing, and spec-driven development.
- **Claude Code (Codex)** — Architect, orchestrator, release captain. Also does implementation via CLI. Handles security audits, emergency fixes, OCR supervision, and cross-cutting changes.
- **Graphify** — Knowledge graph skill for Claude Code. Maintains persistent AST-based project understanding (862 nodes, 2258 edges, 40 communities from `src/`). Local only — output in `graphify-out/` is never committed.

### Handoff Protocol

1. **Before work:** Read `docs/ai-context.md`, `docs/ai-tasks.md`, `docs/ai-decisions.md`, `docs/ai-handoff.md`. Continue from the latest handoff.
2. **During work:** One agent per file. Small, focused changes. Do not rewrite unrelated code.
3. **After work:** Update `docs/ai-handoff.md` with:
   - Summary of what was done
   - Files changed
   - Decisions made
   - Blockers encountered
   - Exact next step for the next agent
4. **If architecture decision:** Record in `docs/ai-decisions.md` with rationale and date.
5. **Sync via Git:** commit → push → other agent pulls. Git is the only synchronization layer.

### Memory Sharing

- Memory is **NOT** shared between agents. Each session starts fresh.
- `docs/ai-*.md` files are the only shared state between agents.
- Git is the synchronization layer — there is no other coordination mechanism.
- Always pull latest before starting work. Always commit handoff updates before switching tools.

### Coordination Files

| File | Purpose |
|------|---------|
| `docs/ai-context.md` | Project overview, tech stack, constraints — read first every session |
| `docs/ai-tasks.md` | Current task backlog and priorities |
| `docs/ai-decisions.md` | Architectural and security decisions with rationale |
| `docs/ai-handoff.md` | Latest work summary and exact next step |
| `AGENTS.md` | Agent rules embedded at repo root (read by all tools automatically) |

---

## Git Safety Rules

### Never Do

- `git add .` — dangerous; untracked private files, media, and junk folders sit at repo root
- `git push --force` — destructive, irreversible history rewrite
- Stage files in `new/`, `untitled folder/`, `sociology.md/`, `scrap_essay.md/`, `optional scraping.md/`
- Stage `extracted_data/`, `local-pdfs/`, `vault_merged_docs/`, `.env.local`
- Stage `transit_station_collector.py` — unrelated script
- Commit large binary/media files (PDFs, videos, images at repo root)

### Always Do

- Stage specific files by path: `git add path/to/file.ts`
- Review `git status --short` before every commit
- Use descriptive commit messages (imperative mood, concise)
- Push to feature branches, not directly to main (except emergency hotfixes)
- Small, focused commits — one logical change per commit
- Pull latest and read `docs/ai-handoff.md` before starting any work

---

## Never-Commit Paths

These paths must never be staged, committed, or exposed publicly:

| Path | Reason |
|------|--------|
| `.env.local` | Secrets (API keys, Supabase credentials) |
| `extracted_data/` | Private OCR outputs from paid processing |
| `local-pdfs/` | Private PDF corpus (Acer SSD source) |
| `vault_merged_docs/` | Private vault data |
| `data/app/answer-sources.json` | Private answer-to-PDF mappings |
| `data/app/pdf-map.json` | Private PDF location mappings |
| `data/app/pdf-r2-map.json` | Private R2 storage mappings |
| `data/mappings/` | Private ingestion mappings |
| `new/` | Unrelated junk folder |
| `untitled folder/` | Unrelated junk folder |
| `*.xlsx` at repo root | Source data spreadsheets, not code |
| `*.pdf` at repo root | Source PDFs, not code |
| `transit_station_collector.py` | Unrelated script |
| `graphify-out/` | Local knowledge graph output |

The `.gitignore` enforces most of these, but agents must still avoid `git add .` because some paths rely on agent discipline rather than gitignore rules.

---

## Worktree Strategy

For parallel development lanes, use Git worktrees so multiple agents or focus areas can work simultaneously without conflicts:

```bash
# Create worktree for a specific lane
git worktree add /path/to/worktree-name -b branch-name origin/main

# Example lanes:
# kiro/release-stabilize    — production fixes and stabilization
# kiro/data-optional-pyq    — data pipeline and optional PYQ work
# kiro/api-feedback-pdf     — API routes, feedback, and PDF security
# kiro/platform-cloudflare  — platform migration prep (Cloudflare Workers)
```

Rules for worktrees:
- Each worktree operates on its own branch — no cross-worktree file editing
- The main checkout remains the integration point
- Merge back to main via PR after verification passes
- Clean up worktrees after merging: `git worktree remove /path/to/worktree-name`

---

## Daily Verification

Run before any commit to ensure nothing is broken:

```bash
npm run lint
npx tsc --noEmit
npm run test
node scripts/check-no-public-pdf-url-leaks.js
npm run build
node scripts/check-function-sizes.js
```

For production deployments, also run the smoke test:

```bash
BASE_URL=https://upscat.click npm run smoke
```

---

## Weekly Data Review

- Run `npm run build-pyqs` and check coverage numbers (target: 90%+ linked PYQs)
- Review feedback reports: `scripts/admin-feedback-queries.sql`
- Check Vercel function sizes and invocation counts
- Review any new user-reported issues
- Monitor OCR progress if active (check `manifest.sqlite` status counts)

---

## Release Captain Checklist

Before any production deploy:

1. All CI checks pass on the PR
2. `docs/ai-handoff.md` updated with what shipped
3. No private files staged (`git status --short` review)
4. Smoke test passes: `BASE_URL=https://upscat.click npm run smoke`
5. Manual PDF flow verification in Safari (legacy build compatibility)
6. Deploy via Vercel (auto on merge to main)
7. Post-deploy smoke test against production URL

---

## Issue Severity Categories

| Severity | Examples | Response |
|----------|----------|----------|
| **P0 Critical** | Site down, PDF delivery broken, security breach | Hotfix immediately |
| **P1 High** | Major feature broken (search, optional pages), data leak risk | Fix within hours |
| **P2 Medium** | Minor UI issues, non-critical page errors, performance degradation | Fix within days |
| **P3 Low** | Documentation gaps, minor DX improvements, cosmetic issues | Backlog |

---

## Reference

- `AGENTS.md` — Agent rules (auto-read by all AI tools)
- `.kiro/steering/` — Kiro-specific steering files (tech, security, structure, product, task-priority)
- `CLAUDE.md` — Claude Code-specific rules and Graphify skill reference
- `docs/deployment-runbook.md` — Full deployment procedures
- `docs/cloudflare-migration.md` — Platform migration blockers and plan
