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
| `sxq login [-y] [--pat / --stdin / --token <token>]` | 浏览器授权后签发并保存 PAT；支持隐藏输入、标准输入或已有 token（先校验再保存）。 |
| `sxq logout` | 删除当前 API 环境保存的登录凭证，不撤销服务端 PAT，也不取消 `SUPERUN_PAT`。 |
| `sxq link <sessionId> [-y]` | 关联当前目录到项目，校验代码同步权限、项目可见性，且项目须完成样式选择、阶段至少为 2（演示）。 |
| `sxq pull [-f]` | 拉取远端文件。首次全量，之后增量并做三方合并，冲突写入 git 风格 `<<<<<<<` 标记；Git 项目默认仅允许在配置分支操作。 |
| `sxq push [-f] [-y] [-m <msg>]` | 先拉取并展示新增、修改、删除清单，确认后推送并生成快照。Git 项目默认仅允许从配置分支推送；`-f` 忽略分支限制，`-y` 跳过确认。 |
| `sxq preview [front\|ef]` | 更新预览环境；默认 `front`，`ef` 单独部署 Edge Function。 |
| `sxq publish` | `sxq preview front` 的兼容别名。 |
| `sxq deploy` | 打开当前关联项目的发布确认页，CLI 不会直接发布。 |
| `sxq deploy --status` | 只查看待上线/已发布版本和访问地址，不触发上线。 |
| `sxq plugin list\|status\|enable\|skill\|disable` | 管理当前项目的白名单插件；`skill` 强制安装/升级插件私有技能。 |
| `sxq db push [-f] [-m <msg>]` | 执行 `supabase/migrations/` 下新增的数据库迁移；Git 项目默认仅允许在配置分支操作。 |
| `sxq db query [sql] [--file <path>] [--prod] [--limit <n>] [--json]` | 执行 SQL；Debug 允许写入，开启独立部署后可用只读 `--prod` 查询线上库。 |
| `sxq db logs [--type <type>] [--since <range>] [--prod] [--json]` | 查询 superun Cloud 日志；开启独立部署后可用 `--prod` 查询线上日志。 |
| `sxq config set\|get\|unset\|list` | 管理配置。支持项：`host`、`lang`（`zh` / `en`）、项目级 `push-branch`（默认 `main`）。 |
| `sxq upgrade` | 从 npm 升级 CLI 到最新版本。 |

## 强制升级策略

CLI 每天第一次执行命令时刷新 npm dist-tags，当天后续命令只读取本地缓存。`latest`
只产生普通升级提示；维护者设置的 `required` 代表最低可用版本。当前版本低于
`required` 时，CLI 会先通过 npm 自动升级到最新版，再用升级后的 CLI 重新执行用户原命令。
`sxq upgrade`、`sxq logout`、`--version` 和 `--help` 始终可以直接执行。

维护者只能在目标版本已发布并验证可用后启用或提高强更下限：

```bash
npm dist-tag add suxiaoqiang-cli@<最低可用版本> required
npm dist-tag rm suxiaoqiang-cli required  # 取消强更
```

npm registry 暂时不可用时，CLI 会继续执行上次成功获取的强更策略；若本机从未获取过
策略则放行，避免 registry 故障导致所有命令不可用。

注意：强更门禁只能约束已经包含该能力的 CLI 版本。首次上线时应先让用户完成一次正常
升级，之后再用 `required` 管理这些版本的最低下限；它无法反向改变此前已经发布的旧代码。

## 项目插件和私有技能

CLI 只展示服务端白名单内的项目插件。当前支持 `SUPERUN_CLOUD`、`SUPERUN_AI`、
`SUPERUN_MANAGED_AGENT_V2`、`SUPERUN_STORAGE`、`TTS`、`ASR`、`VIDEO_GENERATE`、
`NANO_BANANA` 和 `OCR`。

```bash
sxq plugin list
sxq plugin enable SUPERUN_CLOUD
sxq plugin skill SUPERUN_CLOUD
```

`sxq plugin skill` 会把插件关联的全部私有技能文件强制升级到服务端最新版本，写入
`.superun/skills/<skill-id>/`。每个技能可以包含 `SKILL.md`、references、scripts 等多个文件。
智能体如需使用，请自行执行对应的 `sxq plugin skill <PLUGIN_ID>` 安装技能。

`.superun/skills/` 不属于项目代码同步：`sxq pull` 不读取或覆盖它，`sxq push` 也不会上传它。
插件能力命令会在执行前强制升级相关私有技能；例如所有 `sxq db` 操作都会升级
`SUPERUN_CLOUD` 的技能。

## Claude Code 与 Codex 插件

本仓库为 Claude Code 和 Codex 提供同一份 `suxiaoqiang-cli` skill。插件负责教会智能体安全使用 `sxq`；CLI 本体仍需通过 npm 安装。

### Claude Code

安装：

```bash
claude plugin marketplace add AiGuangInc/suxiaoqiang-cli
claude plugin install suxiaoqiang-cli@suxiaoqiang
```

更新到最新版 skill，然后重启 Claude Code：

```bash
claude plugin marketplace update suxiaoqiang
claude plugin update suxiaoqiang-cli@suxiaoqiang
```

### Codex

安装：

```bash
codex plugin marketplace add AiGuangInc/suxiaoqiang-cli --ref main
codex plugin add suxiaoqiang-cli@suxiaoqiang
```

刷新 marketplace、重新安装最新版插件，然后新建任务使 skill 生效：

```bash
codex plugin marketplace upgrade suxiaoqiang
codex plugin add suxiaoqiang-cli@suxiaoqiang
```

## 数据库迁移

在 `supabase/migrations/` 下创建迁移文件，命名必须严格遵循 `<yyyyMMddHHmmss>_<标识>.sql`：前缀必须是 14 位时间戳，例如 `20260506210939_b9c21d2a344c4871b08a744b2e724176.sql`。时间戳前缀用于确定迁移回放顺序，在项目内必须唯一。只要存在一个命名不合规的新增 SQL 文件，`sxq db push` 就会在执行任何 SQL 前中止整批迁移。然后执行：

```bash
sxq db push -m "新增用户资料表"
```

它会先拉取远端，找出远端还没有的新迁移。如果待执行迁移与其他待执行迁移或远端已有迁移使用了相同时间戳，会在执行任何 SQL 前直接报错；否则按时间戳顺序逐个执行，遇到失败立即停止并打印错误。每个成功迁移都会由服务端自动保存为项目附件，所以**不要用 `sxq push` 推送迁移文件**（CLI 会直接拦下）。

SQL 和日志查询：

```bash
sxq db query "select * from users limit 20"
sxq db query --file query.sql --json
sxq db logs --type function --since 15m
```

开启独立部署后，默认查询 Debug 数据库/日志；增加 `--prod` 才查询 Production。未开启独立部署时
使用 `--prod` 会直接报错。默认 Debug 查询允许执行写 SQL，便于研发调试；`--prod` 由 CLI 和后端双重
强制只读。需要持久、可回放的结构变更仍应使用迁移文件和 `sxq db push`。

## 说明

- **支持 `.gitignore`**：`pull` / `push` 遵循项目根目录的 `.gitignore`（另有 `node_modules`、`dist`、`.git` 等内置规则），被忽略的文件不参与同步。
- **插件技能隔离**：`.superun/skills/` 只由 `sxq plugin skill` 和插件能力命令管理，不进入 `pull` / `push` 的项目附件清单。
- **Git 本地文件保护**：Git 项目的 `pull`、`push` 和 `db push` 默认只能在 `push-branch` 配置的分支执行，并阻止 merge/rebase 等中间状态、worktree 不匹配及非后继历史操作。非 Git 项目不执行这些检查。可用 `sxq config set push-branch master` 修改项目分支；`-f` 仅忽略分支限制。
- **推送清单确认**：`push` 会列出全部新增、修改和删除文件，并默认要求 `y/N` 确认；`-y` 表示已检查清单并直接确认。
- **非交互 / CI / AI 智能体**：终端内的确认提示可用 `-y`，非 TTY 环境会快速报错；正式发布必须在浏览器中确认，`sxq deploy` 无法绕过。
- **语言**：按系统 locale 自动检测，可用 `sxq config set lang zh` 固定。
- **正式发布**：`sxq deploy` 只负责打开发布确认页，请在浏览器中核对并确认发布。

## 开源协议

[Apache-2.0](./LICENSE)

### PAT 登录

运行 `sxq login`，在浏览器授权后，CLI 使用临时 token 调用 `PersonalAccessToken/create` 签发 `sup_pat_` PAT，并保存到系统凭证库：macOS Keychain、Windows 凭证管理器或 Linux Secret Service。登录凭证按 API 基础 URL 隔离，切换 `host` 不会沿用其他环境的凭证。

CLI 默认使用系统凭证库。无桌面 Linux 且没有会话 D-Bus 时，才退回本地明文文件并提示（Unix 权限 `0600`）；凭证库锁定、拒绝访问或出错时会停止命令，不会悄悄写入明文。读、写、删除都只操作选中的存储。系统凭证库可用但没有凭证时，不读取本地文件；没有凭证就重新登录。系统凭证库可用时，即使其中没有凭证，也会删除当前环境的本地明文 token 和旧版本登录 token 字段；两种存储之间不迁移凭证。切换 API host 不搬运凭证。

无桌面环境可以由密钥管理工具注入 `SUPERUN_PAT`，不访问以上两种存储。Linux 系统凭证库需要 Secret Service 和会话 D-Bus；原生平台包需保留 npm optional dependencies。凭证库已解锁且已授权时，通常无需每条命令都输入密码；系统策略、锁定或 Node 升级仍可能触发提示。明文文件与系统凭证库都不能完全隔离同账号恶意程序。

- `sxq login --pat`：隐藏输入已有 PAT，在线校验后保存。
- `sxq login --stdin`：从标准输入读取 PAT，适合密码管理器或脚本；校验失败保留原凭证。
- `SUPERUN_PAT`：与 superun-ai 使用相同环境变量，优先于本地凭证，所有 API 请求通过 `access-token` 头携带。设置后执行 `sxq login` 只校验环境变量，不落盘，也不打开浏览器。空值或格式错误会直接报错。
- `sxq login --token <token>`：兼容已有 token 或 PAT；为避免命令历史记录凭证，PAT 推荐通过 `--pat`、`--stdin` 或环境变量传入。
- `sxq logout`：仅删除当前 API 环境在选中存储中的凭证，使用系统凭证库时也清理当前环境的明文 token；使用本地文件时不操作不可用的系统凭证库，不撤销服务端 PAT；`SUPERUN_PAT` 仍需自行取消。

显式导入凭证后，已设置的 `SUPERUN_PAT` 仍优先；要使用新保存的凭证，请先 `unset SUPERUN_PAT`。CLI 不会自动读取 superun-ai 的凭证文件。业务 PAT 与国内预发网关使用的 `PRIVATE_TOKEN` / `PRIVATE-TOKEN` 不同，二者独立配置。
