# Catalog Review

Catalog instructions were inspected on 2026-09-21 and the selection was revised
on 2026-09-22. This is a source/instruction review, not an installation or model
benchmark. Repository activity alone does not establish skill quality.

## Selection Changes

- Eight functional categories: add `documents`; retain the other category names.
  Prose and scripts stay in writing; file construction and reports move to documents.
  Research, Notion specification implementation and image assets move to their tasks.
- Enumerate every built-in source entry, including Superpowers, Supabase and
  huashu-design. Source-wide CLI semantics remain supported for explicit requests.
- Prefer Vercel CLI/deployment/environment candidates for basic Vercel operations;
  keep platform-specific runtimes and services conditional. The catalog does not
  install the Vercel plugin's hooks, routing or referenced companion skills as a
  guaranteed complete plugin environment.
- Keep Superpowers as selected methods or an explicitly chosen framework, rather
  than an automatic prerequisite of a handoff. Follow each repository's actual
  branch policy instead of assuming `develop` exists.
- Preserve `huashu-proofreading` as a preferred writing candidate based on positive
  practical use. Do not replace a useful personal workflow based only on a static
  review of its wording.

## References and Conditions

| Skill | Finding and disposition |
| --- | --- |
| `doko` | [Upstream frontmatter](https://github.com/dokobot/skills/blob/main/doko/SKILL.md) declares `doko`; replace the old catalog name `dokobot`. The CLI/product retains the Dokobot name. Requires CLI, Chrome extension and bridge or remote credentials. |
| `huashu-slides` | [HTML assembly](https://github.com/alchaincyf/huashu-skills/blob/master/huashu-slides/SKILL.md) references `pptx/scripts/html2pptx.js`, absent from the inspected [current PPTX scripts](https://github.com/anthropics/skills/tree/main/skills/pptx/scripts). Another path requires external `image-to-slides`. Exclude until its dependencies are supported; no installation failure was reproduced. |
| `huashu-info-search` | [Instructions](https://github.com/alchaincyf/huashu-skills/blob/master/huashu-info-search/SKILL.md) put media/community before primary documentation and exclude content older than six months. Exclude from general research candidates. |
| `huashu-material-search` | [Instructions](https://github.com/alchaincyf/huashu-skills/blob/master/huashu-material-search/SKILL.md) assume the author's personal experience library. Exclude from a reusable project catalog. |
| `brand-guidelines` | [Instructions](https://github.com/anthropics/skills/blob/main/skills/brand-guidelines/SKILL.md) apply Anthropic branding rather than general brand design. Exclude from general design candidates. |
| `webapp-testing` | [Instructions](https://github.com/anthropics/skills/blob/main/skills/webapp-testing/SKILL.md) insist on `networkidle`; [Playwright](https://playwright.dev/python/docs/api/class-page#page-wait-for-load-state) discourages it as a testing readiness criterion. Retain conditionally, with relevant page assertions and limited verification scope. |
| `huashu-md-to-pdf` | [Upstream limitation](https://github.com/alchaincyf/huashu-skills/blob/master/huashu-md-to-pdf/SKILL.md) reports Chinese rendering problems in some macOS Preview environments. Retain conditionally; this was not reproduced and is not a universal failure. |
| `huashu-design` | [Instructions](https://github.com/alchaincyf/huashu-design/blob/master/SKILL.md) require three design variants and a selection checkpoint. Suitable for deliberate exploration, not a requirement for routine visual edits. |

Skill content is referenced from its original source, not copied or patched here.
Check required tools, credentials, shared files and licenses when selecting a
skill. Existing compatible document/browser/plugin capabilities can satisfy the
same task without another skill installation. Exclusions affect future catalog
choices, not installed skills or saved project selections.

## Verification of This Revision

- `node --test test/config.test.cjs test/entrypoints.test.cjs`: 30 passed.
  The revised scenario regression checks that future unselected upstream skills
  are not installed by the named workflow candidate list.
- `list`, `show all` and `coverage`: eight functional categories plus `all`,
  65 explicit names from 10 sources, zero full-source entries or overlaps.
- Changed bundled skill frontmatter, directory names, UI metadata and local
  documentation links checked; `huashu-proofreading` retained in writing.
- `npm pack --dry-run`: new documents scenario and this review are included.
- `git diff --check`: passed. One independent, read-only review found no
  substantive catalog, documentation or workflow-policy issue.

No live skill installation, model benchmark, full regression suite or runtime
skill-execution test was performed for these catalog and instruction changes.
