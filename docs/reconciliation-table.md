# Reconciliation Table

Comparison: `codex/release-hardening-ocr-2026-06-08` vs `origin/main`

Generated: 2026-06-13 15:30:28 UTC

---

## Part 1: Commits Unique to Dirty Branch

| Hash | Summary | Files Changed | Verdict |
|------|---------|---------------|---------|
| 92ed0d2 | Set desktop PDF default zoom to 100 percent | 1 files: src/components/PdfViewerPage.tsx | needs-review |
| f01f8b0 | Tighten mobile PDF chrome and default zoom | 2 files: docs/ai-handoff.md,src/components/PdfViewerPage.tsx | needs-review |
| e9f5dbe | Allow preview deploys to validate default R2 runtime data | 4 files: docs/ai-handoff.md,scripts/sync-pdf-runtime-data.js,src/lib/__tests__/security-hardening.test.ts,src/lib/public-env.ts | needs-review |
| 104fce3 | Restore stable PDF viewer with mobile sizing fixes | 5 files: docs/ai-handoff.md,src/app/api/search/route.ts,src/components/OfficialSubjectWorkspace.tsx,src/components/PdfViewerPage.tsx,src/components/StudyNav.tsx | needs-review |
| ce62734 | Improve mobile PDF UX and answer-source throttling | 11 files: .env.example,docs/ai-decisions.md,docs/ai-handoff.md,docs/ai-tasks.md,src/app/api/answer-source/route.ts ... | needs-review |
| 24fafd5 | harden security, PYQ data quality, topper names, and study UI | 40 files: data/app/public-official-pyq-links.json,data/app/workspace-index.json,data/curation/topper-name-overrides.json,docs/ai-decisions.md,docs/ai-handoff.md ... | needs-review |
| b4cd049 | Speed up local OCR inventory startup | 1 files: scripts/full_openai_ocr.py | needs-review |
| a73a32d | Use validated Supabase public config state | 3 files: src/utils/supabase/client.ts,src/utils/supabase/middleware.ts,src/utils/supabase/server.ts | needs-review |
| 4715a57 | Extract essay prompt normalization for official PYQ matching | 2 files: src/lib/essay-normalization.ts,src/lib/official-pyqs.ts | needs-review |
| f778912 | Harden PDF source URL validation and filenames | 3 files: scripts/sync-pdf-runtime-data.js,src/lib/answer-sources.ts,src/lib/env.ts | needs-review |
| 14c61d8 | Fix local-only OCR guards and model verification | 4 files: docs/ai-handoff.md,docs/ai-tasks.md,docs/ocr-task-brief.md,scripts/full_openai_ocr.py | needs-review |
| b56623b | Harden PDF access, fix official PYQ links, and add guarded OCR pipeline | 62 files: .gitignore,data/app/answer-sources.json,data/app/public-official-pyq-links.json,data/app/public-pyqs.json,data/app/topper-answer-canonical.json ... | needs-review |

---

## Part 2: File-Level Differences (Dirty Tree vs origin/main)

This section shows all files that differ between the current working tree
(on branch `codex/release-hardening-ocr-2026-06-08`) and `origin/main`, including uncommitted changes.

| Status | File Path | Verdict |
|--------|-----------|---------|
| Modified | .env.example | needs-review |
| Modified | .gitignore | needs-review |
| Modified | Dockerfile | needs-review |
| Modified | PYQS/UPSC ESSAYS PYQS.md | needs-review |
| Modified | README.md | needs-review |
| Modified | data/app/answer-sources.json | needs-review |
| Modified | data/app/public-official-pyq-links.json | needs-review |
| Modified | data/app/public-pyqs.json | needs-review |
| Modified | data/app/topper-answer-canonical.json | needs-review |
| Modified | data/app/workspace-index.json | needs-review |
| Added | data/curation/topper-name-overrides.json | needs-review |
| Modified | data/pdf-runtime/answer-sources.json | needs-review |
| Modified | docker-compose.yml | needs-review |
| Modified | docs/ai-context.md | needs-review |
| Modified | docs/ai-decisions.md | needs-review |
| Modified | docs/ai-handoff.md | needs-review |
| Modified | docs/ai-tasks.md | needs-review |
| Added | docs/ocr-task-brief.md | needs-review |
| Modified | eslint.config.mjs | needs-review |
| Modified | next.config.ts | needs-review |
| Modified | package-lock.json | needs-review |
| Modified | package.json | needs-review |
| Modified | public/robots.txt | needs-review |
| Added | scripts/audit-topper-names.js | needs-review |
| Modified | scripts/build-mappings.js | needs-review |
| Modified | scripts/build-official-pyq-links.ts | needs-review |
| Modified | scripts/build-pyq-app-data.js | needs-review |
| Added | scripts/check-no-public-pdf-url-leaks.js | needs-review |
| Added | scripts/check-official-pyq-link-health.js | needs-review |
| Added | scripts/discover_topper_pdfs.py | needs-review |
| Added | scripts/export_ocr_records.py | needs-review |
| Added | scripts/full_openai_ocr.py | needs-review |
| Modified | scripts/sync-pdf-runtime-data.js | needs-review |
| Modified | src/app/about/page.tsx | needs-review |
| Modified | src/app/account/page.tsx | needs-review |
| Modified | src/app/api/answer-source/[answerId]/route.ts | needs-review |
| Modified | src/app/api/answer-source/route.ts | needs-review |
| Modified | src/app/api/auth/login/route.ts | needs-review |
| Modified | src/app/api/auth/logout/route.ts | needs-review |
| Modified | src/app/api/auth/register/route.ts | needs-review |
| Deleted | src/app/api/feedback/route.ts | needs-review |
| Modified | src/app/api/official-questions/[questionId]/route.ts | needs-review |
| Modified | src/app/api/progress/route.ts | needs-review |
| Modified | src/app/api/search/route.ts | needs-review |
| Modified | src/app/api/workspace-questions/[questionId]/route.ts | needs-review |
| Modified | src/app/globals.css | needs-review |
| Modified | src/app/layout.tsx | needs-review |
| Modified | src/app/optional/anthropology/page.tsx | needs-review |
| Modified | src/app/optional/geography/page.tsx | needs-review |
| Modified | src/app/optional/history/page.tsx | needs-review |
| Modified | src/app/optional/psir/page.tsx | needs-review |
| Modified | src/app/optional/public-administration/page.tsx | needs-review |
| Modified | src/app/optional/sociology/page.tsx | needs-review |
| Modified | src/app/page.tsx | needs-review |
| Modified | src/app/pdf/[answerId]/page.tsx | needs-review |
| Modified | src/components/AppShell.tsx | needs-review |
| Modified | src/components/BrowsePageClient.tsx | needs-review |
| Deleted | src/components/FeedbackWidget.tsx | needs-review |
| Modified | src/components/OfficialQuestionCards.tsx | needs-review |
| Modified | src/components/OfficialSubjectPageClient.tsx | needs-review |
| Modified | src/components/OfficialSubjectWorkspace.tsx | needs-review |
| Modified | src/components/QuestionCards.tsx | needs-review |
| Modified | src/components/StudyNav.tsx | needs-review |
| Modified | src/components/SubjectWorkspace.tsx | needs-review |
| Modified | src/components/auth/AccountPanel.tsx | needs-review |
| Modified | src/components/auth/AuthControls.tsx | needs-review |
| Deleted | src/lib/__tests__/feedback-route.test.ts | needs-review |
| Added | src/lib/__tests__/official-pyqs-boundaries.test.ts | needs-review |
| Modified | src/lib/__tests__/official-pyqs-ranking.test.ts | needs-review |
| Added | src/lib/__tests__/public-boundary.test.ts | needs-review |
| Added | src/lib/__tests__/security-hardening.test.ts | needs-review |
| Added | src/lib/__tests__/topper-names.test.ts | needs-review |
| Modified | src/lib/answer-sources.ts | needs-review |
| Modified | src/lib/auth-availability.ts | needs-review |
| Modified | src/lib/env.ts | needs-review |
| Added | src/lib/essay-normalization.ts | needs-review |
| Modified | src/lib/official-pyqs.ts | needs-review |
| Modified | src/lib/pdf-access.ts | needs-review |
| Added | src/lib/public-env.ts | needs-review |
| Modified | src/lib/public-records.ts | needs-review |
| Modified | src/lib/question-bank-runtime.ts | needs-review |
| Modified | src/lib/rate-limit.ts | needs-review |
| Added | src/lib/request-guards.ts | needs-review |
| Modified | src/lib/session-access.ts | needs-review |
| Modified | src/lib/shell-search.ts | needs-review |
| Modified | src/lib/static-shell-data.ts | needs-review |
| Added | src/lib/topper-names.ts | needs-review |
| Modified | src/utils/supabase/client.ts | needs-review |
| Modified | src/utils/supabase/middleware.ts | needs-review |
| Modified | src/utils/supabase/server.ts | needs-review |
| Untracked | PYQS/optional/anthropology.md | needs-review |
| Untracked | PYQS/optional/geography.md | needs-review |
| Untracked | PYQS/optional/history.md | needs-review |
| Untracked | PYQS/optional/psir.md | needs-review |
| Untracked | PYQS/optional/public-administration.md | needs-review |
| Untracked | PYQS/optional/sociology.md | needs-review |
| Untracked | docs/cloudflare-audit-findings.md | needs-review |
| Untracked | docs/cloudflare-migration.md | needs-review |
| Untracked | docs/deployment-runbook.md | needs-review |
| Untracked | docs/reconciliation-table.md | needs-review |
| Untracked | "how does one do this, Based on the video transcript, the cre\342\200\246.md" | discard |
| Untracked | new/auth.json | discard |
| Untracked | new/config.toml | discard |
| Untracked | new/goals_1.sqlite | discard |
| Untracked | new/history.jsonl | discard |
| Untracked | new/installation_id | discard |
| Untracked | new/log/codex-login.log | discard |
| Untracked | new/logs_2.sqlite | discard |
| Untracked | new/logs_2.sqlite-shm | discard |
| Untracked | new/logs_2.sqlite-wal | discard |
| Untracked | new/memories_1.sqlite | discard |
| Untracked | new/sessions/2026/06/09/rollout-2026-06-09T11-24-31-019eaaf2-5f3c-79c3-83ab-81407282d7e8.jsonl | discard |
| Untracked | new/sessions/2026/06/09/rollout-2026-06-09T11-36-54-019eaafd-b5c9-7742-a065-ed303f0314ef.jsonl | discard |
| Untracked | new/skills/.system/.codex-system-skills.marker | discard |
| Untracked | new/skills/.system/imagegen/LICENSE.txt | discard |
| Untracked | new/skills/.system/imagegen/SKILL.md | discard |
| Untracked | new/skills/.system/imagegen/agents/openai.yaml | discard |
| Untracked | new/skills/.system/imagegen/assets/imagegen-small.svg | discard |
| Untracked | new/skills/.system/imagegen/assets/imagegen.png | discard |
| Untracked | new/skills/.system/imagegen/references/cli.md | discard |
| Untracked | new/skills/.system/imagegen/references/codex-network.md | discard |
| Untracked | new/skills/.system/imagegen/references/image-api.md | discard |
| Untracked | new/skills/.system/imagegen/references/prompting.md | discard |
| Untracked | new/skills/.system/imagegen/references/sample-prompts.md | discard |
| Untracked | new/skills/.system/imagegen/scripts/image_gen.py | discard |
| Untracked | new/skills/.system/imagegen/scripts/remove_chroma_key.py | discard |
| Untracked | new/skills/.system/openai-docs/LICENSE.txt | discard |
| Untracked | new/skills/.system/openai-docs/SKILL.md | discard |
| Untracked | new/skills/.system/openai-docs/agents/openai.yaml | discard |
| Untracked | new/skills/.system/openai-docs/assets/openai-small.svg | discard |
| Untracked | new/skills/.system/openai-docs/assets/openai.png | discard |
| Untracked | new/skills/.system/openai-docs/references/latest-model.md | discard |
| Untracked | new/skills/.system/openai-docs/references/prompting-guide.md | discard |
| Untracked | new/skills/.system/openai-docs/references/upgrade-guide.md | discard |
| Untracked | new/skills/.system/openai-docs/scripts/fetch-codex-manual.mjs | discard |
| Untracked | new/skills/.system/openai-docs/scripts/resolve-latest-model-info.js | discard |
| Untracked | new/skills/.system/plugin-creator/SKILL.md | discard |
| Untracked | new/skills/.system/plugin-creator/agents/openai.yaml | discard |
| Untracked | new/skills/.system/plugin-creator/assets/plugin-creator-small.svg | discard |
| Untracked | new/skills/.system/plugin-creator/assets/plugin-creator.png | discard |
| Untracked | new/skills/.system/plugin-creator/references/installing-and-updating.md | discard |
| Untracked | new/skills/.system/plugin-creator/references/plugin-json-spec.md | discard |
| Untracked | new/skills/.system/plugin-creator/scripts/create_basic_plugin.py | discard |
| Untracked | new/skills/.system/plugin-creator/scripts/read_marketplace_name.py | discard |
| Untracked | new/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py | discard |
| Untracked | new/skills/.system/plugin-creator/scripts/validate_plugin.py | discard |
| Untracked | new/skills/.system/skill-creator/SKILL.md | discard |
| Untracked | new/skills/.system/skill-creator/agents/openai.yaml | discard |
| Untracked | new/skills/.system/skill-creator/assets/skill-creator-small.svg | discard |
| Untracked | new/skills/.system/skill-creator/assets/skill-creator.png | discard |
| Untracked | new/skills/.system/skill-creator/license.txt | discard |
| Untracked | new/skills/.system/skill-creator/references/openai_yaml.md | discard |
| Untracked | new/skills/.system/skill-creator/scripts/generate_openai_yaml.py | discard |
| Untracked | new/skills/.system/skill-creator/scripts/init_skill.py | discard |
| Untracked | new/skills/.system/skill-creator/scripts/quick_validate.py | discard |
| Untracked | new/skills/.system/skill-installer/LICENSE.txt | discard |
| Untracked | new/skills/.system/skill-installer/SKILL.md | discard |
| Untracked | new/skills/.system/skill-installer/agents/openai.yaml | discard |
| Untracked | new/skills/.system/skill-installer/assets/skill-installer-small.svg | discard |
| Untracked | new/skills/.system/skill-installer/assets/skill-installer.png | discard |
| Untracked | new/skills/.system/skill-installer/scripts/github_utils.py | discard |
| Untracked | new/skills/.system/skill-installer/scripts/install-skill-from-github.py | discard |
| Untracked | new/skills/.system/skill-installer/scripts/list-skills.py | discard |
| Untracked | new/state_5.sqlite | discard |
| Untracked | new/state_5.sqlite-shm | discard |
| Untracked | new/state_5.sqlite-wal | discard |
| Untracked | new/tmp/arg0/codex-arg0cDuyvE/.lock | discard |
| Untracked | new/tmp/arg0/codex-arg0cDuyvE/apply_patch.bat | discard |
| Untracked | new/tmp/arg0/codex-arg0cDuyvE/applypatch.bat | discard |
| Untracked | new/version.json | discard |
| Untracked | "optional scraping.md/Scrape this link for psir pyqs, httpslotusarise.comoptionalupsc\342\200\246.md" | discard |
| Untracked | scrap_essay.md/Attachments/852D0A6D-2622-4FD5-8AB3-E414F64DAE1D.png | discard |
| Untracked | scrap_essay.md/Attachments/FD300F10-6098-423A-9257-79451EC375B7.png | discard |
| Untracked | "scrap_essay.md/Scrape this link for psir pyqs, httpslotusarise.comoptionalupsc\342\200\246.md" | discard |
| Untracked | scripts/reconcile-branch.sh | needs-review |
| Untracked | sociology.md/Attachments/7C90F15D-94ED-4AD8-BCC2-782D387D58E2.webp | discard |
| Untracked | sociology.md/Attachments/91FEAC11-41E8-48B1-9152-68158E44C4F1.png | discard |
| Untracked | sociology.md/Attachments/C29AABB2-4D3E-4071-B4AB-04CFB2C19D0C.png | discard |
| Untracked | sociology.md/UPSC SOCIOLOGY PYQ.md | discard |
| Untracked | src/app/api/feedback/route.ts | needs-review |
| Untracked | src/components/FeedbackWidget.tsx | needs-review |
| Untracked | src/lib/__tests__/optional-pyq-parsing.test.ts | needs-review |
| Untracked | src/lib/feedback.ts | needs-review |
| Untracked | transit_station_collector.py | discard |
| Untracked | untitled folder/auth.json | discard |
| Untracked | untitled folder/config.toml | discard |
| Untracked | untitled folder/goals_1.sqlite | discard |
| Untracked | untitled folder/history.jsonl | discard |
| Untracked | untitled folder/installation_id | discard |
| Untracked | untitled folder/log/codex-login.log | discard |
| Untracked | untitled folder/logs_2.sqlite | discard |
| Untracked | untitled folder/logs_2.sqlite-shm | discard |
| Untracked | untitled folder/logs_2.sqlite-wal | discard |
| Untracked | untitled folder/memories_1.sqlite | discard |
| Untracked | untitled folder/sessions/2026/06/09/rollout-2026-06-09T11-24-31-019eaaf2-5f3c-79c3-83ab-81407282d7e8.jsonl | discard |
| Untracked | untitled folder/sessions/2026/06/09/rollout-2026-06-09T11-36-54-019eaafd-b5c9-7742-a065-ed303f0314ef.jsonl | discard |
| Untracked | untitled folder/skills/.system/.codex-system-skills.marker | discard |
| Untracked | untitled folder/skills/.system/imagegen/LICENSE.txt | discard |
| Untracked | untitled folder/skills/.system/imagegen/SKILL.md | discard |
| Untracked | untitled folder/skills/.system/imagegen/agents/openai.yaml | discard |
| Untracked | untitled folder/skills/.system/imagegen/assets/imagegen-small.svg | discard |
| Untracked | untitled folder/skills/.system/imagegen/assets/imagegen.png | discard |
| Untracked | untitled folder/skills/.system/imagegen/references/cli.md | discard |
| Untracked | untitled folder/skills/.system/imagegen/references/codex-network.md | discard |
| Untracked | untitled folder/skills/.system/imagegen/references/image-api.md | discard |
| Untracked | untitled folder/skills/.system/imagegen/references/prompting.md | discard |
| Untracked | untitled folder/skills/.system/imagegen/references/sample-prompts.md | discard |
| Untracked | untitled folder/skills/.system/imagegen/scripts/image_gen.py | discard |
| Untracked | untitled folder/skills/.system/imagegen/scripts/remove_chroma_key.py | discard |
| Untracked | untitled folder/skills/.system/openai-docs/LICENSE.txt | discard |
| Untracked | untitled folder/skills/.system/openai-docs/SKILL.md | discard |
| Untracked | untitled folder/skills/.system/openai-docs/agents/openai.yaml | discard |
| Untracked | untitled folder/skills/.system/openai-docs/assets/openai-small.svg | discard |
| Untracked | untitled folder/skills/.system/openai-docs/assets/openai.png | discard |
| Untracked | untitled folder/skills/.system/openai-docs/references/latest-model.md | discard |
| Untracked | untitled folder/skills/.system/openai-docs/references/prompting-guide.md | discard |
| Untracked | untitled folder/skills/.system/openai-docs/references/upgrade-guide.md | discard |
| Untracked | untitled folder/skills/.system/openai-docs/scripts/fetch-codex-manual.mjs | discard |
| Untracked | untitled folder/skills/.system/openai-docs/scripts/resolve-latest-model-info.js | discard |
| Untracked | untitled folder/skills/.system/plugin-creator/SKILL.md | discard |
| Untracked | untitled folder/skills/.system/plugin-creator/agents/openai.yaml | discard |
| Untracked | untitled folder/skills/.system/plugin-creator/assets/plugin-creator-small.svg | discard |
| Untracked | untitled folder/skills/.system/plugin-creator/assets/plugin-creator.png | discard |
| Untracked | untitled folder/skills/.system/plugin-creator/references/installing-and-updating.md | discard |
| Untracked | untitled folder/skills/.system/plugin-creator/references/plugin-json-spec.md | discard |
| Untracked | untitled folder/skills/.system/plugin-creator/scripts/create_basic_plugin.py | discard |
| Untracked | untitled folder/skills/.system/plugin-creator/scripts/read_marketplace_name.py | discard |
| Untracked | untitled folder/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py | discard |
| Untracked | untitled folder/skills/.system/plugin-creator/scripts/validate_plugin.py | discard |
| Untracked | untitled folder/skills/.system/skill-creator/SKILL.md | discard |
| Untracked | untitled folder/skills/.system/skill-creator/agents/openai.yaml | discard |
| Untracked | untitled folder/skills/.system/skill-creator/assets/skill-creator-small.svg | discard |
| Untracked | untitled folder/skills/.system/skill-creator/assets/skill-creator.png | discard |
| Untracked | untitled folder/skills/.system/skill-creator/license.txt | discard |
| Untracked | untitled folder/skills/.system/skill-creator/references/openai_yaml.md | discard |
| Untracked | untitled folder/skills/.system/skill-creator/scripts/generate_openai_yaml.py | discard |
| Untracked | untitled folder/skills/.system/skill-creator/scripts/init_skill.py | discard |
| Untracked | untitled folder/skills/.system/skill-creator/scripts/quick_validate.py | discard |
| Untracked | untitled folder/skills/.system/skill-installer/LICENSE.txt | discard |
| Untracked | untitled folder/skills/.system/skill-installer/SKILL.md | discard |
| Untracked | untitled folder/skills/.system/skill-installer/agents/openai.yaml | discard |
| Untracked | untitled folder/skills/.system/skill-installer/assets/skill-installer-small.svg | discard |
| Untracked | untitled folder/skills/.system/skill-installer/assets/skill-installer.png | discard |
| Untracked | untitled folder/skills/.system/skill-installer/scripts/github_utils.py | discard |
| Untracked | untitled folder/skills/.system/skill-installer/scripts/install-skill-from-github.py | discard |
| Untracked | untitled folder/skills/.system/skill-installer/scripts/list-skills.py | discard |
| Untracked | untitled folder/state_5.sqlite | discard |
| Untracked | untitled folder/state_5.sqlite-shm | discard |
| Untracked | untitled folder/state_5.sqlite-wal | discard |
| Untracked | untitled folder/tmp/arg0/codex-arg0cDuyvE/.lock | discard |
| Untracked | untitled folder/tmp/arg0/codex-arg0cDuyvE/apply_patch.bat | discard |
| Untracked | untitled folder/tmp/arg0/codex-arg0cDuyvE/applypatch.bat | discard |
| Untracked | untitled folder/version.json | discard |

---

## Summary

- **Commits unique to dirty branch:** 12
- **Files differing from origin/main:** 253
- **Verdict key:**
  - `discard` — junk, experimental, or dangerous files (new/, untitled folder/, attachments, scraps)
  - `needs-review` — potentially valuable changes that require manual review before cherry-pick

## Next Steps

1. Review items marked `needs-review` and update verdict to `cherry-pick` or `discard`
2. Run `scripts/verify-cherry-picks.sh` to verify commits marked for cherry-pick
3. Create clean baseline branch with verified commits only
