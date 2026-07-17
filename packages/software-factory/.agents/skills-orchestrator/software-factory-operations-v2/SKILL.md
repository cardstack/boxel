---
name: software-factory-operations-v2
description: Lean V2 factory loop — design-first workflow, on-demand skills, no tests until hardening. Use when implementing cards in a target realm through the V2 factory execution loop.
---

# Software Factory Operations (V2 — lean, design-first)

You operate inside the factory execution loop. Workspace files live in a
**local mirror of the target realm** that the orchestrator syncs back
between iterations; your working directory is that mirror, so
realm-relative paths (`song.gts`, `Song/one.json`) resolve directly with
the native `Read` / `Write` / `Edit` / `Glob` / `Grep` / `Bash` tools.

This skill is deliberately small. Most knowledge loads **on demand**:
call `list_skills` for the catalog, `read_skill({ name })` for a skill's
overview, and `read_skill({ name, reference })` for a specific reference
file. Load what the current work touches, nothing more.

## When you need X, read Y

| Need | read_skill |
| --- | --- |
| Card/field authoring, CardDef/FieldDef syntax, formats | `boxel-development` (then specific `dev-*.md` references) |
| Fitted-format layout rules | `boxel-development` reference `dev-fitted-formats.md` |
| Theme tokens / design-system CSS | `boxel-development` reference `dev-theme-design-system.md` |
| Search query syntax (`boxel search --query`) | `boxel-api` |
| Host commands via `boxel run-command` | `boxel-command` |
| File-backed fields (images, files, csv) | `boxel-file-def` |
| Catalog Spec conventions | `boxel-development` reference `dev-spec-usage.md` |
| Reusable UI components before hand-rolling any UI | `boxel-ui-component-discovery` |

## Required flow (design-first)

1. **Ground**: inspect workspace + target realm (`boxel search` via Bash);
   read precedent `.gts`; `read_skill` what the issue touches.
2. **DESIGN**: write `design/<slug>.html` — plain HTML+CSS mockup with
   hard-coded realistic sample copy showing the isolated view (mobile),
   fitted badge/strip/card tiles, and an embedded row. Then
   `screenshot_html({ path })`, `Read` the PNG, critique it (name the
   defects), revise, re-screenshot. At least one full crit pass. The
   accepted mockup is the binding spec for step 3.
3. **BUILD**: translate the mockup into the `.gts` card (isolated +
   embedded + fitted templates), sample instances (same data as the
   mockup), and a Catalog Spec (`Spec/<slug>.json`, adoptsFrom
   `https://cardstack.com/base/spec#Spec`, `linkedExamples` →
   instances). The Spec MUST populate its catalog-facing `title` (display
   name) and `description` (one sentence) attributes in addition to the
   readMe — a Spec with empty title/description renders as an unnamed
   card in the catalog UI. Call `get_card_schema` before writing any
   card JSON whose shape you don't know (Spec, tracker cards).
4. **VERIFY**: `run_lint({ path })` per file, then `run_parse()`,
   `run_evaluate()`, `run_instantiate()`. Fix what they report. These
   return in-memory results; each one syncs your workspace to the realm
   first. Zero-coverage passes come back as errors — never treat them
   as green.
5. **Done**: `signal_done()`. If validation feedback comes back, fix and
   signal again. If truly blocked, `request_clarification({ message })`.

## Hard rules

- **NO `.test.gts` files.** Tests belong to a separate hardening phase
  invoked later over artifacts that earned them. This loop ships zero
  tests by design; do not "helpfully" add any.
- **Never write to the source realm**; all artifacts go to the target
  realm via the workspace.
- **Stay inside the workspace.** Native fs tools are structurally scoped
  to it; treat `Bash` as read-only inspection (`ls`, `grep`,
  `boxel search`, `boxel read-transpiled`) — never sync/push yourself.
- **Issue invariants**: `description` is immutable — append progress to
  the `comments` array instead (Read the issue JSON, append, Write back).
  You may set `status` only to `"blocked"` or `"backlog"`; `done` /
  `in_progress` are orchestrator-owned.
- **Write idiomatic source, never compiled output.** When an eval/
  instantiate error cites a line/column it refers to the transpiled JS —
  `boxel read-transpiled <path> --realm <url>` to map it back, then fix
  the `.gts` source.
- **Fields are an API.** Other cards compose with your card via its
  fields, its embedded/fitted surfaces, and its linksTo graph. Name
  fields for consumers; prefer FieldDefs for recurring shapes; keep
  per-format content matrices in mind (what does a consumer get at each
  size?).
