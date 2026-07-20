---
name: suxiaoqiang-cli
description: >
  Use suxiaoqiang-cli (sxq) to sync, edit, preview and release Superun vibe coding projects
  from the terminal. Use when the user asks to pull/push Superun project code, publish a
  preview build, deploy/release a Superun app, check release status, or mentions "sxq",
  "suxiaoqiang-cli", or a Superun sessionId. 当用户要求同步/推送 Superun 项目代码、发布预览、
  上线 Superun 应用、查看发布状态,或提到 sxq / suxiaoqiang-cli 时使用。
---

# suxiaoqiang-cli (sxq)

`sxq` syncs a Superun project (identified by a `sessionId`) with a local directory, and drives
the publish/release pipeline. All commands run non-interactively when needed — **always prefer
the non-interactive forms below**; interactive prompts hang in agent environments (the CLI
fails fast on non-TTY with a hint, but don't rely on prompts).

## Prerequisites

- `sxq login` requires a browser and must be done by the user. If any command reports
  "Not logged in / 未登录" or "credential expired / 凭证无效", ask the user to run `sxq login`
  themselves — do not attempt it. Exception: if the user hands you a token, run
  `sxq login --token <token>` (it validates the token and keeps the previous credential on
  failure). Never ask the user to paste a token proactively.
- A project directory is bound via `.sxq/config.json` (created by `sxq link`). Check for it
  before assuming a directory is linked.

## Core workflow

```bash
sxq link <sessionId> -y     # bind current dir to a project (verifies ownership; needs login)
sxq pull                    # pull remote files (incremental, three-way merge)
# ... edit files locally ...
sxq push -m "<summary>"     # push local changes (pulls first; aborts on conflict)
sxq publish                 # debug publish (preview build); polls until done, prints preview URL
sxq deploy -y -m "<log>"    # release to production; polls until live, prints live URL
sxq deploy --status         # read-only: pending/published versions + live URL
```

## Command details & flags

- `sxq push [-m <message>]` — pushes added, modified, and deleted text files. Respects `.gitignore` plus
  built-in ignores (`node_modules`, `dist`, `.git`, binaries >5MB are skipped). If it aborts
  with conflict markers (`<<<<<<< local`), resolve the markers in the listed files, then push again.
- `sxq publish [--message-id <id>]` — asynchronous; the CLI polls up to 10 min. Success prints
  a preview URL. If it fails with an error message, report it to the user verbatim.
- `sxq deploy` — **releases to production and may incur cloud service fees.** `-y` skips the
  confirmation and acknowledges the fee. Do NOT pass `-y` unless the user explicitly asked to
  deploy/release. With no pending version it republishes the latest released version
  (no progress polling in that mode — verify afterwards with `sxq deploy --status`).
  Optional: `--region CN|INTL` for cross-region release, `-m` to override the changelog.
- `sxq pull` — safe to run anytime; local-only edits are preserved via three-way merge.
  Conflicted files are listed and contain git-style markers; resolve before pushing.
- `sxq config set|get|unset|list` — keys: `host` (API base URL), `lang` (`zh`/`en`).
- `--debug` on any command prints full request/response logs (tokens masked) — use it when
  diagnosing failures.

## Database migrations (`sxq db push`)

Superun projects use Supabase. Schema changes MUST go through migration files executed by
`sxq db push` — never by pushing SQL files with `sxq push` (the CLI blocks any change under
`supabase/migrations/` during a normal push).

Full flow:

1. Write the DDL in a new file under `supabase/migrations/`. The name MUST be
   `<digits>_<memo>.sql` (everything before the first underscore must be digits) — files not
   matching are SKIPPED with a warning, same as the Supabase CLI, so a misnamed migration
   silently never runs. Use a `yyyyMMddHHmmss` timestamp as the digits — generate it with
   `date +%Y%m%d%H%M%S` (e.g. `20260709120000_create_users.sql`) — so execution order stays
   deterministic.
2. Run `sxq db push`. It will:
   - pull remote changes first (aborts if there are merge conflicts — resolve, then rerun);
   - diff local files against the remote baseline to find migrations that are new;
   - execute the new migrations one at a time, in ascending timestamp order;
   - stop at the first failure and print the server's error message. Migrations before the
     failed one are already applied; fix the failing file and rerun — only the remaining
     (still-new) migrations execute again;
   - after success, the server stores each migration file as a project attachment
     automatically, and the CLI runs a final pull so the local manifest matches.
3. Never edit an already-executed migration file — it is part of the remote baseline; write a
   new migration instead.
4. Migration SQL should be idempotent where possible (`create table if not exists`, `drop ... if exists`).

## Rules of thumb

1. Run `sxq pull` before editing if the project may have changed remotely (e.g. the user also
   edits on the Superun web UI).
2. After pushing code changes the user wants to see: `sxq publish` for a preview; only
   `sxq deploy` when they ask to go live.
3. `deploy --status` is read-only and always safe for checking state.
4. Exit code 0 = success. Non-zero exit prints an actionable error message on stderr —
   read it before retrying; do not blindly retry `deploy`.
5. Never commit or expose the contents of `.sxq/` (it contains the sessionId and session
   metadata; anyone with the sessionId may be able to read project files).
