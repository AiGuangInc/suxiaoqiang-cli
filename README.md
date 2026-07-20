# suxiaoqiang-cli (`sxq`)

[![npm version](https://img.shields.io/npm/v/suxiaoqiang-cli.svg)](https://www.npmjs.com/package/suxiaoqiang-cli)
[![license](https://img.shields.io/npm/l/suxiaoqiang-cli.svg)](./LICENSE)

English | [简体中文](./README.zh-CN.md)

`sxq` is the official command-line tool for [Superun](https://www.superun.com), the vibe coding platform. It syncs your Superun project files to your local machine so you can edit them with your favorite editor or AI coding agent, then push changes back, trigger a preview build, and release to production — all from the terminal.

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

# 5. Trigger a preview build (debug publish) and wait for it
sxq publish                 # prints the preview URL when done

# 6. Release to production
sxq deploy                  # asks for confirmation, then polls until live
```

## Commands

| Command | Description |
| --- | --- |
| `sxq login [-y] [--token <token>]` | Log in via browser authorization, or directly with an existing token (validated first). |
| `sxq link <sessionId> [-y]` | Link the current directory to a project. Verifies the session belongs to your account. |
| `sxq pull` | Pull remote files. Incremental after the first pull, with three-way merge; conflicts get git-style `<<<<<<<` markers. |
| `sxq push [-m <msg>]` | Push local additions, modifications, and deletions, then create a snapshot using the optional note. Pulls first and aborts on conflicts. |
| `sxq publish` | Debug publish (preview recompile); polls until the build finishes and prints the preview URL. |
| `sxq deploy [-y] [-m <msg>] [--region CN\|INTL]` | Release the pending version and poll until live. With no pending version, republishes the latest release. |
| `sxq deploy --status` | Show pending / published versions and the live URL without releasing. |
| `sxq db push [-m <msg>]` | Execute new database migrations under `supabase/migrations/`; `-m` supplies the migration note. |
| `sxq config set\|get\|unset\|list` | Manage config. Keys: `host`, `lang` (`zh` / `en`). |
| `sxq upgrade` | Upgrade the CLI to the latest version from npm. |

## Claude Code plugin

This repo doubles as a Claude Code plugin marketplace. Install the `suxiaoqiang-cli` skill so Claude Code knows how to drive `sxq` (workflows, non-interactive flags, safety rules):

```
/plugin marketplace add AiGuangInc/suxiaoqiang-cli
/plugin install suxiaoqiang-cli@suxiaoqiang
```

The plugin teaches Claude how to use the CLI — the CLI itself still needs to be installed via npm (see above).

## Database migrations

Create a migration file under `supabase/migrations/` named `<digits>_<memo>.sql` — everything before the first underscore must be digits (a `yyyyMMddHHmmss` timestamp is recommended, e.g. `20260709120000_create_users.sql`); files not matching this pattern are skipped, same as the Supabase CLI — then:

```bash
sxq db push -m "add user profile tables"
```

It pulls first, finds migrations that don't exist remotely yet, and executes them one by one in timestamp order — stopping at the first failure and printing the error. The server stores each successful migration as a project attachment automatically, so **don't push migration files with `sxq push`** (the CLI blocks them).

## Notes

- **`.gitignore` support**: `pull` / `push` respect your project's `.gitignore` (plus built-in ignores like `node_modules`, `dist`, `.git`). Ignored files are never synced.
- **Non-interactive / CI / AI agents**: every confirmation prompt has a `-y` flag. In non-TTY environments the CLI fails fast with a hint instead of hanging.
- **Language**: auto-detected from your locale; override with `sxq config set lang en`.
- **Cloud fees**: `sxq deploy` releases to production and may incur cloud service fees; the confirmation prompt (or `-y`) acknowledges this.

## License

[Apache-2.0](./LICENSE)
