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

{{#if enableCatalogReuse}}
## 2. REUSE — decide what you are not building

The catalog is a library of work already done. Consult it **before** you
mock, not after: a schema you adopt is a given the mockup designs around,
and once these notes are handed off the schema is a contract the build turn
cannot reopen.

- **Enumerate the needs this issue implies, the card itself first.** The
  card you are building is need #1 — the catalog may already publish it, or
  one close enough to adopt or extend. Then its fields, then the components
  it renders through, then any command it invokes. A list that starts at the
  fields has already decided the card is new.
- **Consult the catalog per need.** `catalog-reuse` has the query shapes and
  how to judge a hit — follow it rather than inventing a query.
- **Search all four block kinds.** `field` and `card` are the ones that come
  to mind; `component` and `command` are reuse units too, and the catalog
  publishes them in quantity. A kind you never searched is a kind you cannot
  report on. What each kind entitles you to, and how each is wired, is in
  `catalog-reuse`.
- **Keep what you searched, not only what you found.** Record the realms and
  paths you queried and the result count for each — §5 puts them in the notes
  above the table. A count of zero for a tree that ought to be populated
  (`cards/`, `fields/`) means your *view* of the catalog is partial, not that
  the catalog is empty: say so via `post_update` and carry it into the notes
  as a caveat. A confident "nearest match" drawn from an incomplete index is
  worse than no conclusion at all, because nothing downstream can tell the
  two apart.
- **Disposition every hit you get back.** Adopted, extended, or refused
  naming the mismatched fields or the design rule it breaks. A hit you drop
  without saying why is indistinguishable from one you never saw.
- **A near miss is something to extend, not something to refuse.** When a
  catalog block has the right shape and is missing a few fields, `EXTEND` it
  and add them — that is what the catalog's own `Contact extends PersonBase`
  does. Reserve `REUSE-BLOCKED` for a candidate you genuinely cannot build
  on.
- **Presentation is a weak reason to refuse.** A component whose colors,
  spacing or type do not match the family is a theming delta, and theming is
  how that delta is closed (§4) — adopt it and theme it. Refuse on
  presentation only when the *structure* is wrong: it renders a fundamentally
  different affordance than the one this card needs.
- **The factory composes; it does not install.** `catalog-reuse` rule 5 says
  never hand-copy a Listing — reuse it whole through `install` or `remix`.
  That rule is written for a person furnishing a workspace, and it is **out of
  scope here**: this factory builds new cards from a brief, so a Listing is
  read as *precedent and parts* — the definitions inside it are reusable
  through the wiring forms below, the bundle itself is not installed. Do not
  record `install` or `remix` as a wiring form, and do not treat a matching
  Listing as a reason to stop building. If a Listing answers the brief so
  completely that building is obviously wasted, say so via `post_update` and
  let a human decide — that is a question about the brief, not a reuse
  decision you can take.
- **Base-realm imports are not reuse.** `StringField`, `EmailField`,
  `ImageDef` and their siblings are the standard library. Never record one
  as a reuse decision — §3 owns them instead.
- **A base type you inherit through an adoption is still not a reuse row.**
  When you `EXTEND` or adopt a catalog block, the fields it brings with it are
  already covered by that block's row — the adoption is the decision, and
  listing an inherited `EmailField` separately double-counts it and puts a
  base-realm module in a table that is supposed to mean "a catalog block was
  considered". Name the inherited fields in the adopting row's `Wiring`
  instead, and record the type itself in `Base types` marked `inherited`.
- **If a gate blocks an adoption you want**, record it as `REUSE-BLOCKED`
  with the gate and its exact error and `post_update` the same — never
  quietly hand-build the thing instead.

**This step is not card code.** Naming a catalog module and its wiring form
in your notes is required of this turn and does not violate the no-`.gts`
rule below.

{{/if}}

## 3. BASE TYPES — resolve each need to its most specific type

Reuse asks *whose definition*. This asks *which standard-library type*, and
it is a separate question that belongs to this turn: by the build turn the
schema is a contract, not a variable.

- For every need that resolves to a base-realm type, pick the **most
  specific type that fits** — `EmailField` over `StringField` for an email
  address, `PhoneNumberField` for a phone number, `UrlField` for a link, and
  likewise `DateField`, `BooleanField`, `EnumField`, `AddressField`,
  `AmountWithCurrency`, `ColorField`, `CountryField`. A specific type carries
  validation and a real editor; a string merely holds the same characters.
- **The issue body's field list states intent, not prescription.** An issue
  that says `email` (StringField) is naming the *need*; you are the step that
  resolves it to a type. Choose the more specific type over what the issue
  text names, unless that entry is marked `type-fixed:` — which means the
  concrete type is load-bearing and must survive.
- **A type you inherit from an adopted block still gets a line here**, marked
  `inherited` and naming the block it comes from. You did not choose it, but
  the build turn needs to know the field exists and must not re-declare it.
- Record these in a **Base types** block in the notes (§5), *not* in the
  Reuse decisions table. Keeping them apart is what lets the reuse table mean
  "a catalog block was considered" — a base-realm row in that table is a
  defect in both artifacts, **including one that arrived through an
  adoption**. If you catch yourself writing a `REFERENCE` row whose module is
  `https://cardstack.com/base/…`, it belongs in this block instead.

## 4. DESIGN — mock, screenshot, critique, revise

- Write `design/<card-slug>.html`: **ONE page** — plain HTML+CSS mockup with
  **hard-coded, realistic sample copy** (never lorem ipsum). Every surface on
  that one page, labeled: isolated (mobile; wide variant if the card prefers
  wide), fitted tiles (badge / strip / card), an embedded row.
- **Design around what §2 adopted.** An adopted block's structure is a given
  the mockup accommodates, not a proposal the mockup may overrule. Where its
  look differs from the family, close the gap with theme variables — restyle
  it, do not redraw it as something of your own.
- `screenshot_html({ path })`, `Read` the PNG, and **critique it**: name
  concrete defects (hierarchy, wrapping, spacing, color, copy) against the
  design language. Revise and re-screenshot. At least one full
  crit-and-revise pass; stop when you would show it to a designer.

## 5. Hand off

- Write `design/<card-slug>-NOTES.md`: the accepted design's intent in
  build-ready terms — schema fields implied by the mockup (names + types +
  which are FieldDefs), the CQ breakpoints used, theme-variable mapping for
  every hard-coded color/size in the mockup, and any traps the builder must
  not miss. This file is the build turn's contract; write it like a spec.
{{#if enableCatalogReuse}}
- The notes MUST open the reuse section with a **searched** line — the realms
  and paths you queried and how many specs each returned, per block kind:

  ```
  searched: catalog cards/ (41 specs), catalog fields/ (70), catalog
  components/ (62), catalog commands/ (11)
  ```

  If any count is zero or implausibly low for a tree that should be
  populated, follow the line with a `CAVEAT:` sentence saying the index looked
  partial and that every decision below was made over that partial view.
  A reviewer must be able to tell *nothing suitable exists* from *nothing was
  visible*.
- The notes MUST then carry a **Reuse decisions** table — one row per need
  you enumerated in §2, including the card itself:

  | Need | Kind | Decision | Module + name | Wiring |
  | --- | --- | --- | --- | --- |
  | Contributor (the card) | card | EXTEND | `@cardstack/catalog/…#PersonBase` | `extends`, adding `beat`, `column` |
  | portrait | field | REFERENCE | `@cardstack/catalog/…#FeaturedImageField` | import + `contains` |
  | links out | field | REUSE-BLOCKED | `@cardstack/catalog/…#ContactLinkField` | renders a mailto affordance; this card needs a display-only handle |
  | editorial calendar | component | GAP | — | none in catalog; build new |
  | publish | command | GAP | — | none in catalog; build new |

  **One row per need, and the four decisions are told apart by cause:**

  - `REFERENCE` — the catalog has it and you are wiring it in as-is.
  - `EXTEND` — the catalog has a near miss with the right shape; you adopt
    it as a base and specialize. Name the fields you are adding. Prefer this
    over `REUSE-BLOCKED` whenever the candidate can be built on.
  - `REUSE-BLOCKED` — the catalog has a candidate that ought to fit but
    cannot be used or extended. Name the candidate and the mechanism that
    blocks it. You then build it yourself.
  - `GAP` — the catalog has nothing for this need. You build it yourself.

  `REUSE-BLOCKED` and `GAP` both end in building it yourself; what separates
  them is whether a candidate existed. Never record both for one need.

  **One kind per row.** The `Kind` cell carries a single value — a block that
  could be read as two (a field whose renderer is the interesting part) is
  filed under what you would search for it as, with the other reading in the
  `Wiring` cell. `component/field` defeats a per-kind scan of the table, which
  is the whole reason the column exists.

  **Every block kind gets an accounting.** `card`, `field`, `component` and
  `command` must each appear — as a decision row, or as one explicit `GAP`
  row saying nothing in that kind fitted. A kind with no row at all is
  indistinguishable from a kind you never searched, which is the same
  ambiguity this table exists to remove.

  `Wiring` is `adoptsFrom` or `extends`, import + `contains`, or `linksTo`
  for a `REFERENCE` / `EXTEND`; for the other two it carries the reason — the
  mismatched fields, or the mechanism that blocks adoption. Every definition
  you hand-build must carry a row — a `GAP` or a `REUSE-BLOCKED`, either is a
  correct outcome with a real reason. A hand-built definition with no row at
  all is the omission.
{{/if}}
- The notes MUST carry a **Base types** block from §3 — one line per need
  that resolves to a base-realm type, naming the type and, where you
  overrode the issue text, what it said and why the more specific type wins:

  ```
  Base types
  - email → EmailField  [inherited from PersonBase — do not re-declare]
  - phone → PhoneNumberField (PersonBase declares StringField; narrowed here)
  - website → UrlField (issue said StringField; validated + link editor)
  - joinedOn → DateField  [type-fixed: per issue]
  ```

  Before you write the closing line, **check it against the table you actually
  wrote**: no row's module may start with `https://cardstack.com/base/`. A
  notes file that asserts compliance while carrying such a row is worse than
  one that carries it openly, because the assertion is what a reviewer reads.
- The theme-variable mapping names the **project Theme's** variables (the
  Theme card the design-foundation turn resolved). `design/tokens.css` is the
  mockup-time mirror of that Theme, not a second vocabulary — if the mockup
  needs a value the Theme has no variable for, extend the Theme and
  regenerate, rather than inventing a build-local name.
- `post_update` a `decision` summarizing the accepted design.
- Call `signal_done`. Do NOT set issue status; do NOT write card code.
