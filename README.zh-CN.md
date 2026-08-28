# suxiaoqiang-cli (`sxq`)

[![npm version](https://img.shields.io/npm/v/suxiaoqiang-cli.svg)](https://www.npmjs.com/package/suxiaoqiang-cli)
[![license](https://img.shields.io/npm/l/suxiaoqiang-cli.svg)](./LICENSE)

[English](./README.md) | 简体中文

`sxq` 是 vibe coding 平台 [Superun](https://www.superun.com) 的官方命令行工具。它把你的 Superun 项目文件同步到本地，让你用熟悉的编辑器或 AI 编程智能体修改代码，然后推送回远端、触发预览编译，并打开正式上线确认页。

## 安装

需要 Node.js >= 18。

```bash
npm install -g suxiaoqiang-cli
```

或从源码运行：

```bash
git clone https://github.com/AiGuangInc/suxiaoqiang-cli.git
cd suxiaoqiang-cli
npm install
npm run build
npm link   # 全局注册 sxq 命令
```

## 快速开始

```bash
# 1. 登录（会打开浏览器完成授权）
sxq login

# 2. 把本地目录关联到 Superun 项目
mkdir my-app && cd my-app
sxq link <sessionId>        # sessionId 在 Superun 项目页面的 URL 里

# 3. 拉取项目文件
sxq pull

# 4. 本地修改后推送回远端
sxq push -m "调整首页文案"

# 5. 更新前端预览并等待编译完成
sxq preview                 # 等同于 sxq preview front，完成后输出预览地址

# 按需单独更新 Edge Function 预览
sxq preview ef

# 6. 打开正式上线确认页
sxq deploy                  # 在浏览器中打开项目发布确认页
```

## 命令一览

| 命令 | 说明 |
| --- | --- |
| `sxq login [-y] [--token <token>]` | 浏览器授权登录；也可用 `--token` 直接以已有 token 登录（会先校验有效性）。 |
| `sxq link <sessionId> [-y]` | 关联当前目录到项目，会校验 session 归属于当前账号。 |
| `sxq pull [-f]` | 拉取远端文件。首次全量，之后增量并做三方合并，冲突写入 git 风格 `<<<<<<<` 标记；Git 项目默认仅允许在配置分支操作。 |
| `sxq push [-f] [-y] [-m <msg>]` | 先拉取并展示新增、修改、删除清单，确认后推送并生成快照。Git 项目默认仅允许从配置分支推送；`-f` 忽略分支限制，`-y` 跳过确认。 |
| `sxq preview [front\|ef]` | 更新预览环境；默认 `front`，`ef` 单独部署 Edge Function。 |
| `sxq publish` | `sxq preview front` 的兼容别名。 |
| `sxq deploy` | 打开当前关联项目的发布确认页，CLI 不会直接发布。 |
| `sxq deploy --status` | 只查看待上线/已发布版本和访问地址，不触发上线。 |
| `sxq db push [-f] [-m <msg>]` | 执行 `supabase/migrations/` 下新增的数据库迁移；Git 项目默认仅允许在配置分支操作。 |
| `sxq config set\|get\|unset\|list` | 管理配置。支持项：`host`、`lang`（`zh` / `en`）、项目级 `push-branch`（默认 `main`）。 |
| `sxq upgrade` | 从 npm 升级 CLI 到最新版本。 |

## Claude Code 插件

本仓库同时是一个 Claude Code 插件市场。安装 `suxiaoqiang-cli` skill 后，Claude Code 就知道如何正确使用 `sxq`（工作流、非交互参数、安全规则）：

```
/plugin marketplace add AiGuangInc/suxiaoqiang-cli
/plugin install suxiaoqiang-cli@suxiaoqiang
```

插件只是教会 Claude 使用 CLI——CLI 本体仍需通过 npm 安装（见上文）。

## 数据库迁移

在 `supabase/migrations/` 下创建迁移文件，命名必须为 `<数字>_<描述>.sql`（首个下划线前须全为数字，数字建议用 `yyyyMMddHHmmss`，如 `20260709120000_create_users.sql`）。时间戳前缀用于确定迁移回放顺序，必须唯一；不符合命名规范的文件会被忽略不执行，与 Supabase CLI 行为一致。然后执行：

```bash
sxq db push -m "新增用户资料表"
```

它会先拉取远端，找出远端还没有的新迁移。如果待执行迁移与其他待执行迁移或远端已有迁移使用了相同时间戳，会在执行任何 SQL 前直接报错；否则按时间戳顺序逐个执行，遇到失败立即停止并打印错误。每个成功迁移都会由服务端自动保存为项目附件，所以**不要用 `sxq push` 推送迁移文件**（CLI 会直接拦下）。

## 说明

- **支持 `.gitignore`**：`pull` / `push` 遵循项目根目录的 `.gitignore`（另有 `node_modules`、`dist`、`.git` 等内置规则），被忽略的文件不参与同步。
- **Git 本地文件保护**：Git 项目的 `pull`、`push` 和 `db push` 默认只能在 `push-branch` 配置的分支执行，并阻止 merge/rebase 等中间状态、worktree 不匹配及非后继历史操作。非 Git 项目不执行这些检查。可用 `sxq config set push-branch master` 修改项目分支；`-f` 仅忽略分支限制。
- **推送清单确认**：`push` 会列出全部新增、修改和删除文件，并默认要求 `y/N` 确认；`-y` 表示已检查清单并直接确认。
- **非交互 / CI / AI 智能体**：终端内的确认提示可用 `-y`，非 TTY 环境会快速报错；正式发布必须在浏览器中确认，`sxq deploy` 无法绕过。
- **语言**：按系统 locale 自动检测，可用 `sxq config set lang zh` 固定。
- **正式发布**：`sxq deploy` 只负责打开发布确认页，请在浏览器中核对并确认发布。

## 开源协议

[Apache-2.0](./LICENSE)
