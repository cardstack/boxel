# Boxel Skill-Tree Glossary

The full index of terms, concepts, libraries, components, helpers, conventions, patterns, and slash commands covered across the skill tree. Treat as the "back-of-the-book" reference — scan a section to find what you need, then jump to the deeper file for the full treatment.

> **Maintenance contract**: keep this file current whenever a skill, reference, pattern, extension, or convention is added, renamed, or removed.
>
> - When you add a new pattern under `boxel-patterns/patterns/`, add a one-line entry under [Patterns](#patterns).
> - When you add a new reference under `boxel/references/` or a sibling skill, add a one-liner under the relevant topical section + cross-link.
> - When a term changes name (e.g. JQXL → bxl) or a deprecated path is removed, update the entries here and add a "(formerly *X*)" only if back-compat surface still exists; otherwise drop the old term entirely.
> - When `/distill-learnings` folds a learning into a skill reference, add or update the entry here so the consolidated term is findable.

Entry shape: `**Term** — one-sentence definition + (optional) where it's covered: → \`skill/path/reference.md\`, → `pattern-slug`, or → external URL.`

---

## 1. Core framework concepts

- **Card** — A typed schema + reactive Glimmer Component + JSON instance, all colocated in a `.gts` file. The unit of construction in Boxel. → `boxel/references/core-concept.md`
- **CardDef** — Base class for cards (full-document things — Project, Person, BlogPost). Extends from `https://cardstack.com/base/card-api`. Has `static isolated`/`embedded`/`fitted` Components.
- **FieldDef** — Base class for fields (compound or single-value building blocks reused across cards — Address, DateRange, ContactPoint). Co-located in the same file as the CardDef that owns them, or shared in their own module.
- **Box** — The base for all values, both `CardDef` and `FieldDef` extend it; rarely referenced directly.
- **Component** — Glimmer component associated with a CardDef format via `static isolated = class extends Component<typeof X> { <template>…</template> }`.
- **instance** — A saved JSON `.json` document in a realm; one card instance per file.
- **realm** — A filesystem + git repo serving cards over HTTP. Each is its own git repo via `.boxel-history/`.
- **host mode** — The realm-server's public published-realm rendering path (`/index.html` + prerendered HTML). Distinct from operator/interact mode.
- **operator mode / interact mode / code mode** — Three host UI modes. Interact = browse/edit cards; code = source view; operator = combined editor.
- **prerendered HTML** — Cached server-side HTML for each card's format (isolated/embedded/fitted), used to bypass client-render latency.

## 2. Schema — `@field` decorators & relationships

- **`@field`** — TS decorator that registers a property on a CardDef/FieldDef.
- **`contains(FieldDef)`** — Single embedded field; serializes inline in JSON `attributes`.
- **`containsMany(FieldDef)`** — Repeated embedded fields; serializes as a JSON array in `attributes`.
  - *Perf trap:* `containsMany(FieldDef)` × N items × M sub-fields = N×M inline editors per keystroke. Lift to `linksToMany(CardDef)` once N>3 with non-trivial editor surface.
- **`linksTo(CardDef)`** — Single link to another card. Serializes under `relationships.<field>.links.self`.
- **`linksToMany(CardDef)`** — Multiple links. Serializes as indexed keys `field.0`, `field.1` (NOT a JSON:API `data` array).
- **`searchable` field option** — Per-field `true | string | string[]` on a `linksTo`/`linksToMany` deciding which linked targets are followed into the card's **search doc** (contained fields are always in; links are opt-in). Dotted-path routing; querying a non-searchable path errors. → `boxel/references/searchable-fields.md`
- **`getRelationshipMembershipState(this, 'field')`** — Live `{ isLoading, membership }` for a `linksTo`/`linksToMany`; bind `.isLoading` to drive a spinner (flagship: query-backed `linksToMany`). Observe-only — the template must also read the field or the load never starts. → `boxel/references/relationship-loading-state.md`
- **linked-slot `undefined` contract** — Reading a `linksTo`/`linksToMany` is not like `contains`: a slot is `undefined` while loading and forever if broken; `linksToMany` keeps broken/unloaded slots as `undefined` holes (`arr.length` unchanged). `.filter(Boolean)` before count/render; guard every traversal. Per-slot state via `getRelationship` / `RelationshipState` (`present | not-loaded | error | not-found | not-set`). → `boxel/references/defensive-link-traversal.md`
- **broken-link placeholder** — The DOM placeholder Boxel renders for a broken `linksTo`/`linksToMany` target — the canonical "something's wrong" signal, exposed via `data-test-broken-link-*` attributes (`error` vs `not-found`). Follow the URL to the linked instance to remediate. → `boxel-environment/references/diagnosing-broken-links.md`
- **`computeVia: fn`** — Derive a field's value from other fields. Function runs on each access; mark with `cacheable: true` for expensive computations.
- **`computeVia: expression(...)`** — bxl-flavored `computeVia` that runs a bxl expression with the card's fields as context. → `library-bxl`, `bxl-computevia-fields`
- **`cardInfo`** — Base CardDef field on every card. Holds `name`, `summary`, `theme` (linksTo Theme), and `cardThumbnail`. Per-instance metadata users edit via the UI.
- **`cardTheme`** — Computed field on a CardDef that resolves which Theme to apply. Default = pass-through to `cardInfo.theme`; CardDefs override to inherit from a linked card (`this.project.cardTheme`), query for a realm default, or derive by business logic. → `theme-first-workflow`, `boxel/references/theme-design-system.md`
- **`cardTitle`** — Computed field that surfaces the card's display label. Override to respect `cardInfo.name` first, then a primary field, then `Untitled <DisplayName>`. → `cardinfo-override-title`
- **primary field** — A schema-level concept: the field that names the card (`firstName + lastName`, `headline`, `title`, etc.). Drives the `cardTitle` fallback.
- **`instanceOf`** — Type guard for CardDef instances.

## 3. Templates — Glimmer / Boxel UI surface

- **`<@fields.x />`** — Render a field through its FieldDef's view for the current format. The host injects chrome (CardContainer wrapper) around the child.
- **`@format='isolated'|'embedded'|'fitted'|'edit'|'atom'`** — Override the default format when delegating to a child via `<@fields.x @format='…' />`.
- **`@model`** — The card/field instance accessed inside a Component. `@model.firstName`, `@model.body`, etc.
- **`@context`** — Host context object exposing `commandContext`, `prerenderedCardSearchComponent`, `viewCard`, etc.
- **`<style scoped>`** — Boxel's scoped-CSS block. Must be a direct child of `<template>`; doesn't propagate scope hash into inner GlimmerComponent classes.
- **`:deep()`** — Pierce the scoped-CSS boundary to style inner host-injected wrappers (`.boxel-card-container`, `.plural-field`, etc.). → `boxel-ui-guidelines/references/delegated-render-control.md`
- **plural-field wrapper** — `<@fields.X @format='…' />` for a `containsMany`/`linksToMany` injects `.plural-field` + per-item wrappers (`.containsMany-item`, `.linksToMany-itemContainer`) between your grid and the cards. Apply `display: contents` cascade. → `boxel-ui-guidelines/references/delegated-render-control.md`
- **chrome contract** — The host wraps every child card in a `CardContainer` with borders, halo, padding. The parent overrides via `:deep()`, theme cascade, or `@displayContainer={{false}}`. → `boxel-ui-guidelines/references/delegated-render-control.md`
- **divider strategy (binary)** — Either parent draws dividers AND kills child halo (`.boxel-card-container--boundaries { box-shadow: none; }`), OR child halo IS the boundary AND parent skips borders. Doing both = "drop shadow fighting thin border."
- **block param shadow trap** — `as |s|`, `as |section|`, `as |option|` etc. that shadow HTML tag names throw `TypeError: Cannot read properties of null (reading 'manager')`. Use unambiguous names.
- **`{{#if this.x}}`** — Guard a block by a class getter / tracked property. **Don't write `{{#if (this.x)}}`** — wrapping in parens makes Glimmer treat it as a helper invocation; class getters fail silently.
- **keyed single-item `{{#each}}` remount** — Wrap a visual subtree in `{{#each (array trackedValue) key='@identity'}}` when changing tracked state must recreate its DOM and replay entrance animation; keep persistent controls outside the keyed subtree. → `boxel-ui-guidelines/references/template-patterns.md`
- **template helpers (importable from `@ember/helper`)** — `fn`, `hash`, `array`, `get`, `concat`. Must be imported in `.gts`.
- **template helpers (Boxel UI)** — `eq`, `not`, `and`, `or`, `gt`, `gte`, `lt`, `lte`, `add`, `subtract`, `multiply`, `divide`; `cn` (class names), `cssVar`, `element` (dynamic tag), `optional`, `pick`. → `boxel/references/common-imports.md`
- **template formatters (Boxel UI helpers)** — `formatDateTime`, `formatNumber`, `formatCurrency`, `formatRelativeTime`, `formatDuration`, `formatCountdown`, `formatFileSize`, `formatList`, `formatNames`, `formatOrdinal`, `formatPeriod`, `formatAge`. → `boxel/references/formatters.md`
- **`markdownEscape`** — Escape user input inside `static markdown` templates. → `boxel-markdown-format`

## 4. Formats

The five formats every CardDef can declare via `static <format> = class extends Component<typeof this> {…}`:

- **`isolated`** — Full-page card view. Usually `prefersWideFormat = true`.
- **`embedded`** — Inline card view inside another card. Natural height; renders into the parent's flow.
- **`fitted`** — Container-sized card view that fills a parent-controlled box. Used in CardsGrid, fitted-format frames. → `boxel/references/fitted-formats.md`, `boxel/references/container-query-fitted-layout.md`
- **`edit`** — Editor surface; only shown in operator/interact edit mode. Defaults to a field-stack.
- **`atom`** — Inline atom view (chip/pill); used in dense lists and inside text.
- **`markdown`** — Static markdown output format; the card's `static markdown = ...` template emits BFM. → `boxel-markdown-format`

**Picking the format**: format choice = who owns the cell size. `embedded` = child decides height (lists, feeds). `fitted` = child fills parent box (uniform tile grid). Fitted with short content = empty box; the fix is the format choice, not CSS. → `boxel-ui-guidelines/references/delegated-render-control.md`

**16 named fitted sizes** — The host previews fitted cards at 16 size cells (3 Badges + 5 Strips + 5 Tiles + 3 Cards). Every fitted view must verify against all 16. → `boxel/references/fitted-formats.md`

**Sub-format strategy (badge/strip/tile/card)** — `@container fitted-card (max-width:150px) and (max-height:169px)` activates badge layout, etc. Four discrete layouts, not one elastic layout. → `boxel/references/container-query-fitted-layout.md`

**`prefersWideFormat`** — Static class property on a CardDef (`static prefersWideFormat = true`). When `true`, the host renders `isolated` at full viewport width instead of the default narrow center column. **The most-forgotten static property — decide at CardDef creation, not after the layout looks cramped.** Set true for: app-card homes, long-record cards with side nav, dashboards / multi-card layouts, document / multi-column article cards, 3D / spatial layouts, routed page cards, spreadsheet-driven cards, slide decks. Leave false for: detail / record cards, single-column forms, notes, settings panels, atom-flavored detail surfaces. → `boxel/references/prefers-wide-format.md`

## 5. Query system

- **`Query`** — Type imported from `@cardstack/runtime-common`. Carries `filter`, `sort`, `realmURLs`.
- **`getCards(this, queryThunk)`** — Component-level reactive query. Returns an object with `instances`, `isLoading`. Best inside `static isolated` Components.
- **`getCard(this, urlThunk)`** — Component-level reactive single-card fetch.
- **`@context.searchResultsComponent`** — Preferred entry-rooted result-list surface (`<SearchResults>`); each yielded `entry.component` renders itself (prerendered HTML or live card, no branching). Build `@query` with `searchEntryWireQueryFromQuery` + `realms`; `@mode` controls hydration. Supersedes `PrerenderedCardSearch`. → `boxel/references/query-systems.md`
- **`searchEntryWireQueryFromQuery` / `SearchEntryWireQuery`** — Helper + type (from `@cardstack/runtime-common`) that turn an ordinary query into the entry-rooted query `@context.searchResultsComponent` expects. → `boxel/references/query-systems.md`
- **`PrerenderedCardSearch`** — Live-updating component that renders matching cards in a chosen format. Pass `@query`, `@realms`, `@format`, optional `@isLive`. Older display surface — `@context.searchResultsComponent` is preferred for new work. → `show-card-list-with-views`, `app-card-home-with-search`
- **`prerenderedCardSearchComponent`** — Lower-level component-factory accessed via `@context.prerenderedCardSearchComponent`.
- **`@isLive={{true}}`** — Re-fetch on every realm change. **Pay-per-keystroke cost; default OFF** unless you specifically need live updates.
- **filter `type`** — `filter: { type: codeRef(…) }` selects all instances of a CardDef. **THE ONLY way to filter-by-type.**
- **filter `on`** — `filter: { on: codeRef(…), eq: { status: 'active' } }`. `on` is a *scope* for predicates (`eq`/`contains`/`range`), NOT a filter by itself. A bare `{ on: ref }` returns zero rows silently.
- **filter predicates** — `eq`, `contains`, `range`, plus `every: [...]` / `any: [...]` for composition. Predicates require an `on:` scope.
- **`sort`** — Array of `{ by, direction }` entries. Custom sort fields require `on: ref` inside the sort entry. Only `lastModified`, `createdAt`, `cardURL` are generalSortFields (no `on:` required).
- **`codeRef(here, path, name)`** — Build a `ResolvedCodeRef` for use in queries. Imported from `@cardstack/runtime-common`. → `boxel/references/query-systems.md`
- **`realmURL`** — A **Symbol** exported from `@cardstack/runtime-common` AND `https://cardstack.com/base/card-api`. **Don't write `Symbol.for('realmURL')`** — that creates a different Symbol. Read realm via `card[realmURL]?.href`.
- **silent zero-rows traps** (memorize) — (1) `filter: { on: ref }` with no predicate. (2) Custom sort field without `on:`. (3) `Symbol.for('realmURL')` instead of the canonical Symbol import. (4) Bare `links.self` like `"Foo/bar"` instead of `"./Foo/bar"` — relationship deserialization throws and the parent card silently fails to index. (5) FileDef-typed relationships dropping the file extension (e.g. `"../guide"` instead of `"../guide.md"`) — file exists but parent card fails to type-filter. → `boxel/references/query-systems.md`, `boxel/references/card-references.md`
- **verified query composition patterns** — Templates that have been confirmed against a live realm + indexer (not just inferred from source): `every: [{ type: ref }, { on: ref, eq: { … } }]`, `… in: { field: [values] } …`, `… range: { field: { gte: … } } …`, `… contains: { cardTitle: … } …`. Build a **validation lab card** in the realm with one `@context.searchResultsComponent` section per pattern you depend on; assert non-empty results in browser QA. → `boxel/references/query-systems.md`
- **transient federated-search failures** — `npx boxel search` can briefly return `Realms not found` right after a new card landing while the realm-server settles. Read files back, `npx boxel realm wait-for-ready`, validate via `@context.searchResultsComponent`, then retry. → `boxel-environment/references/workflows-and-orchestration.md`

## 6. Theme system

- **Theme CardDef** — A card that stores a brand's `cssVariables` (`--background`, `--foreground`, `--primary`, `--muted`, `--border`, etc.) plus typography + assets.
- **Structured Theme** — Theme subclass with structured `rootVariables`, `darkModeVariables`, `typography`, and `version`; computes `cssVariables` instead of requiring a hand-authored CSS string. Use for token-only themes.
- **Style Reference** — `StructuredTheme` subclass that adds `styleName`, `inspirations`, `visualDNA`, and `wallpaperImages`. Use when the visual language needs to be documented.
- **Detailed Style Reference** — `StyleReference` subclass with long-form design guidance: context, palette, typography, geometry, material, composition, motion, component vocabulary, voice, technical specs, application scenarios, quality standards, and design mindset.
- **Brand Guide** — `DetailedStyleReference` subclass that adds brand assets and governance: `brandColorPalette`, `functionalPalette`, `typography`, and `markUsage`. Use when logo/mark material or official brand colors matter. → `boxel/references/theme-design-system.md`
- **Boxel Brand Guide** — Built-in Brand Guide at `https://cardstack.com/base/Theme/boxel-brand-guide`. Source of truth for Boxel built-in feature styling, base cards, host-facing Boxel UI, and Boxel-branded catalog material.
- **Functional Palette** — Brand Guide field mapping brand intent to variables: `--brand-primary`, `--brand-secondary`, `--brand-accent`, `--brand-light`, and `--brand-dark`; Brand Guide maps these into semantic theme tokens when needed.
- **Mark Usage / BrandLogo** — Brand Guide field for primary/secondary marks, greyscale marks, social profile icon, minimum heights, and clearance ratios. Emits `--brand-*-mark` variables for templates.
- **`cardInfo.theme`** — Per-instance theme override (`linksTo(Theme)`). Wins over any computed `cardTheme`.
- **`cardTheme`** — Computed field returning the active Theme for this instance. Default is pass-through to `cardInfo.theme`; override to inherit from a parent card or query a realm-default.
- **theme tokens** — CSS custom properties referenced from templates: `var(--background)`, `var(--primary)`, `var(--muted)`, `var(--border)`, `var(--radius)`. Always referenced from theme tokens, never hard-coded `#hex` values in production templates.
- **shadcn/Boxel token mapping** — Boxel consumes shadcn-style tokens as paired surface/foreground contracts. `--primary` is an action surface or indicator, not ordinary text; `--spacing` is a quarter-unit that becomes `--boxel-sp` after runtime scaling. → `boxel-theme-development/references/shadcn-boxel-token-mapping.md`
- **theme cascade** — Host injects the Theme card's `cssVariables` as CSS custom properties on the card root. Children inherit; cross-card delegated rendering retains the parent's theme unless overridden.
- **theme-first workflow** — Choose/create a Theme BEFORE writing the card. Link via `cardInfo.theme`; templates use tokens from line one. → `theme-first-workflow`
- **drop-in CSS themes** — Per-theme CSS files override `--*` tokens at runtime; no JS branching. → `theme-css-token-redefinition`

## 7. Design playbook

The 4-stage recommended process for any user-facing card:

1. **Stage 1 — Mockup with no variables.** Direct hex colors, named fonts, specific pixel sizes. Trust intrinsic taste. Pentagram art-director / internal-taste-maker brief.
2. **Stage 2 — Extract theme DNA.** Audit the mockup; pull out color tokens, typography pair, spacing rhythm, asset direction.
3. **Stage 3 — Tokenize.** Replace direct hexes/fonts/sizes with `var(--*)` references; build a Theme card to hold them.
4. **Stage 4 — Derive fitted + embedded.** Walk the 16 named fitted sizes, verify type hierarchy + composition holds; build embedded from the most rest-friendly cell.

→ `boxel/references/design-playbook.md`

## 8. Lint workflow

- **`npx boxel file lint <path> --realm <url> --file <local-file>`** — Local lint before push. Use during development.
- **`npx boxel lint <path> --realm <url>`** — Remote lint after push. Authoritative check.
- **`npx boxel check`** — Removed from the current monorepo CLI. It was a legacy standalone sync-state command; use `npx boxel file lint` / `npx boxel lint` for lint.
- **Clean lint output** — `No lint issues found` (text) or `{ "messages": [] }` (JSON).
- Lint is **mandatory** before declaring `.gts` work done. → `boxel/references/lint-workflow.md`

## 9. File-backed fields (FileDef family)

- **`FileDef`** — Generic file-backed field base. → `boxel-file-def/SKILL.md`
- **`ImageDef`** — Image file-backed field; generic image type.
- **`PngDef`, `JpgDef`, `WebpDef`, `AvifDef`, `GifDef`, `SvgImageDef`** — Format-specific image subtypes.
- **`MarkdownDef`** — File-backed markdown asset (distinct from `MarkdownField`, which is a value).
- **`--markdown-embedded-max-height` / `--markdown-embedded-mask`** — Custom properties the base `MarkdownDef` embedded format exposes to tune its bounded preview (defaults `200px` + a bottom fade). Set both to `none` on an ancestor for full content; the framework-driven embedded render can't take component args, so an inherited custom property is the cross-boundary lever. → `boxel-ui-guidelines/references/delegated-render-control.md`
- **`CsvFileDef`, `JsonFileDef`, `TextFileDef`, `TsFileDef`, `GtsFileDef`** — Text-format file-backed assets.
- **`Base64ImageField`** — Legacy inlined-base64 image. **Don't use for new cards** — embeds binary in JSON. Use FileDef subtypes instead.
- **No-inline-binary rule** — Never `data:`, `blob:`, base64, image bytes, MP3 bytes in `StringField`, `outputText`, notes, or any JSON attribute. Use FileDef subtypes; for generated bytes, write to a realm file via `WriteBinaryFileCommand` first. → `boxel-file-def/references/no-inline-binary.md`
- **`linksTo(FileDef)`** — How a card references a file-backed asset.
- **Relationship-path-with-extension rule** — When linking to a `MarkdownDef` etc., the relationship path needs the actual file extension.
- **published raw FileDef URL** — Public host HTML should point raw `<img>`/media elements at the published mount path, not an authenticated source-realm URL; reindex after changing it so cached HTML is refreshed. → `boxel-file-def/references/using-filedef-in-cards.md`

## 10. BFM — Boxel Flavored Markdown

The dialect Boxel reads and writes. See [bfm.boxel.site](https://bfm.boxel.site).

- **CommonMark + GFM baseline** — headings, lists, code fences, tables, alerts (`> [!NOTE]`), task lists, strikethrough, footnotes, extended autolinks.
- **`:card[<url>]`** — Inline card-embed directive.
- **`::card[<url>]`** — Block card-embed directive.
- **`::card[<url> | size]`** — Sized block card-embed.
- **`[[name]]` / `![[name]]`** — Wiki links / embeds (Obsidian compatibility).
- **`==text==`** — Highlights.
- **`^block-id`** — Block references.
- **`# Heading {#custom-id}`** — Heading IDs.
- **Math** — `$inline$` / `$$block$$` LaTeX rendered via KaTeX.
- **Mermaid** — ` ```mermaid ` fenced diagrams.
- **Fenced renderers (data-in)** — `mermaid`, `geojson`, `topojson`, `stl` (3D model viewer), `math`, `csv` (auto-rendered table), `slides`, `excalidraw`, `kanban`.
- **Computed renderers (data-from-document)** — `toc` / `table-of-contents`, `comments`, `tasks`, `backlinks`, `outlinks`, `graph`, `tags`.
- **Card layout renderers** — `canvas` (JSON canvas with positioned frames), `timeline`, `gallery`, `chart`, `embed`.
- **`markdown-helpers`** — Pre-escaped formatters for dates, links, images, card embeds.

→ `boxel-flavored-markdown`, `boxel-markdown-format`, `show-runtime-markdown-html`, `show-wiki-links`

## 11. Container queries + fitted layout

- **`container-name: fitted-card`** — Already set by the host on every fitted-card wrapper; reference it in `@container fitted-card (...)` queries.
- **single-root `.fit` pattern** — The mandatory fitted template skeleton: one root `.fit` grid queried against the host's `fitted-card` container; never create your own container on the root. (Supersedes the old two-element `.cq` → `.fit` pattern.) → `boxel/references/container-query-fitted-layout.md`
- **`FittedCard`** — boxel-ui slot-fill component; the preferred starting point for standard fitted templates (implements the `fitted-card` queries internally, tuned via `--fc-*` variables). → `boxel-ui-guidelines/references/use-boxel-ui-components.md` + the "Prefer `<FittedCard>`" section of `container-query-fitted-layout.md`
- **six height quanta** — Six discrete `@container` ranges for fitted body content.
- **`minmax(0, 1fr)` body row** — Required for grid-children inside fitted cards; `auto` rows for body content overflow at edge sizes.
- **`min-height: 0` on grid children** — Required so flex/grid children can shrink rather than overflow.
- **`pow()`-based typography** — Hierarchical type scale defined via CSS `pow()` for fitted layouts.
- **magazine-spread / thumbnail-sidebar width thresholds** — Specific cq breakpoints that swap the fitted layout role.

## 12. Realm system + routing + permissions

- **`realm.json`** — Card instance of `https://cardstack.com/base/realm-config` `RealmConfig` at the realm root. Holds `backgroundURL`, `iconURL`, `hostRoutingRules`, etc.
- **`RealmConfig`** — Base CardDef for the realm-level config card.
- **`RoutingRuleField`** — FieldDef inside `RealmConfig.hostRoutingRules`. Each rule = `{ path: StringField, instance: linksTo(CardDef) }`.
- **`hostRoutingRules`** — `containsMany(RoutingRuleField)` on `RealmConfig`. Maps clean paths (`/`, `/about`, `/blog`) to cards in the same realm.
- **same-realm guard** — Defensive read-time filter that drops routing rules pointing at cards in *other* realms. Prevents private-realm card surfacing via a public realm's URL.
- **published realm** — Realm reachable by anonymous visitors over HTTPS at a public domain.
- **print and published-output hardening** — Unclip host wrappers in print media, use semantic SVG fill attributes, validate Chromium and Firefox print output, and reindex before checking published HTML. → `boxel-ui-guidelines/references/print-and-published-output.md`
- **`/_search-prerendered`** — Deployment-specific realm-server endpoint for prerendered HTML. Where exposed, call it with HTTP `QUERY`, not `GET`; otherwise use `npx boxel search --json` and inspect `relationships.html`.
- **`.boxel-history/`** — Per-realm git repo for change history; managed by `boxel-cli`.
- **`.boxel-sync.json`** — File → md5 checksum manifest the CLI compares against during pull/push/sync.
- **public permissions** — Realm-level setting that determines whether anonymous host-mode requests resolve.

→ `link-host-mode-paths`, `boxel-environment`, `boxel-cli`

## 13. Realm-bundled libraries (workspace-specific)

Substantial JS libraries shipped *inside* a realm filesystem rather than via npm. Realm-bundle-shim convention: a one-line `<lib>.ts` re-exporting from `./<lib>/index.ts`.

- **`common-libs`** — Convention name for the realm hosting bundled libraries. Cards in other realms import via absolute URL (e.g. `<host>/common-libs/<lib>`); cards inside `common-libs` import relatively.
- **bxl** — The workspace's unified computation runtime: a jq-flavored JSON query language + Excel-compatible formula libraries (Bessel, statistical, financial, engineering, validation). Exports `evaluateBxl`, `bxl`, `expression`, `expr`, `jq`, `fx`, `prepareBxl`, plus the formula function catalog. → `library-bxl`, `extension-libs/bxl/`, [bxl.boxel.site](https://bxl.boxel.site)
- **surfaces** — UI framework. Layout / Pane / Form / Grid / Cell / Run / Lift primitives + focus-tree keyboard nav + drop-in CSS themes + canvas/scene runtimes. → `library-surfaces`, `surface-form-card`, `surface-field-kit`, `surface-default-template`
- **surfaces/grid** — Table engine. Re-exports `@tanstack/table-core` (`Row`, `RowData`, `Table`, `TableFeatures`, `createTable`, `getCoreRowModel`, `getSortedRowModel`, etc.). Reach through surfaces, not directly via esm.run.
- **surfaces/scene** — Spatial scene runtime; ember-lume POC primitives inlined (`scene-fx-modifier`, `wheel-momentum`, `scene-runtime`, `scene-node-state`, `halo-modifier`, `camera-drag`).
- **surfaces/canvas** — Canvas surface (XYFlow-flavored alternative native to surfaces).
- **ember-flow** — Boxel-flavored XYFlow port. Drag-droppable nodes, draggable edges, pan/zoom canvas, minimap, controls. Shipped as `ember-flow-dependencies.js` + `ember-flow-markdown-dependencies.js` single-file bundles. → `library-ember-flow`
- **pretext** — Two-phase canvas text-measurement engine (Chen Glou / Sebastian Markbage). Inlined per-card (no separate import URL because Boxel's GTS compiler requires module exports). → `library-pretext`
- **ember-lume** — Spatial Lounge POC. Source primitives in the surfaces source repo's `test-app/lib/ember-lume/`; the production-relevant pieces are inlined into `surfaces/scene/`. Don't reach for ember-lume directly.
- **TanStack table-core / store** — Inlined into `surfaces/grid/`. Don't import via esm.run; go through surfaces so versions stay pinned to what surfaces was tested against.
- **realm-bundle-shim convention** — One-line `<realm>/<lib>.ts` that does `export * from './<lib>/index';`. Lets cards import via `'./<lib>'` (or absolute URL) regardless of whether the bundle is chunked. → `organize-realm-bundle-shim`

## 14. External libraries (ESM CDN)

Direct browser ESM imports for libraries Boxel realms don't bundle.

- **`https://esm.run/three@<ver>`** — Three.js for 3D / WebGL. Same modifier-lifecycle pattern covers Babylon.js and raw WebGL. → `integrate-three-js-via-cdn`
- **raised relief vs flat/flush inlay** — Raised features overlap an uncut backing; flat/flush features occupy a deliberately over-cut cavity and end at the backing surface. → `integrate-three-js-3mf-fabrication`
- **welded manifold export mesh** — Quantize transformed vertices, reuse indices, remove collapsed triangles, and require every undirected edge exactly twice before 3MF serialization. → `integrate-three-js-3mf-fabrication`
- **`https://esm.sh/leaflet@<ver>`** — Leaflet maps. Requires CSS link + explicit container size. → `integrate-leaflet-via-cdn`
- **`https://esm.run/chess.js@<ver>`** + **`cm-chessboard`** — Chess engine + board. FEN persistence. → `integrate-chess-js-via-cdn`
- **`https://esm.run/tone@14`** — Tone.js music toolkit. Polyphonic synths, transports, effects chains. → `integrate-tone-js-via-cdn`
- **`https://esm.run/@babylonjs/core`** — Babylon.js alternative for 3D scenes.
- **Glimmer modifier lifecycle** — Universal pattern for ESM-CDN libraries: `modifier((element, [config]) => { … build graph …; return () => { … cleanup … } })`. Cleanup is mandatory (cancel RAF, dispose GL resources, remove canvas, etc.).

→ `boxel-patterns/references/integration-surfaces.md` §8, `boxel-patterns/references/libraries.md` Tier 4

## 15. Web Audio (built-in, no library)

- **`AudioContext`** — Browser's built-in audio root. One per card. Resume on user gesture (browsers block auto-play), close on teardown.
- **`OscillatorNode`** — Tones (sine/square/saw/triangle). One-shot — `.start()` then `.stop()`; create a new one per voice.
- **`GainNode`** — Envelope shaping; `.gain.setValueAtTime` + `.gain.exponentialRampToValueAtTime` (ramp to a small floor, not 0 — exponentials never reach zero).
- **`BiquadFilterNode`** — Lowpass/bandpass filter for snare/hihat color.
- **`AudioBufferSourceNode`** — Sample / noise buffer playback.
- **`useSoundFeedback()`** — Module-level helper exposing `playTone`, `playChord`, named presets (`click()`, `success()`, `error()`, `win()`). → `integrate-web-audio-synthesis`

## 16. AI services

- **OpenRouter** — Default cross-model gateway. Routes via `https://openrouter.ai/api/v1/chat/completions`. Credentials handled by the realm proxy.
- **`OneShotLlmRequestCommand`** — Host command for single LLM call, no conversation. → `integrate-one-shot-llm`
- **`UseAiAssistantCommand`** — Host command that opens a multi-turn AI room with a skill card + attached cards pre-loaded. → `command-with-skill-card-ref`
- **OpenRouter image generation** — Image-gen via OpenRouter chat completions with `modalities: ['image', 'text']`. Default model: `google/gemini-2.5-flash-image` (Gemini Flash Image). ChatGPT/OpenAI image models on request (`openai/gpt-5-image-mini`, `openai/gpt-5.4-image-2`). → `integrate-openrouter-image-generation`
- **`GenerateThumbnailCommand`** — Composes OpenRouter image-gen + `WriteBinaryFileCommand` + optional `PatchCardInstanceCommand` to patch `cardInfo.cardThumbnail`. → `integrate-thumbnail-card-ai`
- **`ScreenshotCardCommand`** — Captures a settled PNG of any saved card at `isolated` or `embedded` format (Puppeteer-driven via prerender pool). → `integrate-screenshot-card-format`
- **Steerable image generation** — Multi-step iterative refinement using initial prompt + steering input + first/current image lineage. → `automate-image-steering`
- **Skill cards** — Cards typed as `Skill` from `https://cardstack.com/base/skill` that pre-load into AI rooms with their description as system context.

## 17. Catalog system

- **Listing** — Installable catalog asset. Subtypes: `CardListing`, `SkillListing`, `ThemeListing`, `FieldListing`.
- **`listing-create`** / **`listing-install`** / **`listing-remix`** / **`listing-use`** / **`listing-generate-example`** / **`listing-update-specs`** — Host commands for catalog operations.
- **`PlanBuilder`** + **`planModuleInstall`** + **`planInstanceInstall`** — Build atomic install plans. → `command-atomic-install`
- **`ExecuteAtomicOperationsCommand`** — Apply a plan transactionally; all or nothing.
- **`SubmissionWorkflowCard`** + **`create-and-open-submission-workflow-card`** + **`retry-submission-workflow`** — Catalog submission flow via workflow card → PR. → `catalog-listing`, `/boxel-submit-listing`

## 18. Host commands (`@cardstack/boxel-host/tools/<name>`)

Available only inside the running Boxel app. Each is a default-export `Command` subclass.

- **AI** — `ai-assistant`, `create-ai-assistant-room`, `open-ai-assistant-room`, `send-ai-assistant-message`, `one-shot-llm-request`, `set-active-llm`, `sync-openrouter-models`, `update-room-skills`.
- **HTTP / generic** — `send-request-via-proxy`, `authed-fetch`, `search-google-images`.
- **Card I/O** — `save-card`, `patch-fields`, `patch-card-instance`, `apply-markdown-edit`, `write-text-file`, `copy-card`, `copy-source`, `copy-file-to-realm`, `transform-cards`, `read-file-for-ai-assistant`, `read-card-for-ai-assistant`, `fetch-card-json`, `get-card`, `read-source`, `serialize-card`.
- **Search** — `search-cards`, `search-and-choose`.
- **Realm-server** — `get-all-realm-metas`, `get-available-realm-urls`, `get-default-writable-realm`, `get-catalog-realm-urls`, `get-realm-of-url`, `can-read-realm`, `validate-realm`, `reindex-realm`, `full-reindex-realm`, `cancel-indexing-job`, `invalidate-realm-identifiers`, `sanitize-module-list`.
- **UI / navigation** — `switch-submode`, `show-card`, `show-file`, `preview-format`, `update-code-path-with-selection`, `open-workspace`.
- **Store** — `store-add`.
- **Catalog** — `listing-create`, `listing-install`, `listing-remix`, `listing-use`, `listing-generate-example`, `listing-update-specs`, `create-and-open-submission-workflow-card`, `retry-submission-workflow`, `execute-atomic-operations`.
- **Code-introspection** — `get-card-type-schema`.

→ `boxel-patterns/references/integration-surfaces.md` §3 for the full annotated table.

**Command invocation modes** — A Command can be exposed via direct call, reactive resource (`commandData<T>`), card menu item (`[getCardMenuItems]`), typed progress, optimistic pipeline (run-card history), one-shot AI processor, multi-turn AI assistant, CLI script (`npx boxel run-command`), or atomic transactional install. → `boxel/references/command-invocation-modes.md`

## 19. Boxel UI (`@cardstack/boxel-ui`)

**`/components`** — `Button`, `BoxelButton`, `Pill`, `Avatar`, `BoxelInput`, `BoxelSelect`, `BoxelDropdown`, `Menu`, `ColorPalette`, `ColorPicker`, `Header`, `FieldContainer`, `CardContainer`, `Modal`, `Drawer`, `Toast`, `Accordion`, `FilterList`, `RadioInput`, `SkeletonPlaceholder`, `TabbedHeader`, `ViewSelector`, `ViewItem`, `BasicFitted`, `KanbanPlane`, `KanbanDragManager`, `KanbanColumnConfig`, `KanbanPlacement`, `autoPlaceKanban`, `cardsInColumn`, `kanbanColumnCount`, `resolveInsertion`.

**`/helpers`** — Logic (`eq`/`not`/`and`/`or`/`gt`/`gte`/`lt`/`lte`/arithmetic), templates (`cn`/`cssVar`/`element`/`optional`/`pick`), formatters (`formatDateTime`/`formatNumber`/`formatCurrency`/...), markdown (`markdownEscape`), menus (`MenuItem`/`MenuItemOptions`).

**`/icons/<name>`** — Curated icon set; sibling `@cardstack/boxel-icons/<name>` for broader Lucide/Tabler-style coverage.

→ `boxel-patterns/references/integration-surfaces.md` §4

## 20. Ember / Glimmer

- **`@glimmer/component`** — Class-based components.
- **`@glimmer/tracking`** — `@tracked` decorator for reactive state.
- **`@ember/component/template-only`** — `TemplateOnlyComponent<Sig>` for pure-render components.
- **`@ember/modifier`** — Built-in modifiers including `on` for event listeners.
- **`@ember/helper`** — `fn`, `hash`, `array`, `get`, `concat` template helpers.
- **`@ember/object`** — `action` decorator for method binding.
- **`ember-concurrency`** — `task`, `restartableTask`, `dropTask`, `enqueueTask`, `keepLatestTask` for async coordination. `restartableTask` cancels in-flight when re-invoked.
- **`ember-resources`** — `Resource`, `resource()`, `use` for reactive resources.
- **`ember-modifier`** — `modifier()` for DOM-lifecycle modifiers.

## 21. `boxel-cli` (the local CLI)

Use the namespaced CLI published from the Boxel monorepo through `npx boxel`. The standalone flat-command CLI is legacy and its command shapes must not be copied into current guidance.

- **`npx boxel profile <list|add|switch|remove|migrate>`** — Profile / environment management. `switch` changes the global active profile; restore it after a temporary environment change.
- **`npx boxel realm <create|list|remove|wait-for-ready|cancel-indexing>`** — Realm lifecycle.
- **`npx boxel realm pull <realm-url> <local-dir>`** — Realm → local.
- **`npx boxel realm push <local-dir> <realm-url>`** — Local → realm.
- **`npx boxel realm sync <local-dir> <realm-url>`** — Bidirectional. (Has known hang issue on some realms; fall back to push/pull.)
- **fresh-realm push ordering** — Push definitions, wait for schemas, then write instances. Mixed first pushes can preserve card counts while replacing nested realm-defined field values with `null`. → `boxel-environment/references/fresh-realm-push-integrity.md`
- **`npx boxel realm status <local-dir>`** — Classify local changes vs. manifest.
- **`npx boxel realm publish <source> <published>` / `unpublish`** — Create or remove an anonymous host-mode copy.
- **`npx boxel realm indexing-errors --realm <url>`** — List cards that failed to index when supported by the installed CLI.
- **`npx boxel realm history`** — List/restore/tag checkpoints.
- **`npx boxel realm milestone`** — Tag checkpoints.
- **`npx boxel realm watch <start|stop>`** — Pull server-side realm changes into the local workspace; not a local auto-push loop.
- **`npx boxel file <read|write|list|touch|delete>`** — Per-file realm operations.
- **`npx boxel file lint <path> --realm <url> --file <local-file>`** — Local lint.
- **`npx boxel lint [path] --realm <url>`** — Remote lint (single file or whole realm).
- **`npx boxel parse [path]`** — Local Glint type-check plus JSON document validation.
- **`npx boxel test`** — Run co-located `.test.gts` QUnit card tests against the local workspace (or `--realm <url>` for cards already on a remote realm). Test-file contract (`runTests()`, `setupCardTest`, `renderCard`, shimmed modules): → `boxel/references/qunit-testing.md`
- **`npx boxel search '<query-json>' --realms <urls>`** — Federated search.
- **`npx boxel run-command <command-specifier> [--realm <url>] [--input <json>] [--json]`** — Execute a host command via the prerenderer. CLI invocation mode for Commands. → `automate-run-command-cli`
- **`npx boxel consolidate-workspaces`** — Merge multiple watched workspaces (interactive).

→ `boxel-patterns/references/integration-surfaces.md` §10

## 22. Slash commands (`commands/<name>.md`)

- **`/boxel-create-card`** — New CardDef / FieldDef / small card family.
- **`/boxel-add-field`** — Add or change schema fields, computed fields, relationships.
- **`/boxel-add-file-field`** — File-backed (image/document/CSV/markdown) fields.
- **`/boxel-create-instance`** — New JSON card instances or updates.
- **`/boxel-edit-template`** — `isolated`/`embedded`/`fitted`/`edit`/`atom`/`markdown` template edits.
- **`/boxel-design-card`** — Visual design + theme work.
- **`/boxel-develop-theme`** — Create / convert / audit / patch Theme, Style Reference, Detailed Style Reference, or Brand Guide artifacts.
- **`/boxel-build-from-pattern`** — Start from a ready working pattern by outcome.
- **`/boxel-search-cards`** — Find cards in a realm.
- **`/boxel-preview-card`** — Preview module / card / format in the live app.
- **`/boxel-migrate-schema`** — Find + update instances after schema changes.
- **`/boxel-install-listing`** — Use / install / remix / update a catalog listing.
- **`/boxel-submit-listing`** — Submit a catalog listing through the workflow-card PR flow.
- **`/boxel-debug-runtime`** — Diagnose runtime / indexing / command / mode issues.
- **`/boxel-sync-workspace`** — Pull / push / sync a realm; manage `.boxel-sync.json` + `.boxel-history`.
- **`/distill-learnings`** — Consolidate `.claude/learnings/` entries into skill refs / patterns.

## 23. Skill catalog

- **`boxel`** — Core framework rules. 18+ references (`core-concept.md`, `query-systems.md`, `fitted-formats.md`, `design-playbook.md`, `lint-workflow.md`, `command-development.md`, `command-invocation-modes.md`, `container-query-fitted-layout.md`, `delegated-rendering.md`, `theme-design-system.md`, `styling-design.md`, `formatters.md`, `enumerations.md`, `date-math.md`, `base-field-catalog.md`, `imagedef.md`, `external-libraries.md`, `template-syntax.md`, `data-management.md`, `defensive-programming.md`, `common-imports.md`, `core-patterns.md`, `file-editing.md`, `icons.md`, `quick-reference.md`, `spec-usage.md`).
- **`boxel-patterns`** — Outcome-indexed catalogue of 50+ working patterns + `integration-surfaces.md` (capability cheatsheet) + `libraries.md` (import-path catalogue) + `ai-image-models.md` (verified model IDs for image generation) + `pattern-authoring.md` (README template, naming conventions, `validated:` ladder, promotion bar) + `pattern-backlog.md` (reserved-but-unextracted slugs — do not chase).
- **`boxel-ui-guidelines`** — Template UI rules, `delegated-render-control.md`, `template-patterns.md`, `style-budget.md`, `prevent-content-overflow.md`.
- **`boxel-design`** — Visual design + asset selection + critical anti-LLM-cliché rules.
- **`boxel-theme-development`** — Theme/StyleReference/BrandGuide creation, DESIGN.md mapping, brand tokens, logo/mark capture, and audit workflow.
- **`boxel-environment`** — Driving the live app + host commands; `workflows-and-orchestration.md`, `user-environment-awareness.md`, `assistant-persona.md`.
- **`boxel-file-def`** — File-backed fields (`FileDef`, `ImageDef`, etc.).
- **`boxel-flavored-markdown`** — BFM authoring with directives + fenced renderers.
- **`boxel-markdown-format`** — Static `markdown` template output format.
- **`boxel-create-edit-cards`** — Thin pointer skill; content lives at `boxel-environment/references/card-tool-selection.md` (create/edit tool tables, file naming, path rules).
- **`boxel-skill-authoring`** — SKILL.md format contract for user-authored skills: `boxel.kind: skill` frontmatter, tool declarations, verify loop.
- **`boxel-workspace-cardinal-rules`** — Silent-failure trap checklist (DateField vs DateTimeField formats, external URLs in relationship links, `linksToMany` indexed keys, …); partially overlaps the `boxel` skill's cardinal rules under its own numbering.
- **`boxel-ui-component-discovery`** — Mandatory catalog Spec search before hand-rolling UI primitives; enumerate → one broad `boxel search` query → read `attributes.readMe` → self-audit.
- **`ember-best-practices`** — Ember.js performance + accessibility rules, 59 `rules/*.md` files across 10 prefix-keyed categories, indexed in its SKILL.md.
- **`catalog-listing`** — Catalog operations + submission via `SubmissionWorkflowCard`.
- **`source-code-editing`** — Canonical SEARCH/REPLACE edit transport.

## 24. Cardinal rules / conventions

In rough priority order:

- **Theme first.** Decide theme strategy before writing the card. Templates use `var(--*)` tokens, never hard-coded colors. → `theme-first-workflow`
- **Boxel built-in feature work uses the Boxel Brand Guide.** Base cards, host-facing Boxel UI, and Boxel-branded catalog material use `https://cardstack.com/base/Theme/boxel-brand-guide` as the style source.
- **`cardInfo.theme` is the per-instance override** (wins over computed `cardTheme`).
- **Override `cardTitle` when there's a primary field.** Respect `cardInfo.name` first.
- **Build a Home app whenever you ship 2+ related CardDefs.** `prefersWideFormat = true` + one `@context.searchResultsComponent` section per CardDef in the family. → `app-card-home-with-search`
- **Lint is mandatory.** `npx boxel file lint` before push, `npx boxel lint` after push. Prefer `npx boxel` over bare `boxel` to avoid a stale global v0.0.1 shim. → `boxel/references/lint-workflow.md`
- **Don't reach for `cancel-indexing`.** Slow ≠ stuck. Sample for 5+ minutes before doing anything. Never `--cancel-pending` to "recover from slow." → `boxel-environment/references/indexing-operations.md`
- **Fresh-realm push uses `/_atomic` batches.** Pushing > 30 files at once can silently drop indexing jobs. Push kit-by-kit with verification. → `boxel-environment/references/indexing-operations.md`
- **Public-repo path hygiene.** No absolute local paths in tracked files. Use placeholders. → `CLAUDE.md` Conventions.
- **Never inline media/binary in card JSON.** Use FileDef subtypes; `WriteBinaryFileCommand` for generated bytes. → `boxel-file-def/references/no-inline-binary.md`
- **Query traps** — `filter: { type: ref }` (not `on`); custom sort fields need `on`; `codeRef(here, …)` + `realmURL` Symbol from `@cardstack/runtime-common`. → `boxel/references/query-systems.md`
- **🔴 DateField vs DateTimeField — silent-renders-then-crashes trap.** `contains(DateField)` value MUST be `YYYY-MM-DD`; `contains(DateTimeField)` value MUST include `T`. Mismatches pass lint + write + index, then crash at render as `RangeError: Invalid time value`. `*At` → DateTimeField; `*Date`/`*On`/`hireDate`/`dob` → DateField. → `boxel/references/base-field-catalog.md`
- **🚨 Image URLs in relationship links BRICK the realm.** External URLs (`https://images.unsplash.com/...`) in `relationships.<field>.links.self` cause `JSON.parse` to throw on the fetched JPEG bytes; the error message's NULL byte poisons the postgres JSONB write; the entire indexing transaction rolls back. Use the `cardInfo` pair pattern: `heroImage = linksTo(ImageDef)` + `heroImageURL = contains(UrlField)` (UrlField from `https://cardstack.com/base/url`, not MaybeBase64Field, not StringField); external URLs go on the attribute side. → `boxel/references/base-field-catalog.md` "Image fields — the URL/ImageDef pair pattern"
- **🚨 `linksToMany` JSON shape uses INDEXED KEYS, never an array.** Each item is its own top-level relationship: `"activityFeed.0": { "links": { "self": "..." } }`, not `"activityFeed": { "links": { "self": ["...", "..."] } }`. Array-in-self causes "not a card resource document".
- **Format choice = who owns the cell size.** `embedded` for lists; `fitted` for uniform tile grids.
- **Every user-facing card goes through `design-playbook.md`.**
- **Delegated render** — `<@fields.X />` injects host CardContainer chrome; override via `:deep()`, theme cascade, or `@displayContainer={{false}}`. → `boxel-ui-guidelines/references/delegated-render-control.md`
- **Read before writing.** Fetch a file’s current contents before a SEARCH/REPLACE edit so the SEARCH block matches exactly.
- **SEARCH/REPLACE for file creation and edits** — `.gts` and `.json` alike. Avoid `write-text-file` (UI freezes; skips the code-patch pipeline).
- **One CardDef per file.** FieldDefs and helpers can co-locate.
- **Three formats minimum.** Every CardDef ships `isolated`, `embedded`, AND `fitted`.

## 25. Patterns

Ready patterns live at `boxel-patterns/patterns/<slug>/{README.md, example.gts}`. Indexed by outcome.

### Show
- **`app-card-home-with-search`** — Home CardDef for any card family.
- **`show-card-list-with-views`** — Generic CardsGrid with view names.
- **`show-list-prefer-prerendered`** — Cost decision for list UIs: render the cheap prerendered `@context.searchResultsComponent` stream; reserve `getCards` / `getCardCollection` / `store.search` (which hydrate every row) for genuine read/mutate, scoped to the current realm.
- **`show-count-tiles-from-query`** — Dashboard count tiles via `page: { size: 1 }` + `meta.page.total`.
- **`show-table-from-query`** — Sortable rows from a query.
- **`show-runtime-markdown-html`** — Render BFM/markdown at runtime in templates.
- **`show-wiki-links`** — `[[Page Name]]` clickable links into a `relatedPages` graph.
- **`show-filedef-audio-player`** — Durable audio playback from realm MP3 via `linksTo(FileDef)`.
- **`show-pdf-annotations-filedef`** — PDF.js viewer/annotation pattern with FileDef-backed PDFs.

### Pick / Input
- **`pick-rating`** — Editable star-rating FieldDef. Args.set carries an `eslint-disable-next-line no-unused-vars` comment because the realm lint rejects unused type-expression parameters.
- **`pick-typed-sort`** — `SortMenu` + typed `SortOption` interface.
- **`attach-remote-image`** *(README-only)* — Image field that accepts either an external URL or an uploaded ImageDef, via the `cardInfo` pair pattern (`heroImage` + `heroImageURL`). Template prefers URL when set, falls back to linked image. **Critical for AI-generated cards** — prevents the realm-bricking bug where an external URL in a relationship's `links.self` causes the indexer to fetch binary bytes, crash on parse, and roll back the transaction.

### Build / Template
- **`build-planning-cards-trio`** *(README-only)* — Stage-0 planning ritual for card families: three CardDefs (`ArchitecturePlan`, `DataModelPlan`, `MicroMockups`) whose `static isolated` templates ARE the plan documents. Forces the rich-data-model + signature-field decisions BEFORE production schema is written. Without it, fitted views come out pedestrian. Source: `app.boxel.ai/.../actual-duck-82`.
- **`theme-first-workflow`** — Step 0 for every new CardDef.
- **`cardinfo-override-title`** — Override `cardTitle` to respect `cardInfo.name`.
- **`build-site-config-with-theme`** — Multi-page site registry with `SiteConfig` + `ThemeCard` + `linksToMany(PageConfig)`.
- **`containsmany-sorted-render`** — Render in non-insertion order without losing chrome. Use `{{#let (get @fields.X i)}}` not `<@fields.X.[i]>` — the bracket form trips realm lint's `no-unused-vars`.
- **`format-morph-shared-component`** — One Component for both isolated + edit, morph via CSS.
- **`polymorphic-field-subclass`** — `contains(Shape)` slot holding any subclass.

### Automate / Compute
- **`automate-linked-to-me-lookup`** — Schema-level query-backed `linksToMany` (preferred) or component-level `getCards()`. For circular `linksTo` between two CardDefs, both sides use the `() => Class` thunk form to avoid cyclic-import errors.
- **`resource-for-state`** — Wrap third-party library state in an ember-resources Resource.
- **`automate-image-steering`** — Iteratively refine an image generation with initial prompt + steering input + first/current image lineage.
- **`automate-run-command-cli`** — Invoke a host Command via `npx boxel run-command` shell + typed run card for history.

### Layout
- **`layout-design-board`** — Parent card = layout shell composing many cards.
- **`layout-kanban-drag-drop`** — Persistent kanban using `KanbanPlane`.
- **`layout-3d-card-carousel`** — `@context.searchResultsComponent` (`@overlays={{false}}`) + CSS perspective + per-card vars for a 3D arrangement.
- **`layout-sectioned-record-with-nav`** — Long-record card with sticky 220px left nav rail + main content stack of `<@fields.<section> @format='embedded' />`. Click-to-scroll active highlight. Pairs with `organize-sensitive-stub-pair`.

### Link / Navigate
- **`link-discriminated-action-resolver`** — Type-safe action menu adapting to CardDef subtype.
- **`link-element-tag-helper`** — Dynamic HTML tag via the `element` helper.
- **`link-onclick-outside`** — `onClickOutside` modifier (50 ms-delayed mousedown).
- **`link-view-transition`** — `document.startViewTransition` + `view-transition-name`.
- **`link-flip-card`** — CSS-only front/back flip primitive.
- **`link-host-mode-paths`** — `realm.json` `hostRoutingRules` to route `/`, `/about`, `/blog` to cards.
- **`link-command-menu-item`** — Expose a Command as a card menu item via `[getCardMenuItems]`.

### Make a Command
- **`command-data-resource`** — `commandData<T>(this, MyCommand)` reactive resource.
- **`command-with-skill-card-ref`** — Card kicks off an AI conversation with a Skill card pre-loaded.
- **`command-typed-with-progress`** — Command with tracked `progressStep` state machine.
- **`command-optimistic-pipeline`** — One durable run card per invocation; queryable progress.
- **`command-atomic-install`** — `PlanBuilder` + `ExecuteAtomicOperationsCommand` for transactional install.

### Integrate external
- **`integrate-openrouter-image-generation`** — OpenRouter chat completions with `modalities: ['image','text']`.
- **`integrate-one-shot-llm`** — Single LLM call via `OneShotLlmRequestCommand`.
- **`integrate-filedef-generated-image`** — Write generated bytes with `WriteBinaryFileCommand` + link `ImageDef`/`PngDef`.
- **`integrate-screenshot-card-format`** — Real PNG capture of a rendered card via Puppeteer.
- **`integrate-thumbnail-card-ai`** — AI thumbnail via `GenerateThumbnailCommand` (with `cardInfo.cardThumbnail` auto-patch).
- **`integrate-send-request-via-proxy`** — Generic third-party HTTP through the host proxy.
- **`integrate-three-js-via-cdn`** — Three.js / Babylon.js / raw WebGL via ESM CDN + modifier lifecycle.
- **`integrate-three-js-3mf-fabrication`** — Raised versus flat/flush fabrication geometry, manifold mesh validation, and multicolor component planning for 3MF slicers.
- **`integrate-leaflet-via-cdn`** — Leaflet map.
- **`integrate-chess-js-via-cdn`** — chess.js + cm-chessboard combo.
- **`integrate-tone-js-via-cdn`** — Tone.js music toolkit.
- **`integrate-web-audio-synthesis`** — Raw `AudioContext` synthesis with `useSoundFeedback()` sub-recipe.

### Organize (code-shape)
- **`organize-base-class-taxonomy`** — Empty base CardDef as a query-by-type taxonomy.
- **`organize-variant-field-dispatcher`** — FieldDef that swaps edit components by `configuration.variant`.
- **`organize-atomic-field-factory`** — `createOptionSelectField({ options, view })` factory.
- **`organize-resource-class-data-loader`** — Resource subclass with boxed constructor.
- **`organize-lru-cached-parser`** — Generic `LruCache<K,V>`.
- **`organize-recursive-fielddef`** — Self-referencing FieldDef shape (story → branches → branches).
- **`organize-sensitive-stub-pair`** — Full sensitive record + safe operational stub kept in sync via a `Sync<X>StubCommand`. `syncIssues` getter surfaces drift; one-way `full → stub` link direction preserves the privacy boundary.
- **`organize-typed-activity-feed`** — Base `FeedEntry` CardDef + N specialized subclasses. Mixed-type queries hit the base; filtered queries hit a subclass. Replaces single-Entry-with-enum + conditional rendering.

### Planned (no `example.gts` yet — do not chase; fall back to source realms or core skills)

- **`attach-remote-image`** — Hand-author an `ImageDef` JSON instance pointing at an external URL without uploading bytes. Need surfaced by 3 agents in 2026-05-22 batch.
- **`show-kanban-from-query`** — Status-grouped column view with one `@context.searchResultsComponent` per column. Lower-friction `layout-kanban-drag-drop` alternative when DnD isn't needed.
- **`polymorphic-card-subclass`** — CardDef hierarchy where `adoptsFrom` discriminates the subclass per instance. Differs from `polymorphic-field-subclass` (FieldDef runtime swap).

## 26. `.claude/` directory layout

- **`CLAUDE.md`** — Claude Code's cardinal doc (always loaded).
- **`AGENTS.md`** — Same content for non-Claude agents (Codex, Cursor, Aider, Gemini CLI, Factory Droid).
- **`README.md`** — Human-facing setup guide.
- **`commands/`** — Slash commands (action layer).
- **`skills/`** — Portable skill tree (this file's home).
- **`.claude/learnings/`** — Session scratchpad; `/distill-learnings` folds into skill tree.

## 27. Acronyms

- **BFM** — Boxel Flavored Markdown.
- **bxl** — The workspace's unified computation runtime (jq-flavored query + Excel formulas).
- **CardDef** — Card definition; the schema + reactive component class for a card type.
- **FieldDef** — Field definition; compound or single-value building block.
- **CDN** — Content Delivery Network. Used here for ESM-CDN imports (`esm.run`, `esm.sh`).
- **CRUD** — Create / Read / Update / Delete.
- **CTA** — Call-to-action.
- **CQ** — Container Query.
- **CSS** — Cascading Style Sheets.
- **DnD** — Drag-and-Drop. Legacy DndColumn etc. live under `resource-for-state`.
- **ESM** — ECMAScript Modules. The realm loader speaks ESM natively.
- **GTS** — Glimmer TypeScript (`.gts` files); template-language extension of TypeScript.
- **JSON:API** — The JSON serialization spec Boxel cards use.
- **LLM** — Large Language Model.
- **OG** — Open Graph (`og:image` etc.); social-share metadata.
- **PR** — Pull Request.
- **RAF** — `requestAnimationFrame` — browser frame callback.
- **RRI** — Realm Resource Identifier.
- **SPA** — Single-Page Application; the Boxel host UI runs as one.
- **SSR** — Server-Side Rendering; the realm-server prerender does this for fitted/embedded HTML.
- **TanStack** — The `@tanstack/*` family of headless libraries (table-core, store, virtual, etc.).
- **UI** — User Interface.
- **WIP** — Work In Progress.
- **XYFlow** — The React Flow library (rebrand). Boxel's `ember-flow` is a Glimmer port.
