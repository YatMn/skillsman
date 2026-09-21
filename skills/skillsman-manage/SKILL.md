---
name: skillsman-manage
description: "Manage a project’s installed skills with Skillsman: selection, installation, updates, removal, snapshots, and diagnostics."
---

# Skillsman Manage

Use Skillsman for project skill lifecycle operations. Keep canonical skill authoring separate from installing third-party packages.

## Scope and decisions

- Infer the project and agent from explicit user instructions and current project context; ask only if the target is genuinely ambiguous. Do not default to all agents.
- Read project instructions, existing skills and actual tasks before recommending a minimal set of explicit skill names, sources and reasons. Use scenarios as candidates; read [scenario mapping](references/scenario-mapping.md) only when choosing scenarios, and inspect live definitions. A matching project type does not authorize an entire suite. Check prerequisites and overlap with already available plugin skills; preserve useful choices supported by the user’s actual experience.
- Inspect real skill names through source files or read-only `npx --yes skills@1.5.26 add <source> --list`. Discovery failure is an error, not permission to install the whole source. Do not claim visibility into plugins or global skills that the session cannot inspect.
- Keep command-specific `--target all` distinct from the audit-only `scenarios/all.yaml`: init/add can request all upstream agents, update refreshes known existing associations, and apply expands the snapshot’s concrete targets.
- Show the concrete source, destination and operation before mutation. An existing request to perform that exact operation is authorization; ask only for unresolved scope, destructive removal, or a local modification that would be overwritten without authorization.
- Preserve local customizations. Inspect links and real paths before changes; never silently overwrite a modified skill or snapshot conflict.
- Editing skill instructions is authoring: use `skill-creator` when available. Keep `skills/` canonical for bundled Skillsman skills; this is not a request to install Skillsman into itself.

## Execution

Prefer a compatible `skillsman` on PATH, then the CLI in a repository explicitly supplied by the user, then `npx github:YatMn/skillsman`. Check `--help` for `plan --file` and `init --file`; a fetched remote revision may lack the local workflow. Local checkouts require Node.js >=22.20.0 and `npm ci`, including before `./install.sh` creates a CLI symlink. Installing this management skill does not install the CLI. If no compatible entrypoint works, report the blocker and preserve the proposed choice; do not silently bypass it with raw installation commands.

| Operation | Command shape |
| --- | --- |
| Inspect | `skillsman list`, `skillsman show <scenario>`, `skillsman status --target <agent> --project <path>` |
| Preview choice | `skillsman plan --file <selection.yaml> --target <agent> --project <path>` |
| Initialize | `skillsman init --file <selection.yaml> --target <agent> --project <path>` |
| Add | `skillsman add --file <additions.yaml> --target <agent> --project <path>` |
| Remove | `skillsman remove <named-skill...> --target <agent> --project <path>` |
| Preview update | `skillsman update --target <agents> --project <path> --dry-run` |
| Update | `skillsman update --target <agents> --project <path>` |
| Snapshot | `skillsman snapshot --target <agent> --project <path>` |
| Apply | `skillsman apply <snapshot> --target <agent> --project <path>` |
| Diagnose | `skillsman doctor --target <agent> --project <path>` |

Keep `.skillsman/skills.yaml` reusable: `includes: []`, nonempty source/reason and explicit nonempty names per source; an empty skills list is valid. Save full names, including spaces. `init --file` preserves an identical existing choice and rejects a different one; `add --file` merges, deduplicates and retains the first source reason. `plan` previews its input file; `init` and `add` have no `--dry-run`. An explicitly requested scenario remains valid, with omitted `names` meaning the whole source; never write that omission into a saved selection.

Updates require the saved selection and verified local baselines. Preserve unrelated skills, block local changes or unknown evidence before overwrite, and never fall back to a whole-project update. Codex content in `.agents/skills` may be shared with `antigravity,codex,cursor,gemini-cli,github-copilot,zed`; a codex-only update can fail with `SHARED_IMPACT`. Report all affected IDs and obtain any missing scope authorization before including them. Explicit `update --target all` authorizes refreshing the selected skills’ known existing associations, using concrete target IDs grouped by skill/source, without `--agent '*'` or new agent placements. Unknown associations remain blocking. Do not silently expand agent scope to make an update pass.

Check current CLI help for other features. Unknown agent values pass through to upstream; do not invent their filesystem layout or claim complete validation. Use Skillsman for project mutations; raw upstream access above is for read-only discovery. `restore` is an explicit legacy error, not an alias for another operation.

Read command results and affected files to report installed, kept, failed, unverified or removed items. Partial failure preserves verified successes and user intent; retry initialization for missing items. `remove` leaves the saved selection unchanged. Run `doctor` when requested or troubleshooting unresolved state; do not repeat broad diagnostics after every successful operation.

Keep `.skillsman/state.json` as local digest evidence and recommend excluding it from Git; do not copy it as another project’s baseline. Skillsman does not automatically edit `.gitignore`. Reuse `skills.yaml` across projects; `skillsman.snapshot.v1` snapshots remain target-specific. `apply --target all` expands their concrete IDs into one preflight and grouped execution, rejecting cross-target source or installation-name conflicts before writes. None of these files restores exact historical content, automatically tracks new upstream skills, or proves runtime activation or task-quality improvement.
