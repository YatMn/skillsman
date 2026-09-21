# Scenario Mapping

Use these as candidate categories. Each built-in entry lists explicit names and
its selection conditions in `why`; a category match does not request the entire
scenario. Inspect current source instructions and existing tools before choosing.

| Task | Candidate scenarios | Selection boundary |
| --- | --- | --- |
| Project planning, debugging or delivery | `workflow` | Select a concrete method or repository helper. Inspect companion-skill requirements; Superpowers routing, OpenSpec and Claude/tmux agent coordination are opt-in, not prerequisites for every task. |
| Frontend or web app | `web-app` | `frontend-design` supplies visual guidance. `webapp-testing` needs Python Playwright/Chromium and proportionate readiness checks; upstream networkidle guidance conflicts with current Playwright recommendations. `web-artifacts-builder` targets Claude HTML artifacts. These are not full React/Next.js engineering coverage. |
| Backend or full-stack development | Relevant parts of `workflow`, `web-app`, `database`, `deployment` | Decompose the request into actual UI, data, hosting and delivery responsibilities. A stack label does not justify installing four scenarios. |
| Database work | `database` | `supabase-postgres-best-practices` for Postgres; `supabase` for its Auth, Storage, Realtime or other platform services. Choose both only when both responsibilities exist. |
| Deployment or operations | `deployment` | Vercel only. Start with `vercel-cli`, `deployments-cicd` or `env-vars`; select Functions, cache, routing, Marketplace, Agent, Sandbox or Workflow SDK only for those services. `workflow` here is a Vercel SDK. Check provisioning and companion-skill assumptions. |
| Research | `research` | `doko` fetches rendered browser sources and needs its CLI/extension plus a bridge or remote API key. `huashu-research` provides a research process with workspace/shared-rule assumptions. `notion-research-documentation` requires Notion access. |
| Prose, scripts and editing | `writing` | `doc-coauthoring` is a content collaboration method, not a file generator. Retain `huashu-proofreading` as a preferred practical writing choice; select other editing, speech or social-platform methods by actual task. Check video APIs and local resources. |
| Office files and file-based reports | `documents` | Select DOCX/PDF/PPTX/XLSX by the output format and available runtime tools. `huashu-md-to-pdf` has reported Chinese rendering issues in some macOS Preview environments; `huashu-data-pro` references external styles. Research outside file/report work stays in research. |
| Knowledge capture or meeting preparation | `writing`; `research` for synthesis; `workflow` for implementation | Notion capture/meetings, research and spec-to-implementation belong to their actual tasks. Require connector/workspace access; do not duplicate an installed plugin's equivalent skills. |
| Repository documentation | `workflow` | Choose `skillsman-readme` or `skillsman-agents-md`; neither needs the full workflow scenario. |
| Visual assets | `design`; `web-app` for UI | Separate static composition and generative art from UI or artifacts. `huashu-design` suits deliberate multi-variant exploration. Themes, Slack GIFs, WeChat/Xiaohongshu images and image uploads require those specific tasks and tools. |

## Selection Rules

- Read the user's goals, repository instructions and installed skills first.
  Existing authorization persists; a matching category does not authorize more work.
- For each proposed skill, state its name, source, task-specific benefit,
  prerequisites, observed installation state and overlap with existing capabilities.
- Prefer the smallest sufficient named choice. Keep the built-in catalog explicit;
  outside scenarios may still omit `names` to request an entire source, but saved
  project choices always use explicit names and `includes: []`.
- Preview with `plan --file` and use `init --file` or `add --file` within scope.
  Discovery failure must not trigger a full-source fallback.
- Explicit whole-scenario requests remain valid; they select every listed name,
  including conditional candidates. `all` is an audit-only aggregate.
- Catalog moves or exclusions do not remove or rewrite installed project choices.
  Review a saved choice deliberately before changing it.
- Add a source only for a demonstrated task gap. For uncertain usefulness, compare
  a small number of real tasks; use observed quality and rework, not catalog size
  or model age, to decide whether a skill earns its place.
