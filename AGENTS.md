# AGENTS.md

Instructions for Codex and other coding agents working in this repository.

## Project Overview

`skillsman` is a personal agent skills manager. It stores first-party skills,
scenario definitions, and a Bash entrypoint for Node.js CommonJS modules.
Project selections are explicit and reusable; installation is delegated to
`skills@1.5.26` in the target project. Node.js >=22.20.0 and `npm ci` are required
for local use; YAML parsing uses `yaml@2.8.3`.

## Source of Truth

- [README.md](README.md): public usage, bundled skills, scenarios, and checks.
- [bin/skillsman](bin/skillsman): Bash entrypoint and symlink resolution.
- [lib/skillsman/project.cjs](lib/skillsman/project.cjs): current commands, argument handling and execution.
- [lib/skillsman/](lib/skillsman/): strict config, upstream adapter, inventory, planner and state contracts.
- [scenarios/](scenarios/): one-layer scenario definitions.
- [skills/](skills/): bundled installable skills.
- If docs and code disagree, verify against `bin/skillsman` and the relevant Node module, then update both READMEs.

## Working Rules

- Keep `skills/` as the canonical source for bundled `skillsman-*` skills.
- Do not copy skill contents from `~/.codex/plugins/cache`.
- Do not add backwards-compatible aliases or legacy schema support unless the
  user explicitly changes the migration decision.
- Scenario commands install into the caller's project through `npx skills`.
- Keep scenario files as simple YAML: `includes` lists and `skills` entries with
  `source`, `why`, and optional `names`.
- Scenario entries without `names` explicitly request the whole source. Preserve
  that meaning; enumerate names before saving a reusable selection and refuse
  a full-source operation that would overwrite existing content.
- Project `.skillsman/skills.yaml` requires empty `includes` and explicit names.
  `init --file` must not replace a different choice; `add --file` merges it.
- `.skillsman/state.json` is local verified digest evidence, not a portable choice
  or content backup. Recommend ignoring it without silently editing `.gitignore`.
- `update` requires a saved selection, explicit targets and trusted baselines.
  Preserve extra skills and local modifications; never fall back to a global or
  whole-project update, automatically add source skills, or promise exact restoration.
- Shared `.agents/skills` content may report antigravity, codex, cursor, gemini-cli,
  github-copilot and zed. Require explicit scope for all affected associations.
  `update --target all` must refresh only known existing associations, grouped
  by skill/source with concrete IDs; never pass '*' or add new agent placements.
  `init` / `add --target all` still request all upstream agents.
- `apply --target all` expands snapshot target IDs into one preflight and grouped
  execution; reject cross-target source or installation-name conflicts before writes.
- `restore` is an explicit legacy-command error. Do not add a restore alias or
  another snapshot schema; only `skillsman.snapshot.v1` is accepted.
- Plan/install/add/update/remove/snapshot/apply commands require explicit `--target`; built-in target aliases are
  `codex`, `claude`, `claude-code`, `cursor`, `gemini`, `gemini-cli`,
  `openclaw`, `antigravity`, and `all`. Unknown targets pass through to
  `npx skills --agent`.
- Treat `scenarios/all.yaml` as an aggregate scenario for audit/testing only.
- Use Bash-compatible changes in `install.sh` and `bin/skillsman`.

## Commands

- Install dependencies: `npm ci`
- Install local CLI symlink after dependencies: `./install.sh`
- Preview a choice: `./bin/skillsman plan --file examples/selection.yaml --target codex --project /path/to/project`
- Initialize from a choice: `./bin/skillsman init --file examples/selection.yaml --target codex --project /path/to/project`
- Merge choices: `./bin/skillsman add --file /path/to/additions.yaml --target codex --project /path/to/project`
- Preview scoped update: `./bin/skillsman update --target codex --project /path/to/project --dry-run` (may report shared targets that need explicit scope)
- List scenarios: `./bin/skillsman list`
- Show expanded scenario: `./bin/skillsman show workflow`
- Install scenario: `./bin/skillsman init workflow --target codex`
- Add scenario: `./bin/skillsman add writing --target codex,cursor`
- Remove a skill: `./bin/skillsman remove skillsman-readme --target codex`
- Snapshot project skills: `./bin/skillsman snapshot --target codex`
- Apply a snapshot: `./bin/skillsman apply .skillsman/skills.snapshot.yaml --target codex`
- Check environment/project state: `./bin/skillsman doctor --target codex`
- Check scenario coverage: `./bin/skillsman coverage`

## Verification

- For Node behavior changes, run affected tests; `npm test` runs
  `node --test test/*.test.cjs`. `test/skillsman-cli.test.sh` wraps only
  `test/entrypoints.test.cjs`, not the complete suite. Preserve its original
  CLI regression intentions. `npm run test:smoke` is a separate live-upstream
  check using `test/smoke-real-upstream.sh`; do not imply it ran with unit tests.
- Verify README examples against current argument parsing; validate selection YAML
  with `config.cjs`. Keep English and Chinese docs synchronized.

- After shell changes, run `bash -n install.sh bin/skillsman`.
- After scenario changes, run `./bin/skillsman list`,
  `./bin/skillsman show <scenario>`, and `./bin/skillsman coverage`.
- After bundled skill instruction changes, verify frontmatter, name/directory agreement and referenced resources. Run a temp-project install smoke when installation paths, packaging or dependencies changed; wording-only edits do not require a network install.
- Run `git diff --check` and `npm pack --dry-run` before publishing.

## Repository Layout

- `bin/skillsman`: Bash entrypoint for the Node CLI.
- `lib/skillsman/*.cjs`: structured command implementation.
- `examples/selection.yaml`: explicit reusable choice example.
- `test/*.test.cjs`: module and project regression tests.
- `scenarios/*.yaml`: one-layer scenario definitions and includes.
- `skills/*`: bundled installable skills.
- `install.sh`: installs `~/.local/bin/skillsman` as a symlink to this repo.
- `package.json`: GitHub-hosted `npx` metadata and package file list.
