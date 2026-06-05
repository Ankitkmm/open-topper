<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
<!-- BEGIN:multi-agent-protocol -->
# Multi-agent operating protocol

This repo is worked on by multiple AI tools (Kiro, Claude Code, Codex). Memory is NOT shared
across tools — the repo and the `docs/ai-*.md` files are the only shared state.

Before doing work:

1. Read `docs/ai-context.md`, `docs/ai-tasks.md`, `docs/ai-decisions.md`, `docs/ai-handoff.md`.
2. Continue from the latest handoff in `docs/ai-handoff.md`.
3. After meaningful work, update `docs/ai-handoff.md` with: summary, files changed, decisions,
   blockers, and the exact next step. Record architectural decisions in `docs/ai-decisions.md`.
4. Do not assume memory is shared across tools.

Conflict avoidance:

- Only one agent edits a given file at a time.
- Use small, focused commits. Update `docs/ai-handoff.md` before switching tools.
- Git is the synchronization layer: pull latest → read handoff → work → update handoff → commit.
<!-- END:multi-agent-protocol -->
