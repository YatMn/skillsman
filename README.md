# skillsman

[![skills.sh](https://skills.sh/b/yatmn/skillsman)](https://skills.sh/yatmn/skillsman)

English | [简体中文](README.zh-CN.md)

Skillsman helps you choose specific agent skills, initialize a project without
replacing existing work, and reuse that choice in another project. Scenarios
provide candidates; a saved selection names the skills you actually want.

The repository contains installable `skillsman-*` skills, scenario definitions,
a Bash entrypoint, and Node.js modules. Installation is delegated to the pinned
upstream package `skills@1.5.26`; YAML parsing uses `yaml@2.8.3`.

Maintainer: YatMn <yatmn@outlook.com>

## What It Does

- Previews explicit selections with sources, reasons, observed state and actions.
- Installs missing selected skills and preserves unrelated skills and local edits.
- Saves an independent selection for each project, reusable across projects and agents.
- Refreshes only saved selections when you explicitly request an update.
- Captures and applies target-specific snapshots of installed names and sources.

Skillsman does not install global skills. Mutating installation commands refuse
to target this repository unless `--allow-self-install` is explicit. Codex is the
primary validation target; accepting another upstream agent ID does not establish
complete validation or isolation for that agent.

## Quick Start

Use Node.js **>=22.20.0**, npm/npx and Bash. In a local checkout, install the
Node dependencies before invoking the CLI or installing its symlink:

```bash
npm ci
./bin/skillsman --help
```

The [example selection](examples/selection.yaml) chooses just two bundled skills:

```yaml
includes: []
skills:
  - source: YatMn/skillsman
    why: Keep project instructions and README accurate.
    names:
      - skillsman-agents-md
      - skillsman-readme
```

Choose an existing destination project, then preview and initialize it:

```bash
./bin/skillsman plan --file examples/selection.yaml --target codex --project /path/to/project
./bin/skillsman init --file examples/selection.yaml --target codex --project /path/to/project
```

These commands resolve the selected source's current content. They do not install
its other skills. `plan` reads inventory without changing destination project
files. `init` saves an independent `.skillsman/skills.yaml` and verifies installed
content; repeating the same initialization keeps matching existing skills.

Reuse the saved choice in another existing project, optionally for another agent:

```bash
./bin/skillsman plan --file /path/to/project/.skillsman/skills.yaml --target cursor --project /path/to/another-project
./bin/skillsman init --file /path/to/project/.skillsman/skills.yaml --target cursor --project /path/to/another-project
```

The input file is only read. Editing the second project's selection does not
change the first project's choice or copy its machine state.

To expose the checkout's CLI on PATH after `npm ci`:

```bash
./install.sh
```

This creates `~/.local/bin/skillsman`; ensure that directory is on PATH. It is a
link to this checkout, not an installation of its Node dependencies or skills.
The remaining examples use that `skillsman` command.

The GitHub-hosted entrypoint is also available as a launch mechanism:

```bash
npx github:YatMn/skillsman --help
```

Check that the fetched revision exposes `plan --file` and `init --file` before
using it for this workflow; a remote revision may differ from your local checkout.

## Recommended Setup

You can bootstrap the management skill separately:

```bash
npx --yes skills@1.5.26 add YatMn/skillsman --skill skillsman-manage --agent codex
```

Installing this skill does not put the Skillsman CLI on PATH. It guides selection
and uses a compatible CLI; verify the entrypoint as described above.

```text
Use $skillsman-manage to help initialize skills for this repository.
Target: codex
Project path: current repository
Read the project instructions, existing skills and actual tasks. Recommend a
minimal list of named skills with sources and reasons, and preview it before
installation. Reuse any selection and authorization already given in this task.
```

Use scenarios as candidate lists, inspect real source skill names, and choose
only the skills needed. Source discovery failure must be reported rather than
converted into a full-source installation.

## Selection and Local State

| File | Meaning |
| --- | --- |
| `.skillsman/skills.yaml` | Reusable choice: sources, reasons and explicit names; no target agent or installation baseline. Suitable for Git. |
| `.skillsman/state.json` | Local verified installation records: source, name, target, content digest and nullable revision. Do not copy as another project's baseline. |
| `skills-lock.json` | Upstream-managed source evidence; not a selection file or a file Skillsman rewrites. |

Add `.skillsman/state.json` to the target project's `.gitignore`. Skillsman does
not edit `.gitignore` automatically. Digests include skill files, references,
scripts, agent metadata and contained links; they do not contain a backup copy.

A selection requires `includes: []`, a `skills` list, nonempty `source` and `why`,
and explicit nonempty `names` per source. `skills: []` is valid and installs
nothing; a missing file is an error. Names with spaces remain whole strings.
Wildcards, YAML anchors/aliases/tags, multiple documents, nonempty flow
collections, unknown fields, control characters and option-like source/name
values are rejected. Use block lists and quoted strings where needed.

Identical source/name pairs deduplicate. Merging the same source retains its
first reason. Different sources or names that collide at the installation
directory are errors. Local source paths are resolved relative to the destination
project for comparison and installation; they are not rewritten in the manifest.

```bash
skillsman plan --file /path/to/selection.yaml --target codex --project /path/to/project
skillsman add --file /path/to/additions.yaml --target codex --project /path/to/project
```

`plan` previews the file supplied to it. `add --file` merges into the saved choice
and checks that merged result before installing. `init --file` refuses a different
existing selection: edit it intentionally or use `add --file`. A scenario and
`--file` cannot be combined; `init` and `add` do not accept `--dry-run`.

Preflight conflicts stop installation. If execution later partially fails,
verified successes and the saved choice remain, the command exits nonzero, and
initialization can be retried to fill missing items. Removing a skill with
`remove` leaves the saved choice unchanged; edit that choice separately if it
should no longer be selected.

## Scoped Updates

`update` requires explicit targets and an existing `.skillsman/skills.yaml`.
It checks sources, local content baselines and shared-agent impact before
refreshing selected names. It never falls back to a whole-project update.

```bash
skillsman update --target codex --project /path/to/project --dry-run
skillsman update --target codex --project /path/to/project
```

A preview can fetch selected source content into a temporary project without
changing the destination. An update re-fetches selected content; it does not
necessarily mean that a newer version was found. Missing skills, unknown sources,
unverified baselines, local changes, broken links or unresolved sharing block
the affected plan. Initialization can preserve existing unverified content, but
that does not create a trusted update baseline.

Codex skills under `.agents/skills` can be associated with the universal-agent
IDs `antigravity,codex,cursor,gemini-cli,github-copilot,zed`. Thus an update with
only `--target codex` can return `SHARED_IMPACT`. Review the reported associations
and explicitly include every affected target before updating, for example:

```bash
skillsman update --target antigravity,codex,cursor,gemini-cli,github-copilot,zed --project /path/to/project --dry-run
skillsman update --target antigravity,codex,cursor,gemini-cli,github-copilot,zed --project /path/to/project
```

Additional linked agents must also be included when reported. To authorize
refreshing all known existing associations of the selected skills, use:

```bash
skillsman update --target all --project /path/to/project --dry-run
skillsman update --target all --project /path/to/project
```

For updates, `all` resolves to concrete existing target IDs, grouped by skill and
source. It does not pass `--agent '*'` or install the selection for new agents.
Unknown associations still block verification. Shared labels indicate filesystem
associations, not proof that each agent has run the skill.

There is no automatic tracking, background update or propagation between
projects. New skills added to a source do not enter an existing selection.
Selections, digests and snapshots do not restore exact historical content.

## Bundled Skills

| Skill | Purpose |
| --- | --- |
| `skillsman-agents-md` | Create or improve repository agent instruction files such as `AGENTS.md`. |
| `skillsman-branch` | Create, inspect, sync, and govern Git/GitHub branches using a main/develop/release model. |
| `skillsman-manage` | Manage project skills: inspect, initialize, add, remove, update, snapshot, apply, and diagnose. |
| `skillsman-next-prompt` | Create concise continuation, handoff, or fresh-session prompts for Codex. |
| `skillsman-openspec` | Install, initialize, update, and operate OpenSpec spec-driven workflows. |
| `skillsman-readme` | Create or update practical software-repository README documentation. |

Each bundled skill lives under `skills/<skill-name>/`. The directory name,
`SKILL.md` frontmatter `name`, and `agents/openai.yaml` metadata should stay in
sync.

## Scenarios

| Scenario | Use case |
| --- | --- |
| `workflow` | Planning, branching, review, publish, OpenSpec, README, and repository workflow skills. |
| `web-app` | Frontend, React, Next.js, UI, and browser app testing. |
| `deployment` | Hosted web app deployment, env vars, functions, runtime, and verification. |
| `database` | Supabase, Postgres, and storage. |
| `research` | Web research and knowledge extraction. |
| `writing` | Writing, docs, editing, office files, scripts, meetings, data, and slides. |
| `design` | Visual design, brand assets, themes, artifacts, and generated images. |
| `all` | Audit/test aggregate only. Do not use for real projects. |

Inspect scenario candidates and their reasons:

```bash
skillsman show workflow
skillsman show web-app
```

An explicitly requested scenario can still be installed:

```bash
skillsman init workflow --target codex --project /path/to/project
skillsman add writing --target codex,cursor --project /path/to/project
```

Scenarios use `includes` and `skills` entries with `source`, `why` and optional
`names`. Omitting `names` explicitly requests the whole source. Skillsman must
enumerate its names before saving a reusable choice. A full-source request with
both existing and missing skills is blocked if it would overwrite existing work;
use an explicit file selection to fill only the missing items. `scenarios/all.yaml`
is an audit aggregate, and `init all` / `add all` are rejected.

## Targets

| Target | Behavior |
| --- | --- |
| `codex`, `cursor`, `openclaw`, `antigravity` | Uses the corresponding upstream agent ID. |
| `claude`, `claude-code` | Normalizes to `claude-code`. |
| `gemini`, `gemini-cli` | Normalizes to `gemini-cli`. |
| `github-copilot`, `zed` | Recognized upstream inventory labels; may share universal skill content. |
| `all` | Meaning depends on the command: inspect all project agents; update existing associations; apply snapshot targets; init/add request all upstream agents. |

Use comma-separated IDs for multiple targets. `all` cannot be mixed with explicit
IDs. `plan`, `init`, `add`, `update`, `remove`, `snapshot` and `apply` require
`--target`; `status` and `doctor` default to inspecting all targets when omitted.
Unlike scoped updates, `init` / `add --target all` can create additional agent
placements through upstream `--agent '*'`.
Unknown IDs pass to upstream, but an inventory whose target mapping cannot be
verified is reported as unknown and may block changes; no directory is guessed.

## Other Commands

```bash
skillsman list
skillsman status --target codex --project /path/to/project
skillsman remove skillsman-readme --target codex --project /path/to/project
skillsman doctor --target codex --project /path/to/project
skillsman coverage
```

`status` compares actual installed skills with saved choices when present.
`doctor` checks upstream availability and inventory; use it for diagnosis rather
than after every successful operation. `restore` is an explicit legacy-command
error, not an alias. Use `init --file` or `apply` with a current snapshot.

## Snapshots

```bash
skillsman snapshot --target codex --project /path/to/project
skillsman snapshot --target codex --project /path/to/project --output /path/to/skills.snapshot.yaml
skillsman apply /path/to/skills.snapshot.yaml --target codex --project /path/to/another-project --dry-run
skillsman apply /path/to/skills.snapshot.yaml --target codex --project /path/to/another-project
```

The default path is `<project>/.skillsman/skills.snapshot.yaml`. Only
`skillsman.snapshot.v1` is accepted, with required schema and target-keyed lists
of `{name, source}`. Readable linked skills are included; unresolved source or
inventory errors prevent a successful snapshot.

Snapshots preserve the observed GitHub skill subdirectory and encode branch names.
When a Git/GitLab subdirectory cannot be expressed safely by the upstream source
syntax, snapshot creation fails instead of silently widening the source.

`apply` requires matching target sections and preserves the project's selection
file. With `--target all`, it expands the snapshot's concrete target IDs, checks
the combined plan before any installation, and then executes grouped writes.
Conflicting sources or installation identities across target sections reject the
whole apply operation before installation. It is not a cross-agent selection
conversion or a content rollback. Use `skills.yaml` to reuse a chosen set with another agent. Missing-schema or legacy
formats are rejected rather than implicitly converted.

## Development

After `npm ci`, run the relevant checks from the repository root:

```bash
npm test
bash -n install.sh bin/skillsman
./bin/skillsman list
./bin/skillsman show workflow
./bin/skillsman coverage
git diff --check
npm pack --dry-run
```

`npm test` runs `node --test test/*.test.cjs` for the modules and project workflows.
`test/skillsman-cli.test.sh` runs only `test/entrypoints.test.cjs`.
Run `npm run test:smoke` separately for live upstream checks via
`test/smoke-real-upstream.sh`.

See the [verification record](docs/verification/project-skill-initialization.md) for tested coverage and limits.

## Repository Structure

- `bin/skillsman`: Bash entrypoint locating the Node command module.
- `lib/skillsman/`: configuration, inventory, planning, upstream, state and project commands.
- `scenarios/*.yaml`: candidate sets and explicit full-source requests.
- `skills/`: canonical bundled skills with metadata and references.
- `examples/selection.yaml`: a reusable explicit two-skill choice.
- `test/`: Node tests, helpers and controlled upstream fixtures.
- `install.sh`, `package.json`: local CLI link and package metadata.

## License

MIT License. See [LICENSE](LICENSE).
