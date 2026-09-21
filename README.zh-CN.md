# skillsman

[English](README.md) | 简体中文

Skillsman 帮助你选择具体的 Agent Skills，在保留已有工作的前提下初始化项目，
并将选择复用于另一个项目。场景提供候选，保存的清单明确记录实际需要的技能。

仓库包含可安装的 `skillsman-*` 技能、场景定义、Bash 入口和 Node.js 模块。
安装交给固定版本的上游包 `skills@1.5.26`，YAML 解析使用 `yaml@2.8.3`。

维护者：YatMn <yatmn@outlook.com>

## 功能

- 预览明确选择的技能，展示来源、理由、实际状态和拟执行动作。
- 补齐所选技能，保留清单外技能及本地修改。
- 为每个项目保存独立选择，支持跨项目、跨 Agent 复用。
- 只在用户明确请求时，更新已保存选择中的技能。
- 按目标 Agent 记录和应用已安装技能名称及来源的快照。

Skillsman 不安装全局技能。修改安装内容的命令默认拒绝以本仓库为目标，
除非显式传入 `--allow-self-install`。Codex 是主要验证目标；接受其他上游
Agent ID，不等于已完整验证该 Agent，也不代表其内容与其他 Agent 隔离。

## 快速开始

需要 Node.js **>=22.20.0**、npm/npx 和 Bash。在本地仓库中，先安装 Node
依赖，再运行 CLI 或安装命令软链接：

```bash
npm ci
./bin/skillsman --help
```

[示例清单](examples/selection.yaml) 只选择两个内置技能：

```yaml
includes: []
skills:
  - source: YatMn/skillsman
    why: Keep project instructions and README accurate.
    names:
      - skillsman-agents-md
      - skillsman-readme
```

指定一个已存在的目标项目，先预览，再初始化：

```bash
./bin/skillsman plan --file examples/selection.yaml --target codex --project /path/to/project
./bin/skillsman init --file examples/selection.yaml --target codex --project /path/to/project
```

命令读取所选来源的当前内容，不会安装同来源的其他技能。`plan` 读取库存，
不修改目标项目文件。`init` 保存独立的 `.skillsman/skills.yaml` 并验证安装内容；
重复相同的初始化会保留匹配的已有技能。

在另一个已存在的项目中复用清单，也可以选择不同的 Agent：

```bash
./bin/skillsman plan --file /path/to/project/.skillsman/skills.yaml --target cursor --project /path/to/another-project
./bin/skillsman init --file /path/to/project/.skillsman/skills.yaml --target cursor --project /path/to/another-project
```

输入文件只读。修改第二个项目的清单不会影响第一个项目，也不会复制其机器状态。

完成 `npm ci` 后，可以把本地仓库的 CLI 加入 PATH：

```bash
./install.sh
```

这会创建 `~/.local/bin/skillsman`，需要确保该目录位于 PATH。它只是指向本仓库的
软链接，不会安装 Node 依赖或技能。后续示例使用这个 `skillsman` 命令。

也可以通过 GitHub-hosted 入口启动：

```bash
npx github:YatMn/skillsman --help
```

使用本流程前，先确认取得的版本提供 `plan --file` 和 `init --file`。
远程版本可能与本地仓库不同。

## 推荐用法

可以单独安装管理技能作为入口：

```bash
npx --yes skills@1.5.26 add YatMn/skillsman --skill skillsman-manage --agent codex
```

安装管理技能不会把 Skillsman CLI 加入 PATH。它负责协助选择，并使用兼容的 CLI；
请按上文确认命令入口。

```text
Use $skillsman-manage to help initialize skills for this repository.
Target: codex
Project path: current repository
Read the project instructions, existing skills and actual tasks. Recommend a
minimal list of named skills with sources and reasons, and preview it before
installation. Reuse any selection and authorization already given in this task.
```

把场景当作候选清单，读取来源中的真实技能名称，只选择需要的项目。
来源枚举失败时应报告错误，不能改成整库安装。

## 选择清单与本机状态

| 文件 | 含义 |
| --- | --- |
| `.skillsman/skills.yaml` | 可复用选择：来源、理由和明确名称；不绑定目标 Agent，也不含安装基线。适合提交到 Git。 |
| `.skillsman/state.json` | 本机已验证安装记录：来源、名称、目标、内容摘要和可为空的 revision。不能复制成另一个项目的基线。 |
| `skills-lock.json` | 上游管理的来源证据；不是选择清单，Skillsman 不会重写它。 |

请将 `.skillsman/state.json` 加入目标项目的 `.gitignore`。Skillsman 不会自动修改
`.gitignore`。摘要覆盖技能文件、references、scripts、Agent 元数据和目录内合法链接，
但不保存内容备份。

选择清单必须包含 `includes: []`、`skills` 列表、非空 `source` 和 `why`，
每个来源都必须有明确且非空的 `names`。`skills: []` 合法且不安装任何技能；
文件缺失则报错。含空格名称按完整字符串处理。通配符、YAML anchors/aliases/tags、
多文档、非空行内集合、未知字段、控制字符，以及类似命令选项的来源或名称都会被拒绝。
使用块列表，必要时为字符串加引号。

相同来源和名称会去重；同来源合并时保留首个理由。不同来源或不同名称占用同一安装
目录会报冲突。本地来源路径按目标项目解析后用于比较和安装，不会重写清单中的路径。

```bash
skillsman plan --file /path/to/selection.yaml --target codex --project /path/to/project
skillsman add --file /path/to/additions.yaml --target codex --project /path/to/project
```

`plan` 预览传入的文件；`add --file` 与已有选择合并，检查合并结果后再安装。
`init --file` 遇到不同的已有清单会拒绝继续，应明确编辑清单或使用 `add --file`。
场景名不能与 `--file` 同时使用；`init` 和 `add` 不接受 `--dry-run`。

预检查发现冲突时停止安装。执行阶段部分失败时，保留已验证成功的内容和选择清单，
以非零状态退出；可以重试初始化以补齐缺项。`remove` 删除技能后不会修改选择清单；
若不再需要该选择，应单独编辑清单。

## 按选择更新

`update` 必须指定目标，并要求项目已有 `.skillsman/skills.yaml`。重新获取所选技能
之前，会检查来源、本地内容基线和共享 Agent 影响；不会回退到整个项目的全量更新。

```bash
skillsman update --target codex --project /path/to/project --dry-run
skillsman update --target codex --project /path/to/project
```

预览可以把所选来源内容取到临时项目中，不修改目标项目。更新表示重新获取所选内容，
不一定代表发现了新版本。技能缺失、来源未知、基线未验证、本地修改、断链或共享范围
未解决，都会阻断相关计划。初始化可以保留未验证的已有内容，但不会因此建立可信更新基线。

Codex 的 `.agents/skills` 可关联这些通用 Agent ID：
`antigravity,codex,cursor,gemini-cli,github-copilot,zed`。因此，仅指定
`--target codex` 的更新可能返回 `SHARED_IMPACT`。审阅实际关联后，显式纳入所有
受影响的目标，再执行更新，例如：

```bash
skillsman update --target antigravity,codex,cursor,gemini-cli,github-copilot,zed --project /path/to/project --dry-run
skillsman update --target antigravity,codex,cursor,gemini-cli,github-copilot,zed --project /path/to/project
```

如果报告了其他链接到相同内容的 Agent，也必须纳入。若要授权刷新所选技能的全部
已知现有关联，可以使用：

```bash
skillsman update --target all --project /path/to/project --dry-run
skillsman update --target all --project /path/to/project
```

更新中的 `all` 会展开为现有的具体目标 ID，按技能和来源分组；不会传入
`--agent '*'`，也不会为新的 Agent 安装该选择。未知关联仍会阻断验证。
共享标签表示文件系统关联，不证明每个 Agent 都实际运行过技能。

Skillsman 不会自动追踪、后台更新或在项目之间传播修改。来源新增技能不会进入已有选择。
选择清单、摘要和快照都不保证恢复某个历史时点的完整内容。

## 内置 Skills

| Skill | 用途 |
| --- | --- |
| `skillsman-agents-md` | 创建或改进仓库级 agent instruction 文件，例如 `AGENTS.md`。 |
| `skillsman-branch` | 遵循仓库实际的 Git/GitHub 分支约定，支持默认分支或 main/develop/release 等工作流。 |
| `skillsman-manage` | 管理项目 skills：inspect、initialize、add、remove、update、snapshot、apply 和 diagnose。 |
| `skillsman-next-prompt` | 为 Codex 创建简洁的 continuation、handoff 或 fresh-session prompt。 |
| `skillsman-openspec` | 安装、初始化、更新和使用 OpenSpec spec-driven workflows。 |
| `skillsman-readme` | 创建或更新实用的软件仓库 README 文档。 |

每个内置 skill 位于 `skills/<skill-name>/`。目录名、`SKILL.md` frontmatter
里的 `name`，以及 `agents/openai.yaml` metadata 应保持一致。

## Scenarios

| Scenario | 使用场景 |
| --- | --- |
| `workflow` | 按需选择规划、调试、评审和仓库助手；特定框架由项目主动选用。 |
| `web-app` | 前端视觉设计、按需本地浏览器测试和交互制品；不代表完整 React/Next.js 工程覆盖。 |
| `deployment` | Vercel 专用的部署、环境配置和运行时候选。 |
| `database` | Postgres 指导，另行选择 Supabase 产品集成能力。 |
| `research` | 浏览器资料获取、研究简报和 Notion 研究，注明工具和工作区前提。 |
| `writing` | 文章、审校、脚本、社媒内容、知识归档和会议笔记。 |
| `documents` | Word、PDF、演示文稿、表格和文件型报告。 |
| `design` | 静态视觉、生成艺术、主题和特定用途图片。 |
| `all` | 只用于审计和测试聚合，不用于真实项目。 |

内置场景均明确列出技能名称，上游新增技能不会自动扩张这些列表。候选不等于默认安装：
选择前阅读 `why`、所需工具及当前上游指令。Vercel 项目优先考虑 CLI、部署和环境配置，
专用服务需有对应任务；Superpowers 和 OpenSpec 由项目主动选择。
已安装插件提供兼容技能时，优先复用。

`writing` 处理内容，`documents` 处理文件结构和交付。Notion 技能按任务归类，
需要连接服务和工作区权限。`huashu-proofreading` 基于实际使用效果，继续作为优先写作候选。
选用条件与排除理由见[选择指南](skills/skillsman-manage/references/scenario-mapping.md)
和[目录审查记录](docs/verification/catalog-review.md)。

查看场景候选和选择理由：

```bash
skillsman show workflow
skillsman show web-app
```

仍然可以安装明确请求的场景：

```bash
skillsman init workflow --target codex --project /path/to/project
skillsman add writing --target codex,cursor --project /path/to/project
```

场景使用 `includes` 和 `skills`；技能条目包含 `source`、`why` 及可选 `names`。
省略 `names` 表示明确请求整个来源。Skillsman 必须先枚举实际名称，才能保存可复用选择。
全来源请求同时包含已有与缺失技能、可能覆盖现有工作时会被阻断；请改用明确的文件清单
补齐缺项。`scenarios/all.yaml` 是审计聚合场景，`init all` 和 `add all` 会被拒绝。

## 目标 Agent

| Target | 行为 |
| --- | --- |
| `codex`, `cursor`, `openclaw`, `antigravity` | 使用对应的上游 Agent ID。 |
| `claude`, `claude-code` | 规范化为 `claude-code`。 |
| `gemini`, `gemini-cli` | 规范化为 `gemini-cli`。 |
| `github-copilot`, `zed` | 已识别的上游库存标签，可能共享通用技能内容。 |
| `all` | 含义取决于命令：检查全部项目 Agent；更新现有关联；应用快照目标；init/add 请求全部上游 Agent。 |

多个目标使用逗号分隔；`all` 不能与具体 ID 混用。`plan`、`init`、`add`、`update`、
`remove`、`snapshot` 和 `apply` 都必须指定 `--target`；`status` 和 `doctor` 省略时
默认检查所有目标。`init` / `add --target all` 与范围化更新不同，仍可能通过上游
`--agent '*'` 创建额外的 Agent 安装。未知 ID 会传给上游，但无法验证目标映射的库存
会标记未知，并可能阻断修改；不会猜测其目录。

## 其他命令

```bash
skillsman list
skillsman status --target codex --project /path/to/project
skillsman remove skillsman-readme --target codex --project /path/to/project
skillsman doctor --target codex --project /path/to/project
skillsman coverage
```

存在选择清单时，`status` 会将实际安装与保存的选择对照。`doctor` 检查上游可用性和
库存，用于诊断，不必在每次成功操作后运行。`restore` 会明确报告旧命令错误，
不是其他命令的别名；请使用 `init --file` 或对当前格式快照执行 `apply`。

## 快照

```bash
skillsman snapshot --target codex --project /path/to/project
skillsman snapshot --target codex --project /path/to/project --output /path/to/skills.snapshot.yaml
skillsman apply /path/to/skills.snapshot.yaml --target codex --project /path/to/another-project --dry-run
skillsman apply /path/to/skills.snapshot.yaml --target codex --project /path/to/another-project
```

默认路径为 `<project>/.skillsman/skills.snapshot.yaml`。只接受
`skillsman.snapshot.v1`，必须包含 schema 和按目标分组的 `{name, source}` 列表。
可读的链接技能会被收录；来源无法确认或库存读取出错时，快照不能成功保存。

快照保留已观察到的 GitHub 技能子目录，并正确编码分支名。对于上游来源语法无法
准确表达的 Git/GitLab 子目录，创建快照会报错，不会悄悄扩大来源范围。

`apply` 要求快照中有匹配目标的分组，并保留项目的选择文件。`--target all` 会展开快照中
的具体目标 ID，在任何安装之前检查合并计划，再执行分组写入。不同目标分组间的来源或
安装名称冲突会在安装前阻断整个 apply 操作。它不负责跨 Agent 转换选择，也不是内容回滚。跨 Agent 复用请使用 `skills.yaml`。缺失 schema 或旧格式会被拒绝，
不会隐式转换。

## 开发

完成 `npm ci` 后，在仓库根目录运行相关检查：

```bash
npm test
bash -n install.sh bin/skillsman
./bin/skillsman list
./bin/skillsman show workflow
./bin/skillsman coverage
git diff --check
npm pack --dry-run
```

`npm test` 运行 `node --test test/*.test.cjs`，覆盖模块和项目流程。
`test/skillsman-cli.test.sh` 只运行 `test/entrypoints.test.cjs`。
真实上游检查单独运行 `npm run test:smoke`，调用 `test/smoke-real-upstream.sh`。

已测试的覆盖范围及限制见[验证记录](docs/verification/project-skill-initialization.md)。

## 仓库结构

- `bin/skillsman`：定位 Node 命令模块的 Bash 入口。
- `lib/skillsman/`：配置、库存、计划、上游、状态和项目命令。
- `scenarios/*.yaml`：候选组合和明确的全来源请求。
- `skills/`：内置技能的规范源码、元数据和引用资料。
- `examples/selection.yaml`：只选择两个技能的可复用清单。
- `test/`：Node 测试、辅助函数和可控上游夹具。
- `install.sh`、`package.json`：本地 CLI 链接及包元数据。

## 许可证

MIT License，见 [LICENSE](LICENSE)。
