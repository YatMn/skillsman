# Project Skill Initialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现可选择套件中部分技能、跨项目复用、验证安装结果并按清单更新的 Skillsman 流程。

**Architecture:** 保留 Bash CLI 入口及现有场景安装路径，逐步引入独立的配置、库存、计划、状态和上游适配模块。Agent 负责选择理由，确定性程序负责检查和执行；项目选择与本机安装记录分离。每一阶段产出可运行、可测试的软件。

**Tech Stack:** Bash、Node.js CommonJS、Node 内置测试、`yaml` 2.x、`npx skills`。不引入 TypeScript 编译、数据库、后台服务或前端。

**Approved spec:** [项目技能初始化设计](../specs/2026-09-12-project-skill-initialization-design.md)。用户在设计提交 `d1d7e2a` 后回复“好的，继续”，已授权进入实施计划。

**Plan status:** 计划已编写；所有任务的复选框表示实施状态，尚未执行。计划内代码块是实施时使用的代码和测试约定，不代表这些模块已存在。

## Global Constraints

- 个人高频使用优先，同时保持其他开发者可安装、可理解、可复用。
- 持续维护预算以每月两小时为目标；不是首次开发工时估算。
- `skills/` 是自有技能源码，不从插件缓存复制技能。
- 场景保留简单 YAML 的 `includes`、`source`、`why`、可选 `names`。
- 场景省略 `names` 仍表示显式请求安装该来源全部技能，不能悄悄改变这一语义。
- 安装必须显式传入 `--target`，不新增全局安装功能。
- 未知目标继续传给上游，不猜测其目录。
- `all` 场景只用于审计；`--target all` 是另一概念。
- 不新增旧 schema 兼容层或命令别名。
- 暂不包含图形界面、技能市场、团队权限、后台自动更新、全网定期扫描、自动模型跑分、自动删除技能、历史版本精确恢复，也不重写全部自有技能。
- 保留 `bin/skillsman` 的 Bash 入口和 `install.sh`，不做整仓语言迁移。
- 编码前使用隔离工作区；原工作区的未提交链接和第三方技能不被清理、提交或静默替换。
- 文件路径在本计划中相对实施工作区根目录；不要把原工作区的绝对路径写进产品。

## 0. 实施前证据与接口收敛

### 当前可核实的事实

- 原工作区分支：`branch/20260531-skillsman-review-fixes`，存在未提交的技能目录链接变化。
- 本轮逐文件比较：四个链接化自有技能的九个已跟踪文件，内容与 HEAD 相同。执行时重新比较，并检查新增文件；不能据旧结果丢弃新编辑。
- 当前 Node 为 `v25.1.0`、npm 为 `11.17.0`；这是本机事实，不是所有用户环境保证。
- 上游源码的 `list --json` 返回名称、路径、scope、来源和 Agent **显示名称**。不要把显示名称当作 `--agent` 标识，也不要把无过滤清单当作某个目标已安装。[上游 list.ts](https://github.com/vercel-labs/skills/blob/main/src/list.ts)
- 上游锁文件读取会把部分读取或格式问题折算为空对象；Skillsman 必须自己检查已有锁文件的语法和可读性。[上游 local-lock.ts](https://github.com/vercel-labs/skills/blob/main/src/local-lock.ts)
- 上游源码包版本标为 `1.5.26`、Node 要求为 `>=22.20.0`。它是兼容检查候选，尚未通过本轮真实分发安装验证。[上游 package.json](https://github.com/vercel-labs/skills/blob/main/package.json)
- YAML 库提供文档解析、错误集合及语法树访问，适合严格验证配置。采用正式解析器，减少继续扩展 awk 子集的成本。[YAML 官方文档](https://eemeli.org/yaml/)

源码主分支与 npm 已发布包并不必然相同。任务 2 必须先核对实际包版本及命令合同；来源暂时不可访问时明确记录未验证，不编造成功。

### 模块文件的细化

设计中的 `.sh` 文件表是职责提案。本计划采用下面的具体边界：Bash 保留参数入口及既有命令，结构化模块使用 `.cjs`，避免为了调用一次 Node 再维护一层空 shell 包装。该细化不改变外部命令及数据约定。

| 文件 | 职责 | 不负责 |
| --- | --- | --- |
| `bin/skillsman` | 新旧命令分发、保留 Bash 入口 | 不再增加内联 JSON/YAML 算法 |
| `lib/skillsman/config.cjs` | YAML 解析、清单校验、规范化、现有快照校验 | 不读取安装库存 |
| `lib/skillsman/upstream.cjs` | 有时限的上游进程调用、输出校验 | 不推荐技能 |
| `lib/skillsman/inventory.cjs` | 批量读取库存、来源与路径证据、目标关联 | 不执行安装 |
| `lib/skillsman/state.cjs` | 内容摘要、状态验证、原子文件写入 | 不判断项目应该安装什么 |
| `lib/skillsman/plan.cjs` | 纯函数计算保留、安装、更新与冲突 | 不访问网络或文件系统 |
| `lib/skillsman/project.cjs` | 新清单命令编排、项目锁、结果核验和展示 | 不另写上游安装器 |
| `test/helpers/project.cjs` | 临时项目、命令执行、文件树快照 | 不模拟生产判断逻辑 |
| `test/fixtures/fake-npx.cjs` | 可控上游合同与失败注入 | 不进入发布运行路径 |
| `test/*.test.cjs` | 单元及真实文件系统集成测试 | 不访问实时网络 |

如果新增 helper 只为转发另一个模块、或一个函数能保持现有边界，不增加文件。Node 最低版本先按候选上游要求 `>=22.20.0`；只有实际选择的上游包证据要求不同版本时才调整，并同步文档和验证记录。

## 1. 共享数据合同

所有内部对象使用明确字段，未核实事实使用 `null` 或 `problems`，不把失败转换为空数组。以下 JavaScript 数据仅表示内部合同，不是新的公共配置格式。

```js
const selection = {
  includes: [],
  skills: [{ source: 'example/kit', why: 'Project documentation', names: ['alpha', 'beta'] }]
};
const inventory = {
  items: [{
    name: 'alpha', target: 'codex', source: 'example/kit',
    path: '/tmp/project/.agents/skills/alpha',
    realPath: '/tmp/project/.agents/skills/alpha',
    digest: 'sha256:example', revision: null,
    agentLabels: ['Codex'], sharedTargets: ['codex'],
    problems: []
  }],
  problems: []
};
const state = {
  version: 1,
  entries: [{ source: 'example/kit', name: 'alpha', target: 'codex',
    digest: 'sha256:example', revision: null }]
};
const plan = {
  mode: 'init', selectionDigest: 'sha256:example',
  items: [{ source: 'example/kit', name: 'alpha', target: 'codex',
    why: 'Project documentation', observed: 'present', action: 'keep',
    evidence: ['matching source'], problems: [] }],
  extras: [], problems: []
};
```

内部身份使用 JSON 编码的元组，避免分隔符碰撞：

```js
function identity(source, name, target) {
  return JSON.stringify([source, name, target]);
}
```

选择中的 `names` 保留完整字符串；安装路径使用上游真实返回值。名称规范化后可能占用同一目录的两个技能也必须报冲突。实现该判断时对照选定上游的规范化规则做合同测试，不把原始名称直接拼成写入路径。

## Task 1: 隔离基线、保留自有源码并增加分发回归测试

**Files:**
- Inspect: `skills/skillsman-{agents-md,branch,next-prompt,readme}/` 与对应 `.agents/skills/`。
- Create: `test/package.test.cjs`。
- Modify: `package.json`、`.gitignore`（只在需要添加工作区忽略项时）。
- Source repair: 只在隔离工作区修复确实存在的自有目录问题；不提交第三方运行时链接。

**Interfaces:** 输入是六个自有技能的规范源码和 npm pack 文件清单；输出是分发完整性测试。不依赖后续模块。覆盖 A16。

- [ ] 检查是否已经处于 linked worktree；没有时按 using-git-worktrees 建立隔离工作区，分支使用 `codex/project-skill-initialization`。已确认设计包含隔离要求，无需重复请求同一项授权。
- [ ] 从当前已提交设计与计划开始。保存原工作区 `git status --short`；对四个自有链接目录分别比较已跟踪文件和额外文件。内容相同时隔离工作区直接使用 Git 中的实体源码；有额外用户内容时逐项迁入对应自有目录，记录来源，不复制第三方技能。
- [ ] 运行现有 `npm test` 和 `bash -n install.sh bin/skillsman`，记录基线。只调查实际失败，不把后续功能测试尚未存在视为失败。
- [ ] 新建 `test/package.test.cjs`，使用下面的实际包清单测试：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

test('package contains real first-party skill directories and their files', () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'skillsman-pack-'));
  try {
    const result = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--cache', cache],
      { cwd: root, encoding: 'utf8' }))[0];
    const packed = new Set(result.files.map(file => file.path));
    const names = ['agents-md', 'branch', 'manage', 'next-prompt', 'openspec', 'readme'];
    for (const suffix of names) {
      const dir = `skills/skillsman-${suffix}`;
      assert.equal(fs.lstatSync(path.join(root, dir)).isDirectory(), true, dir);
      assert(packed.has(`${dir}/SKILL.md`), dir);
      assert(packed.has(`${dir}/agents/openai.yaml`), dir);
    }
    assert(packed.has('skills/skillsman-readme/references/readme-quality-rubric.md'));
    assert(![...packed].some(file => file.startsWith('.agents/')));
  } finally {
    fs.rmSync(cache, { recursive: true, force: true });
  }
});
```

- [ ] 在临时副本中把一个自有目录替换为指向副本外实体目录的链接，运行测试，应失败于实体目录/包清单检查。恢复测试副本后应通过。不要为了证明红灯而修改原工作区的链接。
- [ ] 将 `package.json` 的 `scripts.test` 改为 `bash test/skillsman-cli.test.sh && node --test test/*.test.cjs`；阶段一不修改业务命令语义。新增生产模块后在任务 2 把 `lib/` 加入 `files`。
- [ ] 运行 `npm test`、`git diff --check`；提交本任务明确文件，提交说明 `test: verify first-party skill package contents`。

原工作区仍有用户既有链接时，这个提交是防回归和可靠分发基础，不可报告原目录已经修复。最终集成时另行对照最初状态应用已经验证的目录修复。

## Task 2: 上游合同、测试夹具与严格配置解析

**Files:**
- Create: `lib/skillsman/config.cjs`、`lib/skillsman/upstream.cjs`。
- Create: `test/helpers/project.cjs`、`test/fixtures/fake-npx.cjs`。
- Create: `test/config.test.cjs`、`test/upstream.test.cjs`。
- Modify: `package.json`、`.gitignore`；Create: `package-lock.json`。

**Interfaces:**
- `parseSelection(text) -> Selection`：验证并规范化，不访问文件。
- `readSelection(file) -> Selection`：读取后调用 parseSelection，缺失时报错。
- `serializeSelection(selection) -> string`：稳定 YAML，必须能往返。
- `mergeSelection(existing, addition) -> Selection`：重复项保留原理由，同名异来源报错。
- `parseSnapshot(text) -> {schema, targets}`：只接受当前 snapshot v1。
- `runSkills(project, args, options) -> Promise<{stdout, stderr}>`：默认超时 60 秒，可为实际安装显式传 120 秒；失败抛出包含操作与退出状态的错误。
- `listSkills(project, target) -> Promise<RawItem[]>`：JSON 数组验证；target 为 `all` 时不传 `--agent '*'` 给 list。
- `probeSelected(project, source, names) -> Promise<{items,problems}>`：在本次创建的临时项目中经上游安装明确选中的名称，再验证实际选择、来源和可读内容；不写目标项目。用于需要在覆盖前确认远程选择有效的更新，不把不稳定的人类列表文本当作可信 JSON。

- [ ] 先检查实际 npm 元数据与只读 CLI：

```bash
npm view skills@1.5.26 version engines --json
npm view yaml@2.8.3 version engines --json
npx --yes skills@1.5.26 --help
```

预期实际包支持所需 `add`、`list --json` 和目标参数。网络失败时记录未验证；这不妨碍编写离线测试，但不得宣称真实安装兼容。不要因候选版本不可获得而无声改用 latest。

- [ ] 使用 `npm install --save-exact yaml@2.8.3` 添加正式解析器；把 `lib/` 加入包清单，`.gitignore` 加入 `/node_modules/`，并记录 Node 最低版本 `>=22.20.0`。运行本地 checkout 的开发说明加入 `npm ci`。
- [ ] 将实际验证通过的上游包标识集中保存在 upstream 模块的单一常量中，初始候选为 `skills@1.5.26`；通过 `npx --yes <package> ...args` 执行。测试夹具必须先消费 npx 启动参数再验证语义参数；保留现有五项测试意图，更新其模拟器以接受版本化包名。实际未验证候选不得被标记为兼容版本。
- [ ] 实现测试辅助函数，使用下面的完整 `test/helpers/project.cjs`；夹具环境变量由具体测试传给 runCli，不改写系统 HOME。文件树摘要专门用于测试外部行为，不复用生产摘要函数。

```js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const cli = path.resolve(__dirname, '../../bin/skillsman');

function makeProject(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillsman-test-'));
  const project = path.join(root, 'project');
  fs.mkdirSync(project);
  const result = { path: project, root,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
  if (t) t.after(result.cleanup);
  return result;
}

function runCli(project, args, env = {}) {
  return spawnSync(cli, args, { cwd: project, encoding: 'utf8',
    env: { ...process.env, ...env }, timeout: 15000 });
}

function treeDigest(project) {
  const rows = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      const relative = path.relative(project, file);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) rows.push([relative, 'link', fs.readlinkSync(file)]);
      else if (stat.isDirectory()) { rows.push([relative, 'dir']); walk(file); }
      else if (stat.isFile()) rows.push([relative, 'file', fs.readFileSync(file).toString('base64')]);
      else rows.push([relative, 'special']);
    }
  }
  walk(project);
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

module.exports = { makeProject, runCli, treeDigest };
```
- [ ] 夹具按上游接口接受 `skills` 或测试指定的 `skills@版本` 包名。控制文件与调用日志放在项目外，避免污染预览只读测试。控制字段为 `catalog`、`listFailure`、`invalidJson`、`failSources`、`skipNames`。`catalog[source][name]` 包含正文、附属文件和可选 revision。
- [ ] 夹具的 `add` 必须创建真实 `.agents/skills/` 文件、按目标创建链接，并写合理的锁文件来源元数据；按完整参数数组记录调用。清单响应包含 `scope: 'project'`、实际路径、来源及显示名称。不得仅把名称存入一个全局数组。
- [ ] `test/config.test.cjs` 加入以下核心测试，再补表中的输入：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSelection, serializeSelection, parseSnapshot } = require('../lib/skillsman/config.cjs');

test('selection preserves complete names and has a stable round trip', () => {
  const input = 'includes: []\nskills:\n  - source: example/kit\n    why: Project writing\n    names:\n      - "Name With Spaces"\n      - beta\n';
  const result = parseSelection(input);
  assert.deepEqual(result.skills[0].names, ['Name With Spaces', 'beta']);
  assert.deepEqual(parseSelection(serializeSelection(result)), result);
});

test('missing names and missing snapshot schema are rejected', () => {
  assert.throws(() => parseSelection('includes: []\nskills:\n  - source: example/kit\n    why: Writing\n'));
  assert.throws(() => parseSnapshot('targets:\n  codex:\n    skills: []\n'));
});
```

配置矩阵：空列表合法；缺文件、空 names、通配符、重复 YAML key、未知字段、非字符串 source/why/name、anchors、aliases、显式 tags、多文档均报错；单引号、双引号和包含冒号/井号的合法引用字符串保持完整。控制字符及可被解释为命令选项的名称/来源不得进入进程参数。

- [ ] 解析入口使用语法树检查，而不是先丢弃语法信息再检查普通对象。可直接使用下面的入口代码，并在本模块实现 `validateSelection` 的字段/身份规则：

```js
const YAML = require('yaml');

function parseDocument(text) {
  const docs = YAML.parseAllDocuments(text, { uniqueKeys: true, strict: true });
  if (docs.length !== 1 || docs[0].errors.length) {
    throw new Error('Expected one valid YAML document');
  }
  YAML.visit(docs[0], (_key, node) => {
    if (YAML.isAlias(node) || node?.anchor || node?.tag) {
      throw new Error('Anchors, aliases and explicit tags are not supported');
    }
    if (node?.flow && node?.items?.length) {
      throw new Error('Use block collections; only empty flow collections are supported');
    }
  });
  return docs[0].toJS({ maxAliasCount: 0 });
}
```

`validateSelection` 必须逐层检查对象 key 集合、数组和非空字符串；规范化按首次出现顺序合并来源和名称；不同来源的同名或同安装目录身份拒绝。现有场景的省略 names 规则在 scenario 读取入口独立保留，不能套用项目清单限制。

- [ ] 上游调用使用参数数组和 `shell: false`，不拼接命令字符串；stderr 单独保留。进程超时要终止本次创建的进程组并等待回收，不能只杀 shell 后留下安装器继续修改项目。SIGINT/SIGTERM 也必须清理子进程，不杀调用者或其他任务。
- [ ] `probeSelected` 为每个来源建立独立临时项目，只安装请求名称。相对本地来源先按调用者项目解析为绝对输入，仅用于本次调用，不能把临时路径写回可复用清单。验证后返回来源、名称及临时内容观察结果，并在 finally 清理临时目录；来源不存在、上游跳过名称或多装未请求项均返回问题。它不把临时安装正文复制到目标项目，目标写入仍使用上游安装器。
- [ ] 上游合同测试至少覆盖：非零退出、损坏 JSON、对象而非数组、超时子进程、完整含空格名称、未知 target 原样传递、`all` 清单不传无效星号过滤。
- [ ] 执行 `node --test test/config.test.cjs test/upstream.test.cjs`，再运行 `npm test`；预期全部通过；提交 `feat: add strict config and upstream contracts`。

## Task 3: 统一库存扫描并修复快照

**Files:**
- Create: `lib/skillsman/inventory.cjs`、`test/inventory.test.cjs`、`test/snapshot.test.cjs`。
- Modify: `bin/skillsman` 的库存及快照调用点、`lib/skillsman/config.cjs`。

**Interfaces:**
- `readInventory(project, targets, upstream) -> Promise<Inventory>`，`upstream.listSkills` 为任务 2 接口。
- `scanSkillDirectory(directory) -> Array<{path,realPath,name,problems}>`，缺少目录返回空集合；读取错误抛出；断链作为明确问题返回。
- `readSourceEvidence(project) -> map`：原始 `skills-lock.json` 缺失可用空 map，存在但损坏/不可读必须抛出。
- `snapshotInventory(inventory, targets) -> snapshot v1`，来源不明或扫描问题时拒绝保存。

覆盖 A08、A09、A12、A13、A18。

- [ ] 写实体目录与软链接的回归测试，引用任务 2 的 `makeProject`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeProject } = require('./helpers/project.cjs');
const { scanSkillDirectory } = require('../lib/skillsman/inventory.cjs');

test('scan includes a symlinked skill and reports a broken link', () => {
  const project = makeProject();
  try {
    const canonical = path.join(project.path, '.agents/skills/alpha');
    const links = path.join(project.path, '.claude/skills');
    fs.mkdirSync(canonical, { recursive: true });
    fs.mkdirSync(links, { recursive: true });
    fs.writeFileSync(path.join(canonical, 'SKILL.md'), '---\nname: alpha\ndescription: Example\n---\n');
    fs.symlinkSync('../../.agents/skills/alpha', path.join(links, 'alpha'));
    fs.symlinkSync('../../missing', path.join(links, 'broken'));
    const rows = scanSkillDirectory(links);
    assert(rows.some(row => row.name === 'alpha' && row.realPath === fs.realpathSync(canonical)));
    assert(rows.some(row => row.problems.length > 0 && row.path.endsWith('/broken')));
  } finally { project.cleanup(); }
});
```

统一 helper 约定：`makeProject()` 也支持不传测试上下文，返回 `{path,cleanup}`；传入 `t` 时自动注册清理。同一 helper 不引入第二种 fixture 格式。

- [ ] 先运行测试确认现有行为或缺失模块导致失败，随后实现：对一级条目使用 `lstat`，对目录和链接调用 `realpath`/`stat`；直接验证 `<skill>/SKILL.md`，禁止用 `find -type d` 忽略链接。读取 frontmatter 的 name 作为逻辑名称，目录名只作为辅助证据。
- [ ] 先读并验证原始锁文件，再批量取得过滤后的目标库存；为共享关系额外读取一次未过滤项目库存。不能根据不带过滤的结果声称某目标已经安装，也不能给每个技能执行一次 list。
- [ ] 已知本地目录只维护现有 Codex/Claude/Cursor 映射；其他目标使用上游证据。来源 URL 的归一化只接受已核实的等价形式，保留 subpath/ref；无法证明等价就返回冲突/未知，不能把所有同仓库路径当成同一来源。
- [ ] 快照保存必须先完成全部扫描与来源解析，再写输出。使用 `YAML.stringify` 写严格 v1；输入 schema 必须存在且完全匹配，禁止混读选择清单。旧名称与目标别名保持现有规范化。
- [ ] 扩展集成测试：实体与链接目标均捕获 1 个技能；断链、来源未知和锁损坏均非零退出且不覆盖既有输出；空目标可输出空 skills；缺 schema 的 apply 在调用上游前失败。
- [ ] `bin/skillsman` 库存检查调用模块输出明确三态：存在、缺失、读取失败。调用方不得把后者作为普通 false 进入安装。清理所有相关 `|| printf '[]'` 和 JSON catch 返回 0 的路径。
- [ ] 运行 `node --test test/inventory.test.cjs test/snapshot.test.cjs`、`npm test`、Bash 语法检查；提交 `fix: verify linked skill inventories and snapshots`。

## Task 4: 安装内容基线与纯计划器

**Files:**
- Create: `lib/skillsman/state.cjs`、`lib/skillsman/plan.cjs`。
- Create: `test/state.test.cjs`、`test/plan.test.cjs`。

**Interfaces:**
- `digestSkill(directory) -> string`：只返回可信稳定摘要，异常抛出。
- `readState(file) -> State`：缺失返回 `{version:1,entries:[]}`；存在但格式错误抛出。
- `writeAtomic(file, text, expectedDigest) -> void`：同目录临时文件、比对预期旧摘要、重命名；目标出现外部变化则拒绝。
- `buildPlan({mode,selection,inventory,state,targets,selectionDigest}) -> Plan`：纯函数，mode 为 init/add/update。
- `identity(source,name,target)` 使用第 1 节定义。

覆盖 A05–A07、A11、A13、A18、A20。

- [ ] 写内容基线回归测试：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeProject } = require('./helpers/project.cjs');
const { digestSkill } = require('../lib/skillsman/state.cjs');

test('digest changes when a reference changes but ignores timestamps', () => {
  const project = makeProject();
  try {
    const dir = path.join(project.path, 'alpha');
    fs.mkdirSync(path.join(dir, 'references'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), 'alpha');
    const ref = path.join(dir, 'references/example.md');
    fs.writeFileSync(ref, 'before');
    const first = digestSkill(dir);
    fs.utimesSync(ref, new Date(0), new Date(0));
    assert.equal(digestSkill(dir), first);
    fs.writeFileSync(ref, 'after');
    assert.notEqual(digestSkill(dir), first);
  } finally { project.cleanup(); }
});
```

- [ ] 摘要算法：先解析顶层技能目录；递归收集目录内普通文件和内部链接，按稳定相对路径排序。每个记录使用相对路径长度、路径字节数、文件长度和文件字节构成无歧义输入，计算 SHA-256。合法内部链接的链接目标和内容都参与摘要；链接越界、循环、特殊文件和读取期间变化报错；不把时间戳计入摘要。扫描前后检查读取一致性，不声称抵抗不遵守项目锁的恶意并发写入。
- [ ] `readState` 严格校验 version、身份字段、digest 和 entries 去重。不要把读错/损坏 state 当成空基线，也不要在普通 status 中自动修复用户文件。
- [ ] `buildPlan` 按设计状态表实现；计划中的问题使用明确 code：`SOURCE_CONFLICT`、`SOURCE_UNKNOWN`、`INVENTORY_ERROR`、`LOCAL_MODIFIED`、`BASELINE_UNKNOWN`、`SHARED_IMPACT`。初始化允许同来源无基线的 keep，更新则阻断该项。extras 是库存存在但选择未包含的项，不生成删除动作。
- [ ] 计划器以逐行测试锁住关键行为。下列 fixture 是完整最小输入，测试只改变观察条件：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPlan } = require('../lib/skillsman/plan.cjs');
const selection = { includes: [], skills: [{ source: 'example/kit', why: 'Docs', names: ['alpha'] }] };

test('update blocks modified content while init preserves it', () => {
  const input = {
    selection, targets: ['codex'], selectionDigest: 'sha256:selection',
    inventory: { items: [{ source: 'example/kit', name: 'alpha', target: 'codex',
      digest: 'sha256:changed', realPath: '/tmp/alpha', sharedTargets: ['codex'], problems: [] }], problems: [] },
    state: { version: 1, entries: [{ source: 'example/kit', name: 'alpha', target: 'codex', digest: 'sha256:original', revision: null }] }
  };
  const init = buildPlan({ ...input, mode: 'init' });
  assert.equal(init.items[0].action, 'keep');
  const update = buildPlan({ ...input, mode: 'update' });
  assert(update.items[0].problems.some(problem => problem.code === 'LOCAL_MODIFIED'));
});
```

- [ ] 补齐表驱动用例：缺失、同名异源、未知来源、无基线、锁损坏、共享目录、额外项、空选择、空目标、两个名称规范化到同一目录、含空格名称、多个目标分别缺失。失败计划保留完整问题清单，但不得出现会被执行的隐式覆盖动作。
- [ ] 原子写入测试让预期摘要在写入前发生变化，必须拒绝且保留新文件；确保临时文件只由本次操作清理。
- [ ] 运行 `node --test test/state.test.cjs test/plan.test.cjs`、`npm test`；提交 `feat: plan skill changes from verified installation state`。

## Task 5: 清单预览、初始化、部分添加与可重试执行

**Files:**
- Create: `lib/skillsman/project.cjs`、`test/project.test.cjs`。
- Modify: `bin/skillsman`、`lib/skillsman/state.cjs`。

**Interfaces:**
- `parseProjectArgs(mode,args) -> {project,targets,file,dryRun,allowSelfInstall}`：init/add/plan 支持 --file；update 接口在任务 7 接入。
- `runProjectCommand(mode,args) -> Promise<number>`：只在主入口设置退出码，导出函数便于测试。
- `withProjectLock(project,fn) -> Promise<result>`：持有自己创建的锁期间执行 fn；释放自己的锁。
- `executePlan(context) -> Promise<{installed,kept,failed,problems}>`：context 包含已解析 selection、plan、库存和上游适配器；内部重新验证计划。

覆盖 A01–A03、A05–A07、A10–A14、A18、A20。

- [ ] 先写 CLI 红灯测试：`plan --file` 返回只读预览；`init --file` 只安装 alpha/beta；第三个同套件技能 gamma 不出现；重跑零 add；额外技能文件摘要不变；A 清单在 B 使用不含 A 的路径或状态。
- [ ] `parseProjectArgs` 支持 `--flag value` 与现有 `--flag=value` 风格；缺值、未知参数、重复互斥输入、混合 all/具体目标报错。目标复用现有规范化规则，未知标识不猜目录。缺少目标不能默认 Codex。项目根目录用 realpath 与 Skillsman 根目录比较，保留自安装保护。
- [ ] Bash 新入口只负责精确分发，识别 `--file` 时处理整个参数 token，而不是对子串做模糊匹配；`--project=/tmp/has--file` 不能误走新路径。场景名和 --file 同时出现必须拒绝。现有场景路径仍交给原有参数入口。
- [ ] 编排顺序固定为：解析参数 → 读取/合并选择 → 检查目标原清单 → 读取库存和状态 → 计算计划 → 显示问题 → 预览返回或取得项目锁 → 重读输入/库存并比较 → 保存经授权的选择 → 执行分组 → 逐项验证并保存成功记录 → 汇总。
- [ ] 项目锁使用原子 mkdir。锁元数据包含本次 operation id 和 pid；释放时匹配自己创建的 id，已有锁不能自动抢占或删除。异常/SIGINT 清理本次锁并终止本次子进程；预览不创建 `.skillsman/`。
- [ ] 分组只包含本次缺失的具体名称，调用上游 add 时必须传来源、完整 names 数组、明确目标和非交互标志。多个共享目标同一实体内容只安装一次后验证各目标关联；不能通过反复覆盖实体目录来补链接。
- [ ] 每组退出后重新读取库存，即使上游非零退出也检查该组是否有部分成功；只给可验证项写基线。失败项保留在选择意图中，非零退出，下一次初始化只补缺失项。
- [ ] 对本次安装引起的基线更新，验证来源和实际路径；“命令返回 0 但文件缺失”必须失败。已有无基线的 keep 项不能被顺手写成可信安装基线。
- [ ] 对 `.skillsman/skills.yaml` 和 state 检测外部修改：写入前验证期望摘要，在持锁下使用同目录临时文件重命名。项目锁仅协调 Skillsman 进程，外部工具仍可能并发写；检测到变化返回需重试，不能声称提供跨工具事务隔离。
- [ ] 建议锁包装代码如下，补充 signal 的注册/注销须在本模块统一处理，不能每个 helper 重复安装监听器：

```js
async function withProjectLock(project, fn) {
  const fs = require('node:fs');
  const path = require('node:path');
  const crypto = require('node:crypto');
  const parent = path.join(project, '.skillsman');
  const lock = path.join(parent, 'operation.lock');
  fs.mkdirSync(parent, { recursive: true });
  fs.mkdirSync(lock);
  const id = crypto.randomUUID();
  const marker = path.join(lock, 'owner.json');
  try {
    fs.writeFileSync(marker, JSON.stringify({ id, pid: process.pid }), { flag: 'wx' });
    return await fn();
  } finally {
    if (fs.existsSync(marker)) {
      const owner = JSON.parse(fs.readFileSync(marker, 'utf8'));
      if (owner.id === id) fs.rmSync(lock, { recursive: true });
    }
  }
}
```

补充锁测试：已有锁立即拒绝；正常/异常释放自身锁；marker 创建失败也释放本次刚创建的空锁；marker 被外部替换时不删除新所有者锁；不自动处理 stale lock。上述补充是本任务验收必需，不以示例成功路径替代错误处理。

- [ ] 使用 fake-npx 的第二来源失败、成功但 skipNames、list 错误注入完成集成矩阵。对全部预览用 `treeDigest` 比较目标目录前后；状态文件、锁文件与上游锁内容均不得改变。
- [ ] 执行 `node --test test/project.test.cjs`、`npm test`、Bash 语法检查；提交 `feat: initialize and reuse explicit project skill selections`。

## Task 6: 场景展示、旧入口一致性与管理技能首次使用

**Files:**
- Modify: `bin/skillsman` 的 show/status 和现有场景安装验证。
- Modify: `skills/skillsman-manage/SKILL.md`、`skills/skillsman-manage/references/scenario-mapping.md`、`skills/skillsman-manage/agents/openai.yaml`（仅实际描述变化时）。
- Modify: `README.md`、`README.zh-CN.md`。
- Create: `test/entrypoints.test.cjs`。

**Interfaces:** 场景继续使用现有输入格式；show 增加 why 的人类展示，内部不解析 show 文本；status 使用任务 3 的库存和任务 4 的选择对照。覆盖 A03、A13、A15–A18。

- [ ] 添加回归测试：原 `show workflow` 仍列出所有请求来源/名称，并显示 why；显式全量来源仍使用上游全量 add；`--target all` 与 `all` 场景不会互相混淆。
- [ ] 将场景的内部展开结果改成结构化条目或直接调用 config，不依赖 `source | name1 name2` 作为新清单流程的解析接口。原场景路径也应传播库存错误和验证安装结果，避免新路径可靠而原路径继续吞错。
- [ ] 保留场景文件省略 names 的含义。全套已满足时跳过；全部缺失且候选身份可核实时才使用全量 add；已有与缺失混合而上游不能保留已有内容时，安装前返回原因并建议明确选择清单。不能为了保留老调用形式覆盖本地内容。仅当可以取得本次完整名称及来源证据时，才把显式整库请求固化为项目选择；不能拿安装前后“数量差”推断完整选择。证据不足时安装结果和“无法保存可复用清单”分别报告。
- [ ] 管理技能替换为以下完整的推荐与启动说明，其他精确参数示例同步任务 5 接口：

```text
Read the current project instructions and the user's actual task before selecting skills.
Use existing scenarios as candidate sources, not as mandatory installation bundles.
Read real skill names from the requested sources; if discovery fails, report it and do not install the whole source as a fallback.
Propose a minimal list of explicit skill names, sources, reasons, and observed installed state.
Reuse the target, selection, and authorization already provided in this conversation.
Use `skillsman plan --file <selection> --target <target> --project <project>` to inspect the proposed change.
For authorized installation, use `skillsman init --file <selection> --target <target> --project <project>` or `add --file` for additions.
Prefer a compatible `skillsman` on PATH, then a repository explicitly supplied by the user, then the GitHub-hosted npx entry documented by this project.
Verify required command support before execution. Do not rely on a maintainer-specific absolute path or install a global CLI automatically.
Preserve unrelated skills and local edits. Report source conflicts and unknown evidence before any overwrite.
Report actual installed, kept, failed, and unverified items. Installation verification is not proof of runtime activation or task-quality improvement.
```

- [ ] 为第三方技能候选枚举确定可执行入口：管理技能允许只读 `npx skills add <source> --list` 或直接读取用户提供仓库的 SKILL.md；安装仍必须经 Skillsman。同步移除与这项只读操作冲突的“任何情况禁止直接调用 npx skills”旧措辞；不能为了枚举增加第二个安装器。
- [ ] 两份 README 增加同一条“只选两项 → plan → init → 新项目复用”的可复制流程；明确 `npm ci`、最低 Node、GitHub-hosted 入口、安装管理 skill 不等于 CLI 已在 PATH。
- [ ] 清单与快照的区别、来源未知状态、仅 Codex 完整验证范围、机器 state 忽略建议都写进相关段落。CLI 不自动改用户 `.gitignore`。
- [ ] 执行 `node --test test/entrypoints.test.cjs`、`npm test`、`skillsman list/show/coverage`；检查六个自有 frontmatter 名称与目录一致；提交 `feat: guide minimal skill selection and portable setup`。

## Task 7: 用户发起的范围化内容更新

**Files:**
- Modify: `lib/skillsman/project.cjs`、`lib/skillsman/upstream.cjs`、`lib/skillsman/plan.cjs`、`bin/skillsman`。
- Create: `test/update.test.cjs`。
- Modify: `README.md`、`README.zh-CN.md`、`skills/skillsman-manage/SKILL.md`。

**Interfaces:** `runProjectCommand('update', args)` 要求项目选择及明确 targets。预览输出 includes source/name/target/local baseline/remote comparison status；执行只处理清单内且来源、基线可信的项。覆盖 A04、A05、A07、A11、A14、A18、A19。

- [ ] 先写集成测试：初始化 alpha/beta 后，在夹具同来源新增 gamma；更新只处理 alpha/beta。项目额外 delta 不被调用。修改 alpha 的 reference 或删除其基线后，整个覆盖计划在安装前被阻断。
- [ ] 缺目标、缺清单、损坏清单、清单缺失技能、来源移除所选技能分别给明确错误；不使用当前的 `npx skills update -p -y` 作为 fallback。
- [ ] 更新预览先验证本地来源、基线、共享影响，再用 `probeSelected` 在临时项目核实所选名称与内容。`--dry-run` 不在目标项目重新安装。若仅得到可信名称存在证据而无法比较内容，只显示“上游内容差异未核实”；无法证明名称存在时阻断，不伪造“发现新版本”或“已是最新”。
- [ ] 普通显式 `update` 授权可在已确认技能集合内重新取得当前内容，输出操作为“重新获取所选内容”，不能在没有 diff 证据时称为“仅更新已变化内容”。无需为已给出的更新授权重复确认。
- [ ] 通过适配器的明确来源+名称+目标 add 调用实现定向重新获取，保留上游的真实安装职责。整个来源不能全量更新。安装前先验证名称在上游仍存在；无法证明时报告未核实，不用其他名称替代。
- [ ] 同一实体路径关联了不在本次目标范围内的 Agent 时，预览必须列出影响并返回 `SHARED_IMPACT`；用户扩大明确目标后才能覆盖。不声称 Agent 目录不同就内容隔离。
- [ ] 更新退出后再次扫描，并验证选择集合没有扩大、本地记录对应实际内容。单组部分失败与初始化采用相同记录规则；失败的旧基线不能被新摘要覆盖。
- [ ] 临时观察与正式安装之间上游可能变化。若可以使用已核实的不可变来源引用，适配器优先在本次操作内使用该引用；无法固定时明确这是重新获取当前内容。安装后内容与临时观察不同则报告漂移、停止后续组并返回非零，不宣称原预览被逐字执行，也不执行自动回滚。
- [ ] 增加快照不等于回滚的提示，并同步新的 update 参数要求。保持项目清单的理由和名称顺序，不因内容更新改写用户意图。
- [ ] 执行 `node --test test/update.test.cjs`、`npm test`、Bash 语法检查；提交 `feat: update only explicitly selected project skills`。

## Task 8: 分发包、真实上游与最终验收

**Files:**
- Create: `test/smoke-real-upstream.sh`、`docs/verification/project-skill-initialization.md`。
- Modify: `test/package.test.cjs`，扩展模块/引用文件完整性检查。
- Modify: `package.json`，仅加入手动 `test:smoke`，不把真实网络测试放入默认 `npm test`。

**Interfaces:** 以实际 `npm pack` 产生的包和明确版本上游执行；所有项目、安装前缀及缓存处于本次临时目录。输出验证记录，不发布包、不推送或部署。覆盖所有 A01–A20。

- [ ] 包测试检查每个生产 `lib/skillsman/*.cjs` 都被打包，技能 references/agents 完整；不依赖源码工作区的 `.agents`、插件缓存或全局安装。
- [ ] 烟测脚本使用 `mktemp -d`、EXIT trap 和明确子目录。先实际打包到临时目录，再通过临时 npm prefix 安装包；不要直接运行源码 CLI 冒充分发安装验证。
- [ ] 在第一个临时项目对包内自有技能生成显式两项清单，通过已安装包的 CLI 预览、安装、验证幂等与快照；实际上游使用已核实版本。再复制清单到第二项目并验证选择相同、状态独立。
- [ ] 对远程 `YatMn/skillsman` 的枚举/安装另做只读来源核对和两项安装验证，避免本地来源烟测被当成远程安装测试。网络不可用时保留离线通过结果，并把对应真实烟测标记未验证。
- [ ] 每项 smoke 输出使用的包版本、Node/npm/上游版本、来源、目标、实际命令、退出状态及摘要。不要保存凭据、完整环境或用户项目内容。
- [ ] 运行以下最终检查；只有全部所需检查得到真实结果后才报告完成：

```bash
npm test
bash -n install.sh bin/skillsman test/smoke-real-upstream.sh
./bin/skillsman list
./bin/skillsman show workflow
./bin/skillsman coverage
git diff --check
npm pack --dry-run
npm run test:smoke
```

- [ ] 检查实际 diff：只包含计划要求的源码、测试、文档和依赖；未提交用户技能链接或其他项目内容。独立代码审查关注 preflight 阻断、共享目录覆盖、部分失败基线以及预览写入，修复实际问题后只重跑相关检查。
- [ ] 填写验证记录，按 A 编号逐项链接测试和运行结果。未运行项明确写“未验证”并说明条件，不能留空或标通过。
- [ ] 提交 `test: verify packaged project skill workflows`。提交与完成不代表已经发布；不自行发布 npm、推送或合并主分支。

## 2. 验收追踪与阶段交付

| 验收编号 | 负责任务 | 必须观察的结果 |
| --- | --- | --- |
| A01 | 5、8 | 只安装两项 |
| A02 | 5、8 | 重复执行零新增、无额外写入 |
| A03 | 5、6、8 | 独立项目复用，原清单不变 |
| A04 | 7、8 | 来源新增项不自动进入项目 |
| A05 | 4、5、7 | 清单外内容不变 |
| A06 | 2、4、5 | 来源/目录身份冲突先阻断 |
| A07 | 4、5、7 | 本地变化与无基线保护 |
| A08 | 3、8 | 实体/链接准确，断链有错误 |
| A09 | 2、3、5 | 库存失败不等于空集合 |
| A10 | 5、7 | 部分成功可验证，失败可重试 |
| A11 | 4、5、7 | 所有预览不改项目 |
| A12 | 2、3、5 | 严格清单及现有快照格式 |
| A13 | 3、4、6 | 状态以实际证据为准 |
| A14 | 5、7、8 | 来源移除不触发全量替代 |
| A15 | 6、8 | 新用户入口可运行 |
| A16 | 1、6、8 | 包内源码和附属文件完整 |
| A17 | 5、6 | 原场景全量语义保留 |
| A18 | 3、4、5、7、8 | 已验证目标和共享影响明确 |
| A19 | 7 | 缺目标/清单不全项目更新 |
| A20 | 2、4、5 | 空选择无操作，竞争不覆盖 |

阶段一在任务 1–3 完成：可验证分发及库存/快照基础。阶段二在任务 4–6 完成：部分选择、预览、初始化和跨项目复用完整可用。阶段三在任务 7–8 完成：范围化更新及最终分发验收。

每个任务执行红灯 → 最小实现 → 绿灯 → diff 审查 → 独立提交。代码审查后出现新修改，重跑受影响测试；没有新风险时不反复扩大测试范围。

## 3. 执行交接

建议在当前任务中从任务 1 开始，保持任务间依赖顺序。可使用独立 sub-agent 做有清楚边界的任务或代码审查；不要并行修改共享 CLI 和模型合同，也不要创建新的用户任务代替子代理。

实施无需再次讨论已批准的产品方向。遇到新的覆盖冲突、实际上游无法支持必要合同或自动批准审查拒绝时，先完成不受影响的工作，再报告具体证据及需要用户决定的事项。
