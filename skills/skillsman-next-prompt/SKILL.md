---
name: skillsman-next-prompt
description: Create a concise, context-aware next prompt that tells Codex what to do next. Use when the user asks for a next prompt, better prompt, continuation prompt, handoff prompt, new chat prompt, resume prompt, context transfer, or wants to continue, steer, or restart work while preserving the project’s chosen workflow.
---

# Skillsman Next Prompt

Generate a ready-to-paste prompt that helps the user get the next useful action from Codex. The prompt may target the current conversation, a fresh Codex conversation, or another agent. Base it on the visible conversation, repository state, and any available local evidence.

Preserve the user's latest intent, existing authorization and constraints. Carry forward a named framework only when the user or project has explicitly chosen it; a fresh conversation or agent handoff does not introduce a new framework dependency.

## Workflow

1. Identify the prompt target:
   - Current conversation, fresh conversation, or agent handoff.
   - Immediate desired outcome: plan, implement, debug, review, verify, summarize, or decide.
   - Whether the target should continue existing work or reframe the task from scratch.

2. Identify the task context:
   - Current goal or user request.
   - Current working directory, repo, branch, and relevant files.
   - Decisions already made and constraints the next prompt must preserve.

3. Collect compact evidence before drafting when available:
   - Check `pwd`, `git status --short`, and relevant file paths if working in a repo.
   - Include only commands/results that materially affect the next step.
   - Mark unverified assumptions explicitly instead of presenting them as facts.

4. Preserve operating constraints:
   - User's latest explicit instructions.
   - Scope boundaries and things not to touch.
   - Skill or workflow dependencies actually required by the selected project process.
   - Existing authorization and any remaining approval gates; do not ask again for actions already authorized.

5. Draft the prompt as an instruction, not as a status report.

## Output Format

Return only the prompt unless the user asks for explanation.

For current-conversation prompts, use this structure:

```text
Next prompt:
<direct instruction to Codex>

Context to preserve:
- <brief facts, constraints, files, or decisions>

Success condition:
- <what a good answer or completed action should produce>
```

For fresh-conversation or handoff prompts, use this structure:

```text
Task:
<one-sentence goal>

Context:
- Workspace: <absolute path>
- Current state: <brief status>
- Important files: <paths and why they matter>
- User constraints: <scope, style, approval gates>

What has already happened:
- <facts from current conversation or verified local state>

Next steps:
1. <immediate next action>
2. <verification or decision point>
3. <completion criterion>

Do not:
- <explicit non-goals or risky actions to avoid>
```

## Quality Bar

- Keep the prompt short enough to paste into a new chat without becoming a transcript.
- Prefer exact file paths, commands, dates, branch names, and artifact names over general summaries.
- If the user or project explicitly chose Superpowers, preserve that choice and reference its available entrypoint. Otherwise omit Superpowers instructions, including for fresh conversations and handoffs.
- If the task is unfinished because of a blocker, make the blocker and the requested user decision explicit.
- If the user asks for multiple prompt options, provide distinct prompts for distinct intents instead of minor wording variants.
- If the user asks for a Chinese prompt, write the prompt in Chinese while preserving literal tool, path, command, and skill names.
