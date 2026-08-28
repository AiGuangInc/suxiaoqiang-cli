# suxiaoqiang-cli (`sxq`)

[![npm version](https://img.shields.io/npm/v/suxiaoqiang-cli.svg)](https://www.npmjs.com/package/suxiaoqiang-cli)
[![license](https://img.shields.io/npm/l/suxiaoqiang-cli.svg)](./LICENSE)

English | [简体中文](./README.zh-CN.md)

`sxq` is the official command-line tool for [Superun](https://www.superun.com), the vibe coding platform. It syncs your Superun project files to your local machine so you can edit them with your favorite editor or AI coding agent, then push changes back, trigger a preview build, and open the production release confirmation page.

## Installation

Requires Node.js >= 18.

```bash
npm install -g suxiaoqiang-cli
```

Or run from source:

```bash
git clone https://github.com/AiGuangInc/suxiaoqiang-cli.git
cd suxiaoqiang-cli
npm install
npm run build
npm link   # makes the `sxq` command available globally
```

## Quick start

```bash
# 1. Log in (opens a browser for authorization)
sxq login

# 2. Link a local directory to your Superun project
mkdir my-app && cd my-app
sxq link <sessionId>        # sessionId is shown in the Superun project URL

# 3. Pull the project files
sxq pull

# 4. Edit locally, then push your changes back
sxq push -m "tweak homepage copy"

# 5. Update the frontend preview and wait for it
sxq preview                 # same as sxq preview front; prints the preview URL when done

# Update only the Edge Function preview when needed
sxq preview ef

# 6. Open the production release confirmation
sxq deploy                  # opens the project release confirmation page in your browser
```

## Commands

| Command | Description |
| --- | --- |
| `sxq login [-y] [--token <token>]` | Log in via browser authorization, or directly with an existing token (validated first). |
| `sxq link <sessionId> [-y]` | Link the current directory to a project. Verifies the session belongs to your account. |
| `sxq pull` | Pull remote files. Incremental after the first pull, with three-way merge; conflicts get git-style `<<<<<<<` markers. |
| `sxq push [-f] [-y] [-m <msg>]` | Pull first, show the complete add/modify/delete plan, then push after confirmation. Git projects only push from the configured branch by default; `-f` ignores branch restrictions and `-y` skips confirmation. |
| `sxq preview [front\|ef]` | Update the preview environment; defaults to `front`, while `ef` deploys Edge Functions only. |
| `sxq publish` | Compatibility alias for `sxq preview front`. |
| `sxq deploy` | Open the linked project's release confirmation page. The CLI does not release directly. |
| `sxq deploy --status` | Show pending / published versions and the live URL without releasing. |
| `sxq db push [-m <msg>]` | Execute new database migrations under `supabase/migrations/`; `-m` supplies the migration note. |
| `sxq config set\|get\|unset\|list` | Manage config. Keys: `host`, `lang` (`zh` / `en`), and project-level `push-branch` (default `main`). |
| `sxq upgrade` | Upgrade the CLI to the latest version from npm. |

## Claude Code plugin

This repo doubles as a Claude Code plugin marketplace. Install the `suxiaoqiang-cli` skill so Claude Code knows how to drive `sxq` (workflows, non-interactive flags, safety rules):

```
/plugin marketplace add AiGuangInc/suxiaoqiang-cli
/plugin install suxiaoqiang-cli@suxiaoqiang
```

The plugin teaches Claude how to use the CLI — the CLI itself still needs to be installed via npm (see above).

## Database migrations

Create a migration file under `supabase/migrations/` named `<digits>_<memo>.sql` — everything before the first underscore must be digits (a `yyyyMMddHHmmss` timestamp is recommended, e.g. `20260709120000_create_users.sql`). The timestamp prefix determines replay order and must be unique; files not matching this pattern are skipped, same as the Supabase CLI — then:

```bash
sxq db push -m "add user profile tables"
```

It pulls first and finds migrations that don't exist remotely yet. If the pending batch contains duplicate timestamps, it aborts before executing any SQL; otherwise it executes migrations one by one in timestamp order, stopping at the first failure and printing the error. The server stores each successful migration as a project attachment automatically, so **don't push migration files with `sxq push`** (the CLI blocks them).

## Notes

- **`.gitignore` support**: `pull` / `push` respect your project's `.gitignore` (plus built-in ignores like `node_modules`, `dist`, `.git`). Ignored files are never synced.
- **Git push guard**: Git projects only push from the configured `push-branch` and reject merge/rebase intermediate states or rewritten history. Non-Git projects skip these checks. Use `sxq config set push-branch master` to change the project branch; `-f` only ignores branch restrictions.
- **Push plan confirmation**: `push` lists every added, modified, and deleted file and asks for `y/N` confirmation by default. `-y` means the list has been reviewed and accepted.
- **Non-interactive / CI / AI agents**: terminal confirmation prompts have a `-y` flag and fail fast outside a TTY. Production release confirmation always happens in the browser; `sxq deploy` cannot bypass it.
- **Language**: auto-detected from your locale; override with `sxq config set lang en`.
- **Production releases**: `sxq deploy` only opens the release confirmation page. Review and confirm the release in the browser.

## License

[Apache-2.0](./LICENSE)
