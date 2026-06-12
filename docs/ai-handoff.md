# Latest handoff

> The single most important file. The next agent (any tool) continues from here.
> Overwrite the sections below after each meaningful chunk of work.

Last updated: 2026-06-13 19:15 IST · By: Codex

## Preview deploy-fix handoff

I fixed the preview deployment failure that was blocking Vercel builds after the mobile/PDF work.

### Root cause

`npm run build` runs `scripts/sync-pdf-runtime-data.js` first. That script was treating **preview** builds as production-like because `NODE_ENV=production` is set during Vercel builds, so the default R2 preview host (`pub-3476e7cc4efd44b58da659c67aad1348.r2.dev`) was rejected unless explicitly allowlisted via deploy env.

In practice, this caused preview deploys to fail with:

- `data/app/answer-sources.json.<answerId>.url must be an R2 URL`

### What I changed

- In `/Users/ankitkumar/Downloads/open-topper/scripts/sync-pdf-runtime-data.js`
  - changed preview detection so `VERCEL_ENV=preview` / `NEXT_PUBLIC_VERCEL_ENV=preview` are **not** treated as strict production-like validation mode.
- In `/Users/ankitkumar/Downloads/open-topper/src/lib/public-env.ts`
  - matched the same preview-vs-production logic for runtime env classification.
- In `/Users/ankitkumar/Downloads/open-topper/src/lib/__tests__/security-hardening.test.ts`
  - added a regression test proving Vercel preview remains fail-open for the known default R2 preview host.

This keeps **true production** fail-closed, while making **preview** builds succeed without requiring extra private env setup for the default preview host.

### Verification

Passed locally:

- `NODE_ENV=production VERCEL_ENV=preview npm run build`
- `npm run lint -- --no-fix`
- `npm run test`
- `npm run typecheck`

Build output confirmed:
- runtime PDF sync passed
- public/client leak checks passed
- Next production build completed successfully

### Files changed by Codex in this pass

- `/Users/ankitkumar/Downloads/open-topper/scripts/sync-pdf-runtime-data.js`
- `/Users/ankitkumar/Downloads/open-topper/src/lib/public-env.ts`
- `/Users/ankitkumar/Downloads/open-topper/src/lib/__tests__/security-hardening.test.ts`
- `/Users/ankitkumar/Downloads/open-topper/docs/ai-handoff.md`

### Important notes

- This fix is intentionally scoped to **preview deploy success**.
- True production still expects explicit correct `R2_PUBLIC_URL` / `R2_ALLOWED_PUBLIC_HOSTS` config.
- There are still many unrelated modified/untracked files in the repo. Do not use `git add .`.

### Exact next step

- Stage only the preview deploy-fix files, commit, and push. Then redeploy the preview branch in Vercel.

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
