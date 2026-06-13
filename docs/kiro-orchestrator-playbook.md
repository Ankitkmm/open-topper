# Kiro + Codex orchestration playbook

## Roles

- **Codex**: orchestrator, reviewer, release captain
- **Kiro**: implementation worker
- **Shared memory**: repo files only, especially `/Users/ankitkumar/Downloads/open-topper/docs/ai-handoff.md`

## Session model

Use tmux right now because `cmux` was not available in PATH in this environment on 2026-06-13. The layout is intentionally close to the referenced Kiro cmux workflow:

1. `captain` window — release captain shell + live handoff/mailbox watcher
2. `kiro` window — Kiro worker pane
3. `mailbox` window — edit the next Kiro task prompt
4. `git` window — integration and focused staging only

## Start

```bash
cd /Users/ankitkumar/Downloads/open-topper
bash /Users/ankitkumar/Downloads/open-topper/scripts/ai/open-agent-session.sh
tmux attach -t open-topper-ai
```

## Queue work for Kiro

```bash
bash /Users/ankitkumar/Downloads/open-topper/scripts/ai/queue-kiro-task.sh \
  "Align feedback schema end-to-end" \
  "Fix FeedbackWidget.tsx and src/lib/feedback.ts to match src/app/api/feedback/route.ts. Then run lint, typecheck, tests touching feedback if present, and update ai-handoff with exact results."
```

Then in the `kiro` window run:

```bash
kiro-cli chat --resume --agent code_supervisor --trust-all-tools
```

Paste the contents of `/Users/ankitkumar/Downloads/open-topper/docs/kiro-next-task.md`.

## Operating rhythm

1. Codex audits repo state and decides the next bounded task.
2. Codex writes the task into `docs/kiro-next-task.md`.
3. Kiro executes the task and updates `docs/ai-handoff.md`.
4. Codex reviews the result, decides whether to accept, refine, or queue another task.
5. Only the release captain stages focused files and prepares commits/PRs.

## First recommended task

Kiro’s earlier work is mostly good, but the feedback lane is inconsistent:

- `/Users/ankitkumar/Downloads/open-topper/src/components/FeedbackWidget.tsx` still sends old fields
- `/Users/ankitkumar/Downloads/open-topper/src/lib/feedback.ts` still validates old fields
- `/Users/ankitkumar/Downloads/open-topper/src/app/api/feedback/route.ts` expects the new schema

So the first queued task should be feedback schema alignment, not more planning docs.

## Notes

- Do not use `git add .`
- Keep junk/untracked folders out of commits
- Update `docs/ai-decisions.md` only for real architectural decisions
