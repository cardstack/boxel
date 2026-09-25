# Project

{{project.objective}}

{{#if project.successCriteria}}
Success criteria:
{{#each project.successCriteria}}
- {{.}}
{{/each}}
{{/if}}

# Knowledge

{{#each knowledge}}

## {{title}}

{{content}}
{{/each}}

# Current Issue

ID: {{issue.id}}
Summary: {{issue.summary}}
Status: {{issue.status}}
Priority: {{issue.priority}}

Description:
{{issue.description}}

{{#if issue.checklist}}
Checklist:
{{#each issue.checklist}}
- [ ] {{.}}
{{/each}}
{{/if}}

{{#if toolResults}}

# Tool Results

You previously invoked the following tools. Use these results to inform your implementation.

{{#each toolResults}}

## {{tool}} (exit code: {{exitCode}})

```{{outputFormat}}
{{output}}
```

{{/each}}
{{/if}}

# Instructions — DESIGN TURN

This is the **design half** of a phase-split issue. Your ONLY deliverables
are accepted HTML mockups and design notes — a separate build turn (running
on a cheaper budget, forked from this session) will translate them into
card code. Do NOT write any `.gts`, `.json` instance, or Spec in this turn.

**Live-blog as you go.** Call `post_update` at every meaningful moment —
design kickoff, what each critique round found (name the defects), the
decision that resolved it. First person, 1–3 sentences.

## 1. Ground yourself

- **Scope check FIRST**: read `Knowledge Articles/build-plan.json` and
  your issue's "In scope (this pass)" list. Mock ONLY the in-scope
  surfaces at the in-scope sizes — if this pass says "fitted tile only,"
  do not design the wide strip or expanded card (a pass-2 issue owns
  those). Depth over breadth: make the small scope excellent.
- **BINDING design language — read it FIRST when it exists:**
  `Knowledge Articles/brand-guide.json` (guiding words, palette, rules),
  `design/tokens.css` (the CSS variables — your mockup MUST link this
  file and use its `--*` variables, never invent new colors/type), and
  `design/family-sheet.html` (what the family looks like — your card
  must read as a sibling of those, not a new style). Deviating from the
  brand guide is a defect; if the guide genuinely can't express this
  card, post the tension via `post_update` and extend the tokens rather
  than fork them.
- `Read` / `Glob` the workspace; `Bash` + `boxel search --realm <target-realm-url>` for cards already in the target realm, and the catalog realm for work already done (§2).
- Call `list_skills`, then `read_skill` the skills this issue touches.
  Read precedent: if a similar card exists in the workspace, read its `.gts`.

## 2. REUSE — decide what you are not building

The catalog is a library of work already done. Consult it **before** you
mock, not after: a schema you adopt is a given the mockup designs around,
and once these notes are handed off the schema is a contract the build turn
cannot reopen.

- **Enumerate the needs this issue implies, the card itself first.** The
  card you are building is need #1 — the catalog may already publish it, or
  one close enough to adopt. Then its fields, then any component or command.
  A list that starts at the fields has already decided the card is new.
- **Consult the catalog per need.** `catalog-reuse` has the query shapes and
  how to judge a hit — follow it rather than inventing a query.
- **Disposition every hit you get back.** Adopted, or refused naming the
  mismatched fields or the design rule it breaks. A hit you drop without
  saying why is indistinguishable from one you never saw.
- **Base-realm imports are not reuse.** `StringField`, `EmailField`,
  `ImageDef` and their siblings are the standard library. Never record one
  as a reuse decision.
- **If a gate blocks an adoption you want**, record it as `REUSE-BLOCKED`
  with the gate and its exact error and `post_update` the same — never
  quietly hand-build the thing instead.

**This step is not card code.** Naming a catalog module and its wiring form
in your notes is required of this turn and does not violate the no-`.gts`
rule below.

## 3. DESIGN — mock, screenshot, critique, revise

- Write `design/<card-slug>.html`: **ONE page** — plain HTML+CSS mockup with
  **hard-coded, realistic sample copy** (never lorem ipsum). Every surface on
  that one page, labeled: isolated (mobile; wide variant if the card prefers
  wide), fitted tiles (badge / strip / card), an embedded row.
- `screenshot_html({ path })`, `Read` the PNG, and **critique it**: name
  concrete defects (hierarchy, wrapping, spacing, color, copy) against the
  design language. Revise and re-screenshot. At least one full
  crit-and-revise pass; stop when you would show it to a designer.

## 4. Hand off

- Write `design/<card-slug>-NOTES.md`: the accepted design's intent in
  build-ready terms — schema fields implied by the mockup (names + types +
  which are FieldDefs), the CQ breakpoints used, theme-token mapping for
  every hard-coded color/size in the mockup, and any traps the builder must
  not miss. This file is the build turn's contract; write it like a spec.
- The notes MUST carry a **Reuse decisions** table — one row per need you
  enumerated in §2, including the card itself:

  | Need | Decision | Module + name | Wiring |
  | --- | --- | --- | --- |
  | Contributor (the card) | REUSE-BLOCKED | `@cardstack/catalog/…#Author` | welded to its own theme scope |
  | portrait | REFERENCE | `@cardstack/catalog/…#FeaturedImageField` | import + `contains` |
  | links out | REFERENCE | `@cardstack/catalog/…#ContactLinkField` | import + `contains` |
  | editorial calendar | GAP | — | none in catalog; build new |

  **One row per need, and the three decisions are told apart by cause:**

  - `REFERENCE` — the catalog has it and you are wiring it in.
  - `REUSE-BLOCKED` — the catalog has a candidate that ought to fit but
    cannot be used. Name the candidate and the mechanism that blocks it.
    You then build it yourself.
  - `GAP` — the catalog has nothing for this need. You build it yourself.

  `REUSE-BLOCKED` and `GAP` both end in building it yourself; what separates
  them is whether a candidate existed. Never record both for one need — the
  card itself is usually a `REUSE-BLOCKED`, because a near-miss card is
  exactly what the catalog does have.

  `Wiring` is `adoptsFrom`, import + `contains`, or `linksTo` for a
  `REFERENCE`; for the other two it carries the reason — the mismatched
  fields, or the mechanism that blocks adoption. Every definition you
  hand-build must carry a row — a `GAP` or a `REUSE-BLOCKED`, either is a
  correct outcome with a real reason. A hand-built definition with no row at
  all is the omission.
- `post_update` a `decision` summarizing the accepted design.
- Call `signal_done`. Do NOT set issue status; do NOT write card code.
