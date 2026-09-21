---
name: skillsman-branch
description: Use when creating or choosing a Git branch, checking its base or PR target, syncing branches, preparing a pull request, or applying repository branch and release policies.
---

# Skillsman Branch

Turn branch requests into concrete Git/GitHub actions using the repository's
actual workflow. Preserve existing work and the user's authorization.

## Establish the Repository Policy

Read the current task, repository instructions, working-tree status, local and
remote branches, and relevant PR context. Identify the remote default branch
and any documented integration or release branches; a branch named `develop`
is not by itself proof that it is the integration target.

Choose the base and PR target from that evidence:

| Repository policy | Base and target |
| --- | --- |
| Default-branch workflow, such as a personal project with only `main` | Branch from the verified default branch and open the PR back to it. |
| Documented `main` / `develop` integration model | Ordinary features and fixes use `develop`. Follow the documented release and hotfix routes. |
| Fix for an active release or supported version | Use that release/version branch; identify any required forward-port separately. |
| Continuing an existing PR | Preserve its verified head and base unless the task requires changing them. |

Do not create `develop`, release branches, or environment branches merely to
fit a template. Staging, UAT and test usually describe deployment environments;
follow an existing environment-branch policy when the repository uses one.
Ask only if unresolved base or release ambiguity materially changes the work.

## Name and Prepare the Branch

Follow the user's requested name and the repository or agent environment's
prefix convention. Otherwise choose a short descriptive name such as
`feature/selection-preview` or `bugfix/snapshot-path`. Include a date or release
version only when the project convention or task calls for it.

Before changing branches:

1. Inspect staged, unstaged and untracked work. Reuse the appropriate task branch
   or an isolated worktree when that preserves existing edits. Never discard or
   stash someone else's work implicitly; a dirty checkout is not automatically
   a reason to stop all progress.
2. Fetch the relevant remote when available and verify the intended base commit.
   If unavailable, distinguish the local snapshot from current remote state.
3. If a proposed branch already exists, inspect its relationship to this task.
   Continue it when appropriate; otherwise choose an unused descriptive name.
4. Create from the verified base without moving a shared checkout unnecessarily.
   Update an existing base only by a safe fast-forward; inspect divergence.

## Integrate and Report

Follow repository protection and required-check rules. Prefer PRs for shared
integration; direct-to-default PRs are normal in a default-branch workflow.
Execute pushes, PR creation or merges within the user's authorized scope.
Do not bypass protection or force-push shared integration/release branches.
Preserve unrelated commits and delete temporary branches only after verifying
merged status and that no worktree or ongoing task needs them.

For releases or hotfixes, mention follow-up ports or tags only when the actual
repository policy requires them. Do not invent a `develop` sync task.

Report the branch, base/PR target, completed action and relevant verification
or blocker. Include commands when they help the user act; omit empty risk
checklists and repeated permission requests.
