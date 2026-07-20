# Boxel card development — project conventions

You are building Boxel cards in this workspace: a local mirror of the
target realm. `.gts` files are card definitions (Glimmer TypeScript);
`<Type>/<id>.json` files are card instances (JSON:API). Schema, behavior,
and rendering live together on each card.

**The full skill catalog is at `.claude/skills/<name>/`** — SKILL.md
overviews plus `references/*.md` deep guides. When unsure whether
guidance exists for what you're about to build, `Grep -ri <topic>
.claude/skills` FIRST. Key deep references:
`boxel/references/container-query-fitted-layout.md` (the fitted
standard), `boxel/references/design-playbook.md` (mockup → tokens →
derive formats), `boxel-ui-guidelines/references/delegated-render-control.md`
(embedding child cards).

## Conventions (binding)

- **Three formats minimum.** Every CardDef ships `isolated`, `embedded`,
  AND `fitted` templates.
- **CQ fitted layout is mandatory for every fitted template.** Query the
  host-provided `fitted-card` size container — never create your own
  container on the root. Single root `.fit` grid at 100%×100%, content
  matrix per height quantum, `minmax(0, 1fr)` body rows, `overflow:
hidden` discipline. Prefer the `FittedCard` component from
  `@cardstack/boxel-ui/components` for standard compositions. Read the
  container-query-fitted-layout reference before writing fitted CSS.
- **Theme variables only** — templates reference `var(--*)` tokens; no
  hard-coded colors.
- **Format choice = who owns the cell size.** `@format='embedded'` lets
  the child decide its height (lists, feeds, rows); `@format='fitted'`
  fills a parent-controlled box (uniform tile grids). Read
  delegated-render-control before embedding child cards.
- **One CardDef per file.** FieldDefs and helpers can co-locate.
- **Override `cardTitle` when there's a primary field**: respect
  `cardInfo.name` first, then the primary field, then
  `Untitled <DisplayName>`.
- **Include `attributes.cardInfo` on instances** (even all-null) so
  name/summary/theme stay user-editable.
- **Fields are an API.** Other cards compose via your fields, embedded/
  fitted surfaces, and linksTo graph — name fields for consumers, prefer
  FieldDefs for recurring shapes.

## Cardinal rules (silent-failure traps — violations pass lint, then break)

- **`DateField` value = `YYYY-MM-DD` (no `T`); `DateTimeField` = ISO
  datetime with `T`.** Mismatch crashes at render. `*At` → DateTimeField;
  `*Date`/`*On`/`dob` → DateField.
- **Never put an external URL in `relationships.<field>.links.self`** —
  it poisons the whole realm's indexing transaction. External images use
  the pair pattern: `linksTo(ImageDef)` + `contains(UrlField)`.
- **`linksToMany` JSON uses indexed top-level keys**
  (`"items.0": { "links": { "self": "../foo" } }`), never an array.
- **Never inline media/binary in card JSON.** No `data:`/base64/blob
  strings in any attribute — not even a placeholder. Media fields are
  `linksTo(FileDef/ImageDef)` pointing at a real realm file; a
  no-media-yet instance leaves the link empty and the template renders a
  placeholder block.
- **Query filters: `filter: { type: ref }` selects all cards of a type;
  a bare `{ on: ref }` only scopes predicates and silently returns
  nothing.** Every card-owned query is realm-scoped and bounded.
- **Base fields are default exports** in base modules; there is no
  `ImageDef` in `/base/image`.

## Working style

- **Fix with `Edit`, never re-`Write` an existing file** — surgical
  search/replace on the failing lines. Re-emitting a whole `.gts` costs
  minutes; only re-`Write` when more than half the file changes.
- Read before writing; keep changes scoped to the card you own.
- Design before schema on user-facing cards: mockup with real sample
  copy, critique, then translate (design-playbook reference).
