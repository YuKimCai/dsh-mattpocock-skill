# dsh-mattpocock-skills

> **本项目是对 [mattpocock/skills](https://github.com/mattpocock/skills) v1.3.1 的封装与 DeepSeek Harness 适配。**
> 27 个技能的正文版权归 **Matt Pocock**，MIT 许可；本项目新增的是 Agent 预设、插件封装与平台词汇适配。
> 取用版本、对应 commit、具体改了什么，见 **[NOTICE.md](./NOTICE.md)**。

Matt Pocock 的 [mattpocock/skills](https://github.com/mattpocock/skills)（27 个工程技能）做成 **DeepSeek Harness 的 Agent 预设**：一个真正的智能体，不是一个技能目录。

装好之后，模式下拉里多出一个 **「Matt Pocock 工程师」**。选中它开会话，这个会话就带着 27 个技能、配套人格、以及技能流程依赖的完整工具面（bash / 读写文件 / 搜索 / 子智能体 / Web / 提问 / todo）。

---

## 文档

- **[SKILLS.md](./SKILLS.md)** — 27 个技能按**实际用途**分类：需求定型 / 可执行化 / 实施 / 识别整理 / 协作 / 入口，含主流程图、接入点、触发方式和一张总表。**想搞清楚「这些技能到底能干嘛」读这一份就够。**
- **[NOTICE.md](./NOTICE.md)** — 上游出处、取用版本与 commit、本项目具体改了什么。**二次开发或分发前必读。**
- **[README.md](./README.md)**（本文）— 怎么装、装了什么、从 Claude Code 到 DSH 改了什么。

---

## 它做了什么

| 层 | 内容 |
|---|---|
| **Agent 预设** | `presets/mattpocock/agent.cordis.yml`（20 行插件组合）+ `preset.yml`（显示名/描述） |
| **人格** | 一段把 27 个技能的组织方式和主流程写进去的 prefix，模型不必先读技能就知道什么时候该用哪个 |
| **技能** | 27 个 skill 全部转换好，放在 `skills/`，随包发布 |
| **插件** | `lib/index.js`：落地技能树 + 向 `ctx.agentPresets` 声明预设 + 暴露状态接口 |
| **状态接口** | `GET/POST /mattpocock-skills/status`（回环 Web 服务） |

### 技能清单（27 个）

**模型可自主调用（11）**：`code-review`、`codebase-design`、`diagnosing-bugs`、`domain-modeling`、`grilling`、`pr`、`prototype`、`research`、`tdd`、`wizard`、`writing-for-agents`

**仅用户点名（16）**：`ask-matt`、`grill-me`、`grill-with-docs`、`handoff`、`implement`、`implement-spec`、`improve-codebase-architecture`、`retro`、`setup-matt-pocock-skills`、`teach`、`to-questionnaire`、`to-spec`、`to-tickets`、`triage`、`wait-what`、`wayfinder`

对齐上游的行为：上游 `disable-model-invocation: true` 的技能，在 DSH 里就是「只在用户输入 `/技能名` 时注入」，模型侧目录里看不到。这一点是刻意保留的，不是漏配。

---

## 安装

### 方式 A：装进 profile（推荐，随宿主启动自动加载）

在本仓库目录里执行（`file:.` 会记成你 clone 下来的绝对路径，换机器要重装）：

```bash
# 1. 加进 profile 的依赖
dsh plugin --profile web add file:.

# 2. 把包名加进 profile 的 bundle 列表（~/.dsh/profiles/web/package.json）
#    "dsh": { "profile": { "bundles": [ ..., "dsh-mattpocock-skills" ] } }

# 3. 重启宿主
```

### 不想动 profile？用 overlay 试跑

仓库根有两个 overlay，路径全部相对**它们自己的位置**，clone 到哪都能跑：

```bash
# 只挂这个插件（新开一个宿主，不动现有 profile）
dsh --profile web --patch ./overlay.yml --port 3120 --no-open

# 顺手把默认预设也切过去
dsh --profile web --patch ./overlay.yml --patch ./default-preset.yml --port 3120 --no-open
```

> `--patch` 的路径是相对**你执行命令的目录**；overlay 里那条 `name: './lib/index.js'` 才是相对 **overlay 文件自己**解析的。两个别搞混。

### 方式 B：只想要技能，不要智能体

把 `skills/` 下的目录拷到 `$DSH_HOME/skills/`（或项目根的 `.dsh/skills/`）即可，DSH 原生的 `skill` 工具和 `/技能名` 直接可用。

---

## 用法

选中「Matt Pocock 工程师」后：

- **模型自主**：说「这段 diff review 一下」→ 它自己加载 `code-review`；说「这个 bug 查不出来」→ `diagnosing-bugs`。
- **显式点名**：输入 `/tdd`、`/to-tickets`、`/wayfinder`。用户点名的技能会作为指令注入，并在同一轮生效。
- **迷茫时**：`/ask-matt` 是上游的路由技能，会告诉该按什么顺序调用其余技能。
- **首次用某仓库**：先跑 `/setup-matt-pocock-skills`，它会把 issue tracker、triage 标签、领域文档布局写进 `docs/agents/`；后续 `/to-spec`、`/to-tickets`、`/triage` 都读这份配置。

---

## 从 Claude Code 到 DSH：改了什么

技能正文是从上游**逐字保留**的，只做了必要的平台适配：

| 上游 | DSH | 说明 |
|---|---|---|
| `Skill tool` | `\`skill\` 工具` | DSH 的原生技能加载工具 |
| `/clear` | 「开新会话」 | DSH 没有 `/clear` 命令；语义等价，旧会话可恢复 |
| `disable-model-invocation: true` | 同名 frontmatter | DSH 原生支持这个字段 |
| `agents/openai.yaml` | 删除 | Codex 专用显示元数据，DSH 不读 |

`/compact`、`/handoff`、subagent 等在两边的语义一致，保留原文。技能内引用的相对文件（`GLOSSARY-FORMAT.md`、脚本模板等）全部随技能目录一起搬过来了。

---

## 状态接口

```bash
curl -s http://127.0.0.1:3080/mattpocock-skills/status | jq
```

返回包版本、预设是否已声明、是否 broken、技能树落地位置、27 个技能名，以及当前 catalog 里实际能被模型看到的技能。

`POST {"action":"resync"}` 会强制把包内技能重新拷到 `$DSH_HOME/mattpocock-skills/skills`。

---

## 技能树的位置

技能会被拷到 **`$DSH_HOME/mattpocock-skills/skills`**，不是留在 `node_modules` 里。上游的整个主张就是「这些文件小到你敢改」，锁在 `node_modules` 里违背这一点。

- 每个包版本覆盖一次；同版本重启不动你的改动。
- 想长期保留改动：把那个技能拷到 `$DSH_HOME/skills/`（用户根，rank 更高，同名优先）。
- 想强制重置：`POST {"action":"resync"}` 或把 `resyncSkills` 设为 `true`。

---

## 目录结构

```
dsh-mattpocock-skills/
├── package.json              # dsh.bundle.patch 指向 cordis.patch.yml
├── cordis.patch.yml          # bundle 层：insert 本插件一行（按包名，无路径）
├── overlay.yml               # 试用 overlay：不装 profile 直接挂（相对路径）
├── default-preset.yml        # 把默认预设切到 mattpocock
├── lib/
│   ├── index.js              # 落地技能 + 声明预设 + 状态路由
│   ├── composition.js        # 读 agent.cordis.yml / preset.yml 的 YAML 子集解析器
│   └── sync.js               # 技能树同步
├── presets/mattpocock/
│   ├── agent.cordis.yml      # 20 行插件组合（人格/工具/技能/压缩/子智能体…）
│   └── preset.yml            # 显示名、描述、排序
├── skills/                   # 27 个技能（含各自引用的资源文件）
├── SKILLS.md                 # 27 个技能按实际用途分类（先读这个）
└── scripts/
    └── verify-skills.mjs     # 27 个技能全量解析自检（任何目录可跑）
```

---

## 自检

```bash
# 27 个技能能否全部被 DSH 的技能 provider 解析（任意目录可跑）
npm run verify
# 期望： discovered 27 | model-invoked 11 | user-only 16 | failed 0

# 组合能否被预设注册表接受
node -e "import('./lib/composition.js').then(m=>console.log(m.readPresetDefinition('mattpocock','presets/mattpocock','/tmp').plugins.length))"
# 期望： 20
```

---

## 来源与许可

| 部分 | 归属 | 许可 |
|---|---|---|
| `skills/` 下 27 个技能正文 | [Matt Pocock](https://github.com/mattpocock/skills) v1.3.1 | MIT |
| Agent 预设、`lib/`、overlay、自检脚本、SKILLS.md | 本项目 | MIT |
| 运行平台 | [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | MIT |

**技能正文未作改写**，只做了平台词汇替换（`Skill tool` → `skill` 工具、`/clear` → 开新会话）并删除了 Codex 专用的 `agents/openai.yaml`。
完整出处、上游 commit、二次开发注意事项见 **[NOTICE.md](./NOTICE.md)**。
