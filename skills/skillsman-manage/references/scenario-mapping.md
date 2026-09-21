# Skillsman Scenario Candidates

Use project type to find candidate sources, then choose individual skills for the
actual responsibilities in the request. A row is a place to look, not a bundle
to install. Read current scenario definitions and source skill instructions before
confirming names or recommending installation.

| Project type | Candidate scenarios | Choose by actual responsibility |
| --- | --- | --- |
| Development management | `workflow` | Select repository guidance, branching, README, planning or review skills only for the work requested. For example, `skillsman-readme` handles README work; it does not require the rest of `workflow`. |
| Backend development | `workflow`; `database` or `deployment` if relevant | Identify the API/service task first. Inspect database candidates for concrete schema/query/storage work, and deployment candidates for an actual hosting or runtime responsibility. |
| Frontend or web app | `web-app` | Inspect `frontend-design` for UI design and `webapp-testing` for browser testing; choose either or both according to the task. Add workflow or hosting candidates only when those responsibilities are present. |
| Full-stack development | Relevant parts of `web-app`, `database`, `deployment`, `workflow` | Break the request into UI, data, hosting and delivery tasks. Pick individual skills for the tasks that exist; “full-stack” alone does not justify four scenarios. |
| Database work | `database` | Inspect the source's real catalog for the requested Supabase/Postgres, query, schema, migration or storage responsibility. The scenario's omitted names require discovery before making a named selection. |
| Deployment or operations | `deployment` | Confirm the hosting platform first. The current candidates are Vercel-specific; inspect names such as `env-vars`, `vercel-functions` or `verification` for the requested job. Do not treat them as generic Cloudflare or all-platform coverage. |
| Research | `research` | Match source gathering, web extraction or evidence review to the available skill's instructions and tools. Do not infer that one research skill covers every source. |
| Writing or documentation | `writing`; `workflow` for repository docs | Choose by deliverable: document collaboration, DOCX, PDF, slides, spreadsheets, editing or Notion work. For repository README or agent instructions, inspect `skillsman-readme` or `skillsman-agents-md`. |
| Design | `design`; `web-app` for frontend UI | Distinguish brand/static assets, generated images, prototypes and web UI. Choose the relevant skill after checking the required output and available tools. |

## Selection Rules

- Read project instructions, existing skills and the user's tasks. A stack label
  helps locate candidates but does not authorize installation.
- For each proposed skill, state its complete name, source, task-specific reason,
  observed installation state and overlap with existing capabilities.
- Inspect real source names; omitted `names` is a full-source request only when
  explicitly installing that scenario. A reusable choice always records explicit
  names and `includes: []`. Discovery failure must not trigger full-source fallback.
- Save the smallest sufficient named choice, preview it with `plan --file`, and
  use `init --file` or `add --file` within the user's existing authorization.
- Keep explicit whole-scenario requests valid, but do not promote a candidate
  mapping into such a request. `all` remains an audit-only scenario.
