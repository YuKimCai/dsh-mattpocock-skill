# 来源与归属

本项目是对他人开源作品的**封装与平台适配**。技能内容不是原创，务必保留可追溯的出处。

## 上游项目

| 项 | 值 |
|---|---|
| 项目 | **mattpocock/skills** — "Skills For Real Engineers" |
| 作者 | Matt Pocock（https://www.aihero.dev） |
| 仓库 | https://github.com/mattpocock/skills |
| 许可 | MIT，Copyright (c) 2026 Matt Pocock |
| 本项目取用的版本 | **v1.3.1** |
| 对应 commit | `5beb35b040e3de97e54fa9e386d7e42d15c295c2`（2026-10-19） |
| 更新方式 | `git clone --depth 1 https://github.com/mattpocock/skills.git` 后重新执行 `scripts/convert-skills.mjs` |

## 本项目做了什么（相对上游）

**技能正文没有改写。** 与上游的差异只有下面这些平台适配，且每一条都是可复现的精确替换：

| # | 改动 | 位置 | 原因 |
|---|---|---|---|
| 1 | `Skill tool` → `\`skill\` tool` | 10 个技能，共 20 处 | DSH 的技能加载工具叫 `skill` |
| 2 | `/clear` → 「开新会话」相关表述 | `ask-matt`（6 处） | DSH 没有 `/clear` 命令，语义等价物是开新会话 |
| 3 | `Subagent` → 补上 `subagent` 工具名 | `ask-matt`（2 处） | 点明 DSH 里对应的工具 |
| 4 | `(Claude → Codex)` → `(Claude Code → DeepSeek Harness, or back)` | `ask-matt`（1 处） | 本移植让 DSH 成为那个对照平台 |
| 5 | 删除 `agents/openai.yaml` | 27 个技能目录 | Codex 专用显示元数据，DSH 不读 |

**invocation 策略原样保留**：上游 `disable-model-invocation: true` 的技能，在本 Harness 里表现为「仅用户 `/技能名` 点名时注入，模型目录里看不到」。11 个模型可调用 / 16 个仅用户点名，与上游完全一致。

### 可复现性

`scripts/convert-skills.mjs` 把上述规则写成一张**精确替换表**（带 file、原文、替换、原因）。执行：

```bash
git clone --depth 1 https://github.com/mattpocock/skills.git ../mp-skills-src
node scripts/convert-skills.mjs ../mp-skills-src
```

输出 `copied 27 skills | applied 21 rewrites | no drift: every rule still matched upstream`，产物与仓库内 `skills/` **逐字节一致**（已用 `diff -r` 验证）。

上游哪天改了这些句子，脚本会打印 **UPSTREAM DRIFT** 并以退出码 2 结束，提示人工复核——不会静默跳过。

## 本项目的原创部分

这些文件在上游不存在，是这次封装新增的：

- `presets/mattpocock/` — Agent 预设组合与人格（把 27 个技能组织成一个智能体）
- `lib/` — 技能落地、预设注册、状态接口
- `overlay.yml` / `default-preset.yml` — 免安装试用
- `scripts/` — 上游移植与全量自检脚本
- `SKILLS.md` — 按实际用途重新分类的索引

上游取用的是**已发布的 27 个 promoted 技能**（`skills/engineering/` + `skills/productivity/`）。上游的 `misc/`、`in-progress/`、`deprecated/` 三个实验/冻结目录**未包含**。
   - `presets/mattpocock/` — Agent 预设组合与人格（把 27 个技能组织成一个智能体）
   - `lib/` — 技能落地、预设注册、状态接口
   - `overlay.yml` / `default-preset.yml` — 免安装试用
   - `scripts/verify-skills.mjs` — 全量解析自检
   - `SKILLS.md` — 按实际用途重新分类的索引

上游取用的是**已发布的 27 个 promoted 技能**（`skills/engineering/` + `skills/productivity/`）。上游的 `misc/`、`in-progress/`、`deprecated/` 三个实验/冻结目录**未包含**。

## 宿主平台

| 项 | 值 |
|---|---|
| 平台 | **DeepSeek Harness**（`@deepseek-ai/dsh`） |
| 仓库 | https://github.com/deepseek-ai/deepseek-harness |
| 许可 | MIT，Copyright (c) 2026 DeepSeek |

本项目只**依赖**该平台的插件机制与 Agent 预设机制，不含其源代码。

## 若你二次开发

- 修改 `skills/` 下的文件，本质是在改 Matt Pocock 的作品，请保留其署名。
- 修改 `lib/`、`presets/` 等封装层，属于你自己的作品。
- 分发时请同时保留本文件与 `LICENSE`。
