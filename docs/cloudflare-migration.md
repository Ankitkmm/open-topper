# Cloudflare Migration

> Superseded implementation note: the active target is **Cloudflare Workers via `@opennextjs/cloudflare`**, not legacy `@cloudflare/next-on-pages`.

Use these current docs:

- `docs/cloudflare-opennext-runbook.md` — operator commands for R2 buckets, runtime-data upload, preview, deploy, and smoke tests.
- `docs/migration-execution-checklist.md` — current migration status, remaining blockers, and Supabase Mumbai cutover steps.
- `docs/cloudflare-audit-findings.md` — historical blocker audit; treat stack/tooling names there as background if they conflict with the OpenNext runbook.

Current direction:

- Build with `@opennextjs/cloudflare` and `wrangler.jsonc`.
- Keep large JSON runtime datasets in private R2 via `UPSCAT_RUNTIME_DATA`; do not bundle them into Worker code.
- Keep Vercel as rollback until Cloudflare preview passes all smoke tests.
- Use fresh Supabase Mumbai project for auth/progress/feedback and keep the old project for at least 7 days after cutover.
