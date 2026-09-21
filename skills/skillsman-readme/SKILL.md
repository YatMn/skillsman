---
name: skillsman-readme
description: "Create or update a project README using verified repository commands and the user’s requested language."
---

# Skillsman README

## Purpose

Write repository README files that act as accurate project entrypoints: what the project is, why it exists, how to run it, how to develop it, and where deeper docs live.

README files should describe the project's current usable state. Do not turn `README.md` into a roadmap, progress report, task tracker, implementation plan, or changelog. Link to separate planning/progress docs only when they already exist and are useful to readers.

Default output is bilingual:

- `README.md`: English primary version.
- `README.zh-CN.md`: Chinese companion version.
- Each file must link to the other near the top.
- The Chinese file should be a faithful localized version of the English README, not a different document with extra claims.

## Core Rule

Inspect the project before writing. Do not start from a generic README template. Treat the repository as the source of truth, and mark missing facts as `TODO` rather than inventing them.

## Mode Decision

Before editing, decide whether this is **create mode** or **update mode**.

Use create mode when:

- No useful `README.md` exists.
- The existing README is only a placeholder or stale template.
- The user asks for a new README, full rewrite, or bilingual README creation.

Use update mode when:

- A README already exists and the user asks to refresh, sync, maintain, or update it.
- Code, commands, configuration, project structure, APIs, dependencies, or deployment flow changed.
- The user asks after recent implementation work and expects the README to reflect the new code.

In update mode:

- Read the existing English and Chinese README files first.
- Identify what changed by inspecting `git status`, relevant diffs, manifests, source entrypoints, config, tests, docs, and deployment files.
- Preserve accurate existing wording and structure where it still serves readers.
- Update stale sections surgically when possible; rewrite only when the current README is misleading or structurally broken.
- Keep `README.md` and `README.zh-CN.md` synchronized in facts, commands, links, and section order.
- Remove or revise claims that are no longer true.

## Workflow

1. Identify the project type and audience.
   - Check the repo root, existing README files, package manifests, docs, source entrypoints, test folders, Docker/deploy files, CI configs, examples, and `.env.example`.
   - Prefer `rg --files` for discovery.
   - Read existing docs, but verify against code and config when the docs look template-like or stale.

2. Build a short internal project facts map before editing.
   - Purpose and target users.
   - Runtime stack and package manager.
   - Install, configure, run, test, lint, build, and deploy commands.
   - Main entrypoints and important directories.
   - Required services, environment variables, credentials, and data dependencies.
   - Project status, known limitations, license/support/maintainer info.
   - In update mode, changed files and README sections affected by those changes.

3. Decide README scope.
   - Keep `README.md` as the starting point, not the full manual.
   - Link to `docs/`, API references, architecture notes, contribution guides, or deployment docs for depth.
   - Avoid long file trees, marketing copy, ornamental badges, and unverified feature claims.
   - Exclude detailed project plans, milestone progress, task status, sprint notes, and historical implementation updates.

4. Create or update `README.md` first.
   - Use English.
   - Put a language switch near the top: `English | [简体中文](README.zh-CN.md)`.
   - Make commands copyable and use the repo's actual package manager and scripts.
   - Prefer concise explanations plus exact commands over broad prose.
   - In update mode, favor focused edits that keep stable accurate content intact.

5. Create or update `README.zh-CN.md` second.
   - Put a language switch near the top: `[English](README.md) | 简体中文`.
   - Preserve the same structure and facts as the English README.
   - Translate user-facing prose naturally; keep code identifiers, commands, env vars, file paths, API names, and package names in English.
   - In update mode, mirror the English README changes rather than independently reinterpreting them.

6. Verify before completion.
   - Check links to local files are relative and valid.
   - Check command names exist in manifests or scripts when possible.
   - Check README facts against changed code paths when updating after implementation.
   - Run safe, cheap verification commands when appropriate, such as tests for markdown formatting or package-script listing.
   - If a command cannot be verified, do not imply it was tested.

## Recommended README Sections

Use only sections that fit the repository. Reorder for readability.

```markdown
# Project Name

English | [简体中文](README.zh-CN.md)

One-sentence description of what this project does and who it is for.

## Status

Current maturity, supported use cases, and important limits. Keep this about present state, not future plans.

## Quick Start

Prerequisites, install, configuration, and the shortest working run path.

## Usage

Core CLI/API/UI workflows with examples.

## Project Structure

Short map of important directories and entrypoints.

## Development

Local development commands, tests, linting, build, and common scripts.

## Configuration

Environment variables and config files.

## Deployment

Deployment path or link to deployment docs.

## Troubleshooting

Known setup/runtime problems and where to inspect logs.

## Documentation

Links to deeper docs.

## Support

Maintainers, contact channel, issue/PR expectations.

## License

License or internal-use statement.
```

## Quality Bar

A strong README:

- Lets a new reader understand the project in the first screen.
- Provides a shortest successful path from clone to running state.
- Uses real commands copied from manifests, Makefiles, scripts, or docs.
- Explains configuration without exposing secrets.
- Describes status and boundaries honestly.
- Shows where deeper docs live instead of duplicating them.
- Is useful to future agents and humans maintaining the repo.
- Stays current when code, scripts, config, or deployment flow changes.
- Explains the current project state without becoming a planning or progress document.

A weak README:

- Starts with generic slogans.
- Contains commands that do not exist.
- Lists every file in the repo.
- Claims production readiness without evidence.
- Adds badges, screenshots, or architecture sections that are not useful.
- Leaves English and Chinese versions factually different.
- Accumulates old setup steps after the code has changed.
- Includes detailed roadmaps, task progress, milestone histories, or implementation plans as main README content.

## Optional Reference

Read `references/readme-quality-rubric.md` when you need a compact checklist for auditing an existing README or deciding whether a generated README is good enough.
