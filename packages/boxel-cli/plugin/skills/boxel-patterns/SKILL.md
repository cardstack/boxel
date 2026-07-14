---
name: boxel-patterns
description: Use when the user names an outcome ("show a chart", "let users pick a color", "build a dashboard", "summarize comments", "embed AI image generation", "lay out a moodboard") and you need a working code example to start from. This skill is the bridge between user intent and the existing patterns in Boxel realms. Index your search by what the user wants to DO, not by which CardDef/FieldDef class to extend. Activates when the user asks "do we have a pattern for…", "how is X typically done", or names a feature outcome that isn't in core syntax.
boxel:
  kind: skill
---

# Boxel Patterns

The curated `boxel` skill and its siblings teach you **how the framework works**. This skill catalogues **what people have built with it** — distilled patterns extracted from real working realms, each with a minimal `example.gts` you can adapt.

Patterns are indexed by **user intent**, not by class hierarchy. Find the pattern that matches the outcome the user described, then read its `README.md` + `example.gts`.

---

## How to use this skill

1. Translate the user's request into an outcome (one of the intent groups in **Ready Patterns** below).
2. Search **Ready Patterns** first — these are the ones with working `example.gts` files.
3. Read `patterns/<slug>/README.md` for when/why/insight/gotchas, then `patterns/<slug>/example.gts` for the code.
4. Adapt to the user's domain. Examples are reduced to pattern essence — names, data, and styling will need replacement.
5. If nothing matches, see **Source Realm Fallbacks** at the bottom, or fall back to the core skills (`boxel`, `boxel-design`, `boxel-ui-guidelines`).

The **Planned Pattern Backlog** lists ideas without working code. **Do not chase planned patterns** — fall back to core skills instead.

Only promote a new realm discovery into Ready Patterns when it captures implementation details an agent is likely to miss: unusual imports, hard syntax, FileDef/host-command wiring, library lifecycle setup/cleanup, query traps, or Boxel-specific render mechanics. Do not add a pattern only because the demo is attractive or easy to recreate with ordinary web code.

For any pattern or reference that imports `@cardstack/boxel-host/tools/<name>`, run the host-command audit before promoting it:

```sh
BOXEL_MONOREPO=/path/to/boxel node skills/boxel-patterns/scripts/audit-host-command-refs.mjs
```

The audit compares skill-tree command imports with `packages/host/app/tools/index.ts` in the live monorepo. A missing command import is a blocker for Ready Patterns unless the monorepo has changed and the audit is refreshed.

---

## Ready Patterns

Ready patterns below can be read and adapted. Each has `patterns/<slug>/README.md`; most also have a separate `patterns/<slug>/example.gts`. A few are README-with-inline-recipe — the worked code lives in fenced blocks inside the README itself, marked `(README-only)` in the list below.

> **Start here for any new card:** `theme-first-workflow` + `cardinfo-override-title` together form the recommended "step 0" for every new CardDef. Skipping them is the most common cause of cards that "look wrong" or have blank titles.

### Show

- **`app-card-home-with-search`** _(README-only)_ — The home CardDef for any card family. `prefersWideFormat = true` + one `@context.searchResultsComponent` section per CardDef in the family (Meets / Swimmers / Clubs / Results, or Listings / Performers / Venues, etc.). Live-updating, owns its own `<ul>/<li>` shell so the plural-field wrapper trap doesn't apply. **Build this whenever you build 2+ related CardDefs.**
- `show-card-list-with-views` — Generic CardsGrid that takes `Query` + realms + a view name (`card` / `strip` / `grid`) and renders via `@context.searchResultsComponent` (entry-rooted, live by default). The lower-level building block used inside `app-card-home-with-search`.
- `show-count-tiles-from-query` — Dashboard count tiles that issue `page: { size: 1 }` queries and read `results.meta.page.total` from `@context.searchResultsComponent` (with `@mode='none'`, since only the count is needed). Use for overview badges, operational signals, inbox counts, and clickable dashboard sections without rendering every matching card.
- `show-table-from-query` — Reusable table that takes a `Query` + realm and renders any cards-of-type as sortable rows. WeakMap field-component caching.
- `show-runtime-markdown-html` — Render BFM/markdown to HTML at runtime in `isolated`/`embedded` templates via MarkdownField + `<@fields.body />`.
- `show-wiki-links` — Turn `[[Page Name]]` text inside rendered MarkdownField output into clickable links that resolve against a self-referential `relatedPages = linksToMany(() => WikiPage)` relationship and call `viewCard`.
- `show-filedef-audio-player` — Durable audio playback from a realm MP3/WAV/OGG file using `linksTo(FileDef)` and optional `linksTo(ImageDef)` cover art. Use this instead of storing `blob:`, `data:`, base64, or MP3 bytes in card JSON; source is the A Million Dreams FileDef audio example.
- `show-pdf-annotations-filedef` — PDF.js viewer/annotation pattern updated for FileDef-backed PDFs: `linksTo(FileDef)` for the `.pdf`, CDN PDF.js worker setup, text-layer selection, and normalized highlight bounds in `annotationData`.

### Pick / Input

- `pick-rating` — Editable star-rating FieldDef with full/half/empty read display, atom + embedded formats, and `@set(new RatingsSummary(...))` writeback.
- `pick-typed-sort` — `SortMenu` dropdown + typed `SortOption` interface + exported `Sort` constants. Replaces ad-hoc string sort keys.
- `attach-remote-image` _(README-only)_ — Image field that accepts either an uploaded card-side ImageDef OR an external URL. Mirrors the `cardInfo` pair-of-fields convention: `heroImage = linksTo(ImageDef)` + `heroImageURL = contains(StringField)`; template prefers the URL when set, falls back to the linked ImageDef. **Critical:** prevents the realm-bricking bug where external URLs put into a relationship's `links.self` cause the indexer to fetch binary bytes, crash on parse, and roll back the entire transaction. See `boxel/references/base-field-catalog.md` "Image fields — the URL/ImageDef pair pattern".

### Build / Template

- **`build-planning-cards-trio`** _(README-only)_ — Stage-0 planning artifacts for any card family. Three CardDefs whose `static isolated` templates ARE the plan documents: `ArchitecturePlan` (data-flow ASCII + multi-realm security), `DataModelPlan` (schema spec with ToC, executive summary, sample data), `MicroMockups` (hi-fi mockups of every format at desktop AND mobile with design rules baked into the code comments). Without this stage-0 step, fitted views come out pedestrian — the data model isn't rich enough to compose with. Source pattern: `app.boxel.ai/.../actual-duck-82/{architecture-plan,data-model-plan,micro-mockups}.gts`. See `boxel/references/design-playbook.md` "Planning before code — Stage 0".
- **`theme-first-workflow`** — Choose or create a Theme card BEFORE writing the card. Link via `cardInfo.theme`; templates reference theme tokens (`var(--background)`, `var(--primary)`, etc.) from line one. The starting step for any new card or app.
- **`cardinfo-override-title`** — Override `cardTitle` to respect `cardInfo.name` first, then fall back to a primary field (`headline`, `firstName + lastName`, etc.), then to the default. Every CardDef with a natural identifier needs this.
- `build-site-config-with-theme` — Multi-page site registry: `SiteConfig` links to a `ThemeCard` brand guide and `linksToMany(PageConfig)` nav entries; page shells compute `cardTheme` from the site unless overridden by `cardInfo.theme`.
- `containsmany-sorted-render` — Render a `containsMany`/`linksToMany` in a non-insertion order without losing the host's field rendering chrome. Sort indexes in the Component, drive `{{#each}}` with `<@fields.notes.[i] />`.
- `format-morph-shared-component` _(README-only)_ — Assign one Glimmer Component to both `static isolated` and `static edit` so the component stays mounted across format flips. CSS transitions on `.card--{{@format}}` morph the visual without remount. Token-efficiency win when isolated and edit are layout variants of the same content.
- `polymorphic-field-subclass` _(README-only)_ — A `contains(Shape)` slot that holds any subclass of `Shape` (Circle, Square, Triangle). Swap by assigning `new Circle({})` to the model field — first-class, type-safe, persistable. Replaces `(model as any).field = value` hacks.

### Automate / Compute

- `automate-linked-to-me-lookup` — Schema-level query-backed `linksToMany` (preferred) OR component-level `getCards()` to materialize inbound references. Two signatures documented.
- `resource-for-state` _(README-only)_ — Wrap third-party library state, legacy kanban column ordering, or any "stateful object that re-runs when args change" in an `ember-modify-based-class-resource` Resource. Used by older `kanban-resource.gts` (DndColumn ordering) and `chess-game.gts` (chess.js wrapper). New kanban boards should use `layout-kanban-drag-drop`.
- `automate-image-steering` — Steerable image generator: immutable seed prompt + latest steering command (priority-1) + first/current image lineage attached to OpenRouter multimodal calls + explicit per-image role narration. Used by the Cue voice-photo apps to iteratively refine a generation without losing subject identity. Includes the bounded `imageHistory` + `firstImage` pinning rules + `restartableTask` cancellation.

### Layout

- `layout-design-board` — Parent card = layout shell; each `linksTo` child renders at a chosen format. Includes the chrome-strip CSS trick.
- `layout-kanban-drag-drop` — Persistent kanban board using `KanbanPlane` from `@cardstack/boxel-ui/components`: columns + placements data model, fitted child cards, pointer/keyboard drag, ghost/insertion behavior, hidden columns, and WIP limits.
- `layout-3d-card-carousel` — `@context.searchResultsComponent` (`@overlays={{false}}`) + CSS `perspective` + per-card `--card-index` / `--total-cards` CSS vars for a circular 3D arrangement. Auto-rotate, hover lift, filter-state reactive. The 3D-hero alternative to a flat grid.
- `layout-sectioned-record-with-nav` — Long-record card with sticky 220px left nav rail (one button per section, click-to-scroll, active-section highlight) + main content stack of `<@fields.<section> @format='embedded' />`. Pairs with `organize-sensitive-stub-pair` for record/stub apps. Requires `prefersWideFormat = true`.

### Link / Navigate

- `link-discriminated-action-resolver` — Type-safe action menu that adapts to which CardDef subtype you have. Adapter classes per subtype + conditional spread for optional actions.
- `link-element-tag-helper` — Dynamic HTML tag via the `element` helper from `@cardstack/boxel-ui/helpers`.
- `link-onclick-outside` — Canonical `onClickOutside` modifier (50ms-delayed mousedown listener) for popovers and inline editors.
- `link-view-transition` — `document.startViewTransition` + `view-transition-name` for free morph animations between DOM states. Add/remove items, format flips, list reorders, slide-deck auto-animate. Feature-detect for older browsers.
- `link-flip-card` — CSS-only front/back flip primitive: `perspective` + `transform: rotateY(180deg)` + `backface-visibility: hidden`, driven by a single `@tracked isFlipped`. Flashcards, product reveals, two-sided info cards.
- `link-host-mode-paths` — Route clean external URLs (`/`, `/about`, `/blog`, `/pricing`) to specific cards via `hostRoutingRules` on the `RealmConfig` card at `/realm.json`. The realm-server rewrites `cardURL` server-side on every request and injects the routing map into the SPA so post-hydration nav stays consistent. Public realms only; static paths (no `/blog/:slug` params); same-realm `instance` references enforced at read time.

### Integrate external

- `integrate-openrouter-image-generation` — Preferred image generator. OpenRouter chat completions with `modalities: ['image', 'text']`; default to Gemini image, use ChatGPT/OpenAI image models when requested; persist bytes with `WriteBinaryFileCommand` + `ImageDef`.
- `integrate-one-shot-llm` — Single LLM call via `OneShotLlmRequestCommand` (OpenRouter). System + user prompt + model id → output.
- `integrate-filedef-generated-image` — Write generated image bytes with `WriteBinaryFileCommand`, then link `ImageDef` / `PngDef`.
- `integrate-screenshot-card-format` — `ScreenshotCardCommand` captures a **settled PNG of any saved card at `isolated` or `embedded` format** (Puppeteer-driven through the prerender pool) and saves it under `Screenshots/` in the target card's own realm. Use for documentation snapshots, Open Graph images, audit/before-after trails — any time you want the _actual rendered card_.
- `integrate-thumbnail-card-ai` — `GenerateThumbnailCommand` generates an **AI thumbnail** via OpenRouter image generation, writes it to a realm, and optionally auto-patches `cardInfo.cardThumbnail` on a target card in one call. Use for stylised hero icons, catalog listing thumbnails (canonical caller: `listing-create.autoGenerateThumbnail`), generated avatars, brand-mark tiles — any time you want a _designed representation_ of a card rather than its actual rendering. Both compose with `link-command-menu-item` for one-click "screenshot this" / "regenerate AI thumbnail" menu actions.
- `integrate-send-request-via-proxy` — Generic third-party HTTP through the host proxy (host handles credentials per URL host).
- `integrate-three-js-via-cdn` — Three.js inside a card via ESM CDN. Lifecycle-managed via Glimmer modifier with explicit cleanup. Same modifier shape covers Babylon.js and raw WebGL shaders.
- `integrate-leaflet-via-cdn` — Leaflet map inside a card. Requires CSS link + explicit container size.
- `integrate-chess-js-via-cdn` — chess.js engine + cm-chessboard renderer combo. FEN persistence.
- `integrate-tone-js-via-cdn` — Tone.js music toolkit inside a card via `<script>`-tag CDN load. Polyphonic synths, transports, sequences, effects chains. Same lifecycle shape as `integrate-three-js-via-cdn`.
- `integrate-web-audio-synthesis` — Raw `AudioContext` for synthesized tones, drums, and UI sound feedback. No library load. Module-singleton context + oscillator + gain envelope; ships click / success / error presets.

### Make a Command

- `command-data-resource` — Call a host Command reactively from a Glimmer component via `commandData<T>`. Replaces manual `restartableTask` + `@tracked` plumbing.
- `command-with-skill-card-ref` — Card kicks off an AI conversation: skill-card URL via `import.meta.url`, attached cards, `UseAiAssistantCommand` from `@cardstack/boxel-host/tools/ai-assistant`.
- `command-typed-with-progress` — `Command<Input, Output>` with a typed `progressStep` state machine the invoking component reflects in UI.
- `command-optimistic-pipeline` — One durable run card per invocation, mutated in place while `SaveCardCommand` writes are queued fire-and-forget. Use for LLM/image/import pipelines that need fast UI and queryable progress logs.
- `command-atomic-install` — Transactional realm install with `PlanBuilder` + `planModuleInstall` + `planInstanceInstall` + `ExecuteAtomicOperationsCommand`. The canonical catalog-install pattern.
- `link-command-menu-item` — Expose a Command as a card menu item via `[getCardMenuItems]`. The card-native way to surface card-scoped actions.
- `automate-run-command-cli` — Invoke a Command from the shell via `npx boxel run-command <spec> --input '{}'`, pairing with a typed run card for queryable history. Batch jobs, cron, CI gates.

For the wider taxonomy (direct call, reactive resource, menu, typed progress, optimistic pipeline, AI processor, multi-turn assistant, CLI script, atomic install) and a single Command class exposed via every mode, see [`boxel/references/command-invocation-modes.md`](../boxel/references/command-invocation-modes.md).

### Organize

- `organize-base-class-taxonomy` — An empty base CardDef as a query-by-type taxonomy. No `kind` field needed.
- `organize-variant-field-dispatcher` — A FieldDef that swaps among 3–5 edit components by `configuration.variant`.
- `organize-atomic-field-factory` — Factory `createOptionSelectField({ options, view })` returning a `class extends StringField`.
- `organize-resource-class-data-loader` — Resource subclass with a **boxed** constructor (`{ ctor, fields }`) to side-step Glimmer's `{{...}}` auto-binding bug.
- `organize-lru-cached-parser` — Generic `LruCache<K,V>` using `Map`-insertion-order eviction.
- `organize-recursive-fielddef` — Self-referential nested structures with `@field replies = containsMany(() => CommentThread)`. The lazy arrow is the required syntax for threaded comments, org charts, file trees, and nested categories.
- `organize-sensitive-stub-pair` — Sensitive full record + safe operational stub kept in sync via a projection Command. Full record owns the link to the stub; app surfaces link to the stub. A `syncIssues` getter surfaces drift in the UI. Use for school/HR records, healthcare charts, any private-vs-public projection.
- `organize-typed-activity-feed` — Base `FeedEntry` CardDef + N specialized subclasses (Academic / Behavioral / Social / …) sharing common chrome. Queries against the base get mixed-type streams; queries against a subclass get filtered streams. Replaces single-Entry-with-giant-`kind`-enum + conditional rendering shapes.

---

## Pattern folder shape

Each `patterns/<slug>/` is:

```
patterns/<slug>/
├── README.md     # When to use, why this beats the obvious approach, gotchas, source realm + file
└── example.gts   # Minimal compilable example — pattern essence only, no domain noise
```

A small set of Ready Patterns omit `example.gts` and keep the worked code in fenced blocks inside the README. They are marked `(README-only)` in the Ready Patterns list. This is acceptable when the recipe is a few-dozen lines and the README's discussion gives it adequate context.

### Naming conventions

Filenames are how agents discover content. Stick to these:

- **Pattern slug = verb-first taxonomy.** Use one of: `show-`, `pick-`, `build-`, `automate-`, `layout-`, `link-`, `integrate-`, `command-`, `organize-`, `theme-`, `format-`. The verb names the _outcome_, not the underlying class. A few topic-prefix slugs (`cardinfo-`, `containsmany-`, `polymorphic-`, `resource-`, `app-card-`, `bxl-`, `library-`, `surface-`) are kept when the topic is more identifying than the verb — pick verb-first by default and only deviate when the topic is the canonical entry point.
- **Slug = lowercase, hyphen-separated, descriptive.** Aim for 3–5 words. Long enough to be recognizable in a grep result, short enough to read in a file-tree tooltip.
- **One pattern per slug folder.** Every pattern folder contains exactly `README.md` (the instructions) and optionally `example.gts` (the code). No third file unless you have a specific reason; if you do, name it descriptively (e.g. `api-notes.md`, not `notes.md` or `extra.md`).
- **Filename inside the folder is the role, not the topic.** `README.md` always means "read this first." `example.gts` always means "the worked code." Don't put the slug in the filename — the directory already does.
- **No duplicate filenames across the tree.** Two references named the same thing (`template-patterns.md` in two places, `quick-reference.md` in two places) confuse agents and cross-references. Disambiguate by domain (`template-syntax.md` for Glimmer syntax patterns; `template-patterns.md` for UI template patterns; `cheatsheet.md` for one quick-ref vs the more specific one).
- **References live under a skill.** Pattern READMEs cross-link references via path: `boxel/references/<topic>.md`. References don't have an `example.gts`; their job is to explain mechanics, not ship recipes.
- **`SKILL.md` is the skill entry point.** Every skill folder has exactly one `SKILL.md`. References live under `<skill>/references/<topic>.md`. Don't create a second `SKILL.md` or rename it.
- **Commands use the `boxel-` prefix.** Every action command in `commands/` is `boxel-<verb>.md` so they cluster together in slash-command menus. Exception: cross-cutting commands (`distill-learnings.md`).

### Validation frontmatter

Every pattern README opens with a `validated:` field:

```yaml
---
validated: source-proven
---
```

Values:

- **`linted`** — the `example.gts` has been compiled and lint-checked against a live realm with `boxel-cli`. Highest confidence. Promote here only after running the lint gate.
- **`source-proven`** — the pattern was extracted from a live, working realm. The example may not have been linted in isolation, but the mechanics are known to work in a real card. Default for ready patterns.
- **`sketch`** — the README captures the shape but the worked code has not been extracted from a live realm. Pair with a 🟡 Status banner at the top of the README and call out in the Ready Patterns intro that the slug is a draft. Do not adapt directly.
- **`deprecated`** — the pattern has been superseded by another approach. The README still ships so older callers can find the migration path.

Update the field as a pattern's status changes (sketch → source-proven → linted, or any → deprecated).

## Promotion bar — when to add a new ready pattern

Promote a realm discovery into `boxel-patterns/` only when it captures **mechanics that agents are likely to miss** without explicit guidance:

- Non-obvious **imports** (named vs default exports, base-realm URLs that look wrong, FileDef subtypes with hidden extension rules).
- **Host commands** that need specific argument shapes or composition.
- **FileDef wiring** (`linksTo(MarkdownDef)`-style relationships with extension-bearing paths, `WriteBinaryFileCommand` → `ImageDef` shape).
- **Lifecycle cleanup** (Glimmer modifiers that allocate browser resources — WebGL, WebAudio, large libraries).
- **Query / delegated-render traps** (the silent-zero-rows kind; the chrome contract surprises).

**Don't add a pattern just because**:

- The card is visually attractive.
- The demo is polished.
- The implementation is something a competent web dev could rediscover from common knowledge (button + tracked state + animation — that's vibe-codable).

Visually nice but mechanically simple cards stay as **source-realm references** or **inspiration notes** — they don't need a ready slot. The ready tree should be reserved for reusable mechanics that are hard to rediscover correctly. Apply this especially when reviewing catalog-realm demos: prefer FileDef-backed media, PDF.js text-layer annotation, command wiring, library lifecycle, and query/delegated-render traps over ordinary card layout or styling examples.

## See also — adjacent references

A few skill-tree references aren't catalogued as ready patterns but solve real implementation problems:

- **Container-query fitted layout** — `boxel/references/container-query-fitted-layout.md`. The canonical implementation guide for CSS-only fitted views with two-element `.cq → .fit` pattern, six height quanta, `pow()`-based typography, line-budget math, and the magazine-spread / thumbnail-sidebar width thresholds. Sometimes called "CQ fitted" — searching for that in the patterns dir comes up empty because it lives as a reference. Don't add a duplicate pattern folder; link to the existing reference instead.
- **Card references in JSON** — `boxel/references/card-references.md`. Cardinal rules for `links.self` (relative vs absolute, file-extension rules for FileDef-typed relationships, why `$REALM` and `@cardstack/...` resolution work differently).
- **Command invocation modes** — `boxel/references/command-invocation-modes.md`. The taxonomy of how to expose a Command (direct call, reactive resource, card menu item, CLI script, AI invocation, atomic install).
- **Delegated render control** — `boxel-ui-guidelines/references/delegated-render-control.md`. The chrome contract + plural-field wrapper trap + divider strategy.

`README.md` follows:

```markdown
# <slug> — <one-line outcome>

**What this gives you:** <user-facing sentence>

**When to use:** <task triggers>

**The insight:** <the non-obvious part — what someone would miss if they wrote it themselves>

**Gotchas:** <traps>

**Source:** <realm/file.gts:line-range>
```

---

## Library Catalogue

For every import path and every integration surface:

- **`references/integration-surfaces.md`** — Capability-dimension cheatsheet. 10 sections covering base Card APIs, runtime APIs, host commands, Boxel UI, Ember/Glimmer tools, realm-bundled libraries, AI services, ESM CDN libraries, BFM features, and boxel-cli commands. Use this when planning what a card can reach for.
- **`references/libraries.md`** — Import-path-dimension catalogue. Three portable tiers:
  - **Tier 1** — Boxel base (URL-pinned, `https://cardstack.com/base/...`).
  - **Tier 2** — npm (`@cardstack/*`, `@ember/*`, `@glimmer/*`, `ember-*`).
  - **Tier 4** — ESM CDN (`https://esm.run/three`, `https://esm.sh/leaflet`, etc.).

---

## Source Realm Fallbacks

When no ready pattern matches, look in the source-realm analyses before reinventing. These live in the `familiar-turkey` realm — ask the user for the current URLs or grep the realm directly:

- **BSL-STUDY** (V1, 2026-04-21) — 457 patterns from 168 user realms + 5 team codebases, each with rating (promote / distill / reference / skip), source file path, and line range.
- **BSL-STUDY-V2** — Realm-bundled library tier analysis (workspace-specific libraries). Covers 44 newer realms.
- **BSL-STUDY-V3** — Boxel-catalog (production realm) analysis with current syntax updates.
- **REALMS-CATALOG** — Which realm contains what (browse by realm).

These are large reference documents; grep before reading wholesale.

---

## Cross-references

- For framework basics (CardDef, FieldDef, formats, queries) → `boxel`.
- For visual / design language → `boxel-design`.
- For UI templating rules → `boxel-ui-guidelines`.
- For editing the actual files → `source-code-editing`.
- For app-runtime orchestration → `boxel-environment`.

---

## Planned Pattern Backlog

These are slugs reserved in the taxonomy but **not yet extracted**. Do not chase them. They exist as a roadmap for future extraction. If you need one now, fall back to source realms or core skills.

### Show (planned)

- `show-diagram` — Inline mermaid diagram inside a card body.
- `show-map` — GeoJSON / TopoJSON map renderer with pan/zoom.
- `show-chart` — Configurable chart (type + data).
- `show-table-from-csv` — Auto-rendered table from CSV-fenced data.
- `show-3d-model` — STL viewer fence.
- `show-math` — LaTeX block via `math` fence.
- `show-slides` — Markdown-driven slide deck.
- `show-whiteboard` — Excalidraw fenced block.
- `show-canvas-3d` — Custom WebGL/Three.js canvas inside a card.
- `show-external-embed` — URL preview / oEmbed.

### Pick / Input (planned)

- `pick-color` — Color FieldDef with hex/HSL/HSB variant dispatch and LRU-cached parser.
- `pick-date` — Flex date/time field with required/optional, partial precision.
- `pick-from-enum` — `enumField` for constrained-value dropdowns. (See `boxel/references/enumerations.md`.)
- `pick-from-query` — Dropdown of cards matching a query.
- `pick-multiple-tags` — Multi-select chips backed by an enum.
- `pick-geo-point` — Address-search → lat/lng with reverse geocoding.
- `attach-image` — Image upload via FileDef + dropzone variant.
- `attach-multiple-images` — Gallery of uploaded images with state machine.
- `attach-file-generic` — Any-file FileDef. (See `boxel-file-def`.)
- ~~`attach-remote-image`~~ — **PROMOTED to Ready** above with the URL/ImageDef pair-of-fields recipe. See Pick / Input section.
- `compose-rich-text` — Long-form markdown field with BFM. (See `boxel-flavored-markdown`.)

### Build / Template (planned)

- `build-quote-document` — Quote card with line items, totals, computed taxes.
- `build-invoice-document` — Invoice template with due date, status, line items.
- `build-contract-document` — Contract template with signature blocks + approvals.
- `build-email-campaign` — Mail-merge template with per-recipient variables.
- `build-report-from-query` — Report card that pulls metrics from a query.
- `build-form-with-conditionals` — Form whose sections appear/hide based on prior answers.
- `build-document-with-toc` — Long document card with computed TOC + headings.

### Automate / Compute (planned)

- `automate-backlinks` — `backlinks` fenced block listing inbound references.
- `automate-outlinks` — `outlinks` fenced block.
- `automate-graph-view` — Cross-card graph renderer.
- `automate-tag-rollup` — Aggregate cards by tag with counts.
- `automate-task-rollup` — Pull all open tasks from descendant cards.
- `automate-toc` — Auto-generate table of contents from headings.

### Layout / Surfaces (planned)

- `layout-dashboard` — Canvas with fitted card frames grouped by section.
- `layout-card-gallery` — Grid of fitted frames, click-to-open isolated.
- `layout-comparison-view` — Same card in multiple frames at different sizes.
- `layout-design-review` — Cards at each fitted size for responsive check.
- `layout-moodboard-cross-realm` — Mixed cards from multiple realms on one canvas.
- `layout-brainstorm` — Text + card nodes connected by edges.
- `layout-architecture-diagram` — Component nodes + data-flow edges.
- `layout-timeline` — Date + event entries renderer.
- `show-kanban-from-query` — Status-grouped column view built with one `@context.searchResultsComponent` per kanban column. Lower-friction alternative to `layout-kanban-drag-drop` when drag-and-drop isn't needed; the column queries do the grouping. Extracted as the fallback shape during the 2026-05-22 sales kit.

### Link / Navigate (planned)

- `link-clickable-card` — Make any embedded card clickable to open isolated.
- `link-cross-realm` — Reference cards across realms.
- `link-inline-card-embed` — Inline-embed another card inside markdown.

### Collaborate / Discuss (planned)

- `collab-threaded-comments` — Comment system with replies and mentions.
- `collab-approvals` — Approve/flag/resolve state machine on a card.
- `collab-task-comments` — Comments that double as tracked tasks.
- `collab-agent-annotations` — Agent-authored comments distinguished from human ones.

### Integrate external (planned)

- `integrate-mime-realm-export-import` — Export/import a whole realm as MIME.

### Organize (planned)

- `organize-field-co-location` — `fields/foo/{components,util,modifiers}/*` layout.
- `organize-canvas-modifier-with-fingerprinting` — DOM modifier that rebuilds only when input fingerprint changes.
- `polymorphic-card-subclass` — CardDef hierarchy (base + N subclasses) where each subclass instance has its own URL and `adoptsFrom` discriminates the type. Different from FieldDef polymorphism (`polymorphic-field-subclass`, which mutates a field slot at runtime). Common shape for typed activity feeds, review variants, clause variants. Identified during the 2026-05-22 legal kit when `polymorphic-field-subclass` didn't match the CardDef case.

### Make Command (planned)

- `command-ad-hoc-creation` — Author a brand-new Command on the fly via `CreateCard(adoptsFrom: Command)`.
- `command-realm-search-and-transform` — Query a realm then transform results in batches.
- `command-confirmable-action` — Command that requires user approval before executing.
