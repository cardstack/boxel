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

This skill is deliberately small. Most knowledge loads **on demand**,
two equivalent ways:

- **Files (preferred for discovery): the full skill catalog lives at
  `.claude/skills/<name>/` in your workspace** — SKILL.md overviews plus
  `references/*.md` deep docs. `Glob`/`Grep`/`Read` them like any
  project: `Grep -ri 'fitted' .claude/skills` finds the doc you didn't
  know existed. When unsure whether guidance exists for something you're
  about to build, grep here FIRST.
- **Tools**: `list_skills` for the catalog, `read_skill({ name })` /
  `read_skill({ name, reference })` for targeted loads.

Load what the current work touches, nothing more.

## When you need X, read Y

| Need                                                                                        | read_skill                                                 |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Card/field authoring, CardDef/FieldDef syntax, formats                                      | `boxel-development` (then specific `dev-*.md` references)  |
| Fitted-format layout rules                                                                  | `boxel-development` reference `dev-fitted-formats.md`      |
| Theme tokens / design-system CSS                                                            | `boxel-development` reference `dev-theme-design-system.md` |
| Search query syntax (`boxel search --query`)                                                | `boxel-api`                                                |
| Host commands via `boxel run-command`                                                       | `boxel-command`                                            |
| File-backed fields (images, files, csv)                                                     | `boxel-file-def`                                           |
| Catalog Spec conventions                                                                    | `boxel-development` reference `dev-spec-usage.md`          |
| Reusable UI components before hand-rolling any UI                                           | `boxel-ui-component-discovery`                             |
| What card code can reach (host tools, boxel-ui, runtime-common, AI services) + import paths | `boxel-runtime-surfaces`                                   |
| Search-driven home/app cards, `searchResultsComponent` wire-query contract, live feeds      | `boxel-live-surfaces`                                      |
| Embedding child cards (`<@fields.X @format=… />`), format choice, container chrome          | `boxel-delegated-render-control`                           |
| fetch/auth from card code (store APIs vs raw fetch vs request-forward proxy)                | `boxel-fetch-contexts`                                     |

Host-tool imports: the authoritative catalogue is the generated
`host-tools-import-manifest` skill already in your context — never guess
an import path; the `imports` validation step fails phantom ones.

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
   instances). **MANDATORY before writing any fitted template:
   `read_skill({ name: 'boxel-development', reference:
'dev-fitted-formats.md' })`** — it is the container-query standard
   (host `fitted-card` container, height quanta h40→h445, FittedCard
   component, overflow discipline). A fitted view that ignores it — one
   layout for all sizes, a local container on the root — fails review. The Spec MUST populate its catalog-facing `title` (display
   name) and `description` (one sentence) attributes in addition to the
   readMe — a Spec with empty title/description renders as an unnamed
   card in the catalog UI. Call `get_card_schema` before writing any
   card JSON whose shape you don't know (Spec, tracker cards).
4. **VERIFY**: `run_lint({ path })` per file, then `run_parse()`,
   `run_evaluate()`, `run_instantiate()`. Fix what they report. These
   return in-memory results; each one syncs your workspace to the realm
   first. Zero-coverage passes come back as errors — never treat them
   as green. **Never curl/HTTP-poll the realm for files you just wrote**
   — your writes only reach the realm when a `run_*` tool syncs them;
   a 404 from curl before that means nothing. Verify through the
   `run_*` tools. **Prefer `{ path }`-scoped checks on the file you're
   fixing** — whole-realm results include pre-existing failures in files
   you didn't write; note those with `post_update` and move on, never
   fix files outside your issue.
5. **Done**: `signal_done()`. If validation feedback comes back, fix and
   signal again. If truly blocked, `request_clarification({ message })`.
6. **Review**: after your signal_done, the issue enters REVIEW — a
   product-manager reviewer judges the rendered output. If it comes back
   with "Review feedback (rework requested)" in your context, those are
   the exact, complete required changes: make them with surgical
   `Edit`s (nothing more — improvements beyond the list belong to
   follow-up issues the reviewer files), then `signal_done` again.

## Hard rules

- **Live-blog with `post_update`.** The operator watches a live run-log
  card. Post at every meaningful moment — design kickoff, what each
  critique round found, decisions and tradeoffs, starting to code,
  recovering from a failed check. First person, 1–3 sentences, concrete.
  Never work silently for more than a few minutes; the commentary channel
  is as important as the artifacts.
- **NO `.test.gts` files.** Tests belong to a separate hardening phase
  invoked later over artifacts that earned them. This loop ships zero
  tests by design; do not "helpfully" add any.
- **Media fields are links to realm files, never inline bytes.** An
  image/file on a card is `@field x = linksTo(() => ImageDef)` (or
  FileDef) pointing at a real file in the workspace. NEVER design a
  field or FieldDef that stores `data:`/base64/blob strings in JSON —
  not even a 1×1 placeholder "just for the demo." A no-media-yet
  instance leaves the link empty and the template renders a placeholder
  block; the field's SHAPE stays correct.
- **Host command imports are `@cardstack/boxel-host/tools/<name>`** (e.g.
  `tools/write-binary-file`, `tools/save-card`). There is NO
  `@cardstack/boxel-host/commands/` path — imports from it fail only at
  runtime, after every static gate passes.
- **`@context.searchResultsComponent` consumes a WIRE query, not a plain
  Query.** Build it with `searchEntryWireQueryFromQuery(query)` from
  `@cardstack/runtime-common`, then attach `realms: [<realm url>]` (array
  — there is no `realm` key) and the display format via
  `filter.eq.htmlQuery = { eq: { format: 'fitted' } }`. Invoke in BLOCK
  form (`as |results|`, iterate `results.entries`, render
  `<entry.component />` inside a parent-sized cell). A plain Query
  self-closed renders NOTHING, silently.
- **Drag-and-drop intake must read `dataTransfer.items` as a fallback**
  when `dataTransfer.files` is empty (Photos.app-style drags deliver file
  promises), and every drop must paint visible feedback — a silent no-op
  drop is a defect.
- **Never write to the source realm**; all artifacts go to the target
  realm via the workspace.
- **Stay inside the workspace.** Native fs tools are structurally scoped
  to it; treat `Bash` as read-only inspection (`ls`, `grep`,
  `boxel search`, `boxel read-transpiled`) — never sync/push yourself.
- **Issue invariants**: `description` is immutable — append progress to
  the `comments` array instead (Read the issue JSON, append, Write back).
  You may set `status` only to `"blocked"` or `"backlog"`; `done` /
  `in_progress` are orchestrator-owned.
- **Fix with `Edit`, never re-`Write` an existing file.** After a file's
  initial `Write`, every subsequent change to it — bug fixes, check
  failures, small revisions — MUST be a surgical `Edit` (smallest
  search/replace span that fixes the problem). Re-emitting a whole
  `.gts` costs 1–2 minutes of generation per attempt vs seconds for an
  `Edit`; it is the single biggest time sink in a build turn. Only
  re-`Write` when more than half the file is changing.
- **Two identical check failures = stop rewriting, start reading.** If
  the same `run_*` check fails twice with the same error on your file,
  do NOT emit a third fix attempt on intuition — `read_skill` the
  matching reference from the table above, diagnose against the doc,
  then fix once with `Edit`.
- **Decorators fail inside class EXPRESSIONS.** `@tracked` (or any
  decorator) on a field of `static isolated = class ... {}` fails
  `run_parse` with "Decorators are not valid here". Hoist the component
  to a named top-level class declared ABOVE the card class
  (`class FooIsolated extends Component<typeof Foo> { ... }` then
  `static isolated = FooIsolated;`), and type a constructor's `owner`
  param as `Owner` (or `any`) — `unknown` fails against Component.
- **Write idiomatic source, never compiled output.** When an eval/
  instantiate error cites a line/column it refers to the transpiled JS —
  `boxel read-transpiled <path> --realm <url>` to map it back, then fix
  the `.gts` source.
- **Fields are an API.** Other cards compose with your card via its
  fields, its embedded/fitted surfaces, and its linksTo graph. Name
  fields for consumers; prefer FieldDefs for recurring shapes; keep
  per-format content matrices in mind (what does a consumer get at each
  size?).
- **Stay inside your issue's declared scope — never gold-plate.** Read
  `Knowledge Articles/build-plan.json` (how this issue fits the whole
  build) and your issue's "In scope (this pass)" list. Deliver EXACTLY
  that scope, polished. Items under "Deferred (second pass)" are OUT of
  scope — they have their own pass-2 issue; building them now wastes the
  budget and duplicates future work. Small-and-polished beats
  broad-and-rough. If you spot something important that no pass covers,
  note it via `post_update` — do not build it.
