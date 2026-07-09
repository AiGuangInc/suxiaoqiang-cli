# suxiaoqiang-cli (`sxq`)

[![npm version](https://img.shields.io/npm/v/suxiaoqiang-cli.svg)](https://www.npmjs.com/package/suxiaoqiang-cli)
[![license](https://img.shields.io/npm/l/suxiaoqiang-cli.svg)](./LICENSE)

[English](./README.md) | 简体中文

`sxq` 是 vibe coding 平台 [Superun](https://www.superun.com) 的官方命令行工具。它把你的 Superun 项目文件同步到本地，让你用熟悉的编辑器或 AI 编程智能体修改代码，然后推送回远端、触发预览编译、正式上线——全程不离开终端。

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

# 5. 触发预览编译（debug 发布）并等待完成
sxq publish                 # 完成后输出预览地址

# 6. 正式上线
sxq deploy                  # 确认后轮询直到发布完成
```

## 命令一览

| 命令 | 说明 |
| --- | --- |
| `sxq login [-y] [--token <token>]` | 浏览器授权登录；也可用 `--token` 直接以已有 token 登录（会先校验有效性）。 |
| `sxq link <sessionId> [-y]` | 关联当前目录到项目，会校验 session 归属于当前账号。 |
| `sxq pull` | 拉取远端文件。首次全量，之后增量并做三方合并，冲突写入 git 风格 `<<<<<<<` 标记。 |
| `sxq push [-m <msg>]` | 推送本地改动。推送前先拉取远端变更，有冲突则中断。 |
| `sxq publish` | debug 发布（预览重编译），轮询等待编译完成并输出预览地址。 |
| `sxq deploy [-y] [-m <msg>] [--region CN\|INTL]` | 正式上线待发布版本并轮询至完成。无待发布版本时以最新已发布版本重新发布。 |
| `sxq deploy --status` | 只查看待上线/已发布版本和访问地址，不触发上线。 |
| `sxq db push` | 执行 `supabase/migrations/` 下新增的数据库迁移。 |
| `sxq config set\|get\|unset\|list` | 管理配置。支持项：`host`、`lang`（`zh` / `en`）。 |
| `sxq upgrade` | 从 npm 升级 CLI 到最新版本。 |

## Claude Code 插件

本仓库同时是一个 Claude Code 插件市场。安装 `suxiaoqiang-cli` skill 后，Claude Code 就知道如何正确使用 `sxq`（工作流、非交互参数、安全规则）：

```
/plugin marketplace add AiGuangInc/suxiaoqiang-cli
/plugin install suxiaoqiang-cli@suxiaoqiang
```

插件只是教会 Claude 使用 CLI——CLI 本体仍需通过 npm 安装（见上文）。

## 数据库迁移

在 `supabase/migrations/` 下创建迁移文件，命名必须为 `<数字>_<描述>.sql`（首个下划线前须全为数字，数字建议用 `yyyyMMddHHmmss`，如 `20260709120000_create_users.sql`；不符合的文件会被忽略不执行，与 Supabase CLI 行为一致），然后执行：

```bash
sxq db push
```

它会先拉取远端，找出远端还没有的新迁移，按时间戳顺序逐个执行——遇到失败立即停止并打印错误。迁移执行成功后服务端会自动把文件保存为项目附件，所以**不要用 `sxq push` 推送迁移文件**（CLI 会直接拦下）。

## 说明

- **支持 `.gitignore`**：`pull` / `push` 遵循项目根目录的 `.gitignore`（另有 `node_modules`、`dist`、`.git` 等内置规则），被忽略的文件不参与同步。
- **非交互 / CI / AI 智能体**：所有确认提示都有 `-y` 替代；非 TTY 环境下会快速报错并提示，不会挂起等待输入。
- **语言**：按系统 locale 自动检测，可用 `sxq config set lang zh` 固定。
- **云服务费**：`sxq deploy` 会正式上线并可能产生云服务费，确认提示（或 `-y`）即表示知晓。

## 开源协议

[Apache-2.0](./LICENSE)
