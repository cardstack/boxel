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
5. If nothing matches, see **Source Realm Fallbacks** at the bottom, or fall back to the core skills (`boxel`, `boxel-design`, `boxel-ui-guidelines`). A reserved-but-unextracted slug list lives in `references/pattern-backlog.md` — **do not chase planned patterns**; fall back to core skills instead.

**Adding or promoting a pattern?** The folder shape, README template, naming conventions, `validated:` ladder, promotion bar, and host-command audit all live in `references/pattern-authoring.md`. Read it before touching the tree.

---

## Ready Patterns

Ready patterns below can be read and adapted. Each has `patterns/<slug>/README.md`; most also have a separate `patterns/<slug>/example.gts`. A few are README-with-inline-recipe — the worked code lives in fenced blocks inside the README itself, marked `(README-only)` in the list below.

> **Start here for any new card:** `theme-first-workflow` + `cardinfo-override-title` together form the recommended "step 0" for every new CardDef. Skipping them is the most common cause of cards that "look wrong" or have blank titles.

### Show

- **`app-card-home-with-search`** *(README-only)* — The home CardDef for any card family: `prefersWideFormat = true` + one `@context.searchResultsComponent` section per CardDef, live-updating. **Build this whenever you build 2+ related CardDefs.**
- `show-card-list-with-views` — Generic CardsGrid that takes `Query` + realms + a view name (`card` / `strip` / `grid`) and renders via `@context.searchResultsComponent` (entry-rooted, live by default). The lower-level building block used inside `app-card-home-with-search`.
- **`show-list-prefer-prerendered`** — The cost decision for any card that *lists* cards: render the cheap prerendered `@context.searchResultsComponent` stream, and reserve the instance-hydrating getters (`getCards` / `getCardCollection` / `store.search`) for rows you genuinely read or mutate — scoped to the current realm. Read this before writing the query for a browse/feed/roster view.
- `show-count-tiles-from-query` — Dashboard count tiles that issue `page: { size: 1 }` queries and read `results.meta.page.total` from `@context.searchResultsComponent` (with `@mode='none'`, since only the count is needed). Use for overview badges, operational signals, inbox counts, and clickable dashboard sections without rendering every matching card.
- `show-table-from-query` — Reusable table that takes a `Query` + realm and renders any cards-of-type as sortable rows. WeakMap field-component caching.
- `show-runtime-markdown-html` — Render BFM/markdown to HTML at runtime in `isolated`/`embedded` templates via MarkdownField + `<@fields.body />`.
- `show-wiki-links` — Turn `[[Page Name]]` text inside rendered MarkdownField output into clickable links that resolve against a self-referential `relatedPages = linksToMany(() => WikiPage)` relationship and call `viewCard`.
- `show-filedef-audio-player` — Durable audio playback from a realm MP3/WAV/OGG file using `linksTo(FileDef)` and optional `linksTo(ImageDef)` cover art. Use this instead of storing `blob:`, `data:`, base64, or MP3 bytes in card JSON; source is the A Million Dreams FileDef audio example.
- `show-pdf-annotations-filedef` — PDF.js viewer/annotation pattern updated for FileDef-backed PDFs: `linksTo(FileDef)` for the `.pdf`, CDN PDF.js worker setup, text-layer selection, and normalized highlight bounds in `annotationData`.

### Pick / Input

- `pick-rating` — Editable star-rating FieldDef with full/half/empty read display, atom + embedded formats, and `@set(new RatingsSummary(...))` writeback.
- `pick-typed-sort` — `SortMenu` dropdown + typed `SortOption` interface + exported `Sort` constants. Replaces ad-hoc string sort keys.
- `attach-remote-image` *(README-only)* — Image field accepting an uploaded ImageDef OR an external URL via the pair-of-fields convention (`linksTo(ImageDef)` + URL field). **Critical:** prevents the realm-bricking external-URL-in-`links.self` bug (Cardinal Rule 12). See `boxel/references/base-field-catalog.md` "Image fields — the URL/ImageDef pair pattern".

### Build / Template

- **`build-planning-cards-trio`** *(README-only)* — Stage-0 planning artifacts for any card family: three CardDefs (`ArchitecturePlan`, `DataModelPlan`, `MicroMockups`) whose `static isolated` templates ARE the plan documents. Without stage 0, fitted views come out pedestrian. See `boxel/references/design-playbook.md` "Planning before code — Stage 0".
- **`theme-first-workflow`** — Choose or create a Theme card BEFORE writing the card. Link via `cardInfo.theme`; templates reference theme tokens (`var(--background)`, `var(--primary)`, etc.) from line one. The starting step for any new card or app.
- **`cardinfo-override-title`** — Override `cardTitle` to respect `cardInfo.name` first, then fall back to a primary field (`headline`, `firstName + lastName`, etc.), then to the default. Every CardDef with a natural identifier needs this.
- `build-site-config-with-theme` — Multi-page site registry: `SiteConfig` links to a `ThemeCard` brand guide and `linksToMany(PageConfig)` nav entries; page shells compute `cardTheme` from the site unless overridden by `cardInfo.theme`.
- `containsmany-sorted-render` — Render a `containsMany`/`linksToMany` in a non-insertion order without losing the host's field rendering chrome. Sort indexes in the Component, drive `{{#each}}` with `<@fields.notes.[i] />`.
- `format-morph-shared-component` *(README-only)* — Assign one Glimmer Component to both `static isolated` and `static edit` so the component stays mounted across format flips. CSS transitions on `.card--{{@format}}` morph the visual without remount. Token-efficiency win when isolated and edit are layout variants of the same content.
- `polymorphic-field-subclass` *(README-only)* — A `contains(Shape)` slot that holds any subclass of `Shape` (Circle, Square, Triangle). Swap by assigning `new Circle({})` to the model field — first-class, type-safe, persistable. Replaces `(model as any).field = value` hacks.

### Automate / Compute

- `automate-linked-to-me-lookup` — Schema-level query-backed `linksToMany` (preferred) OR component-level `getCards()` to materialize inbound references. Two signatures documented.
- `resource-for-state` *(README-only)* — Wrap third-party library state, legacy kanban column ordering, or any "stateful object that re-runs when args change" in an `ember-modify-based-class-resource` Resource. Used by older `kanban-resource.gts` (DndColumn ordering) and `chess-game.gts` (chess.js wrapper). New kanban boards should use `layout-kanban-drag-drop`.
- `automate-image-steering` — Steerable image generator: immutable seed prompt + latest steering command + image lineage attached to OpenRouter multimodal calls, so iterative refinement doesn't lose subject identity. Includes `imageHistory`/`firstImage` pinning and `restartableTask` cancellation.

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
- `link-host-mode-paths` — Route clean external URLs (`/`, `/about`, `/pricing`) to specific cards via `hostRoutingRules` on the `RealmConfig` card at `/realm.json`. Public realms only; static paths only; same-realm references.

### Integrate external

- `integrate-openrouter-image-generation` — Preferred image generator. OpenRouter chat completions with `modalities: ['image', 'text']`; default to Gemini image, use ChatGPT/OpenAI image models when requested; persist bytes with `WriteBinaryFileCommand` + `ImageDef`.
- `integrate-one-shot-llm` — Single LLM call via `OneShotLlmRequestCommand` (OpenRouter). System + user prompt + model id → output.
- `integrate-filedef-generated-image` — Write generated image bytes with `WriteBinaryFileCommand`, then link `ImageDef` / `PngDef`.
- `integrate-screenshot-card-format` — `ScreenshotCardCommand` captures a **settled PNG of any saved card at `isolated` or `embedded` format** (Puppeteer-driven through the prerender pool) and saves it under `Screenshots/` in the target card's own realm. Use for documentation snapshots, Open Graph images, audit/before-after trails — any time you want the *actual rendered card*.
- `integrate-thumbnail-card-ai` — `GenerateThumbnailCommand` generates an **AI thumbnail** via OpenRouter, writes it to a realm, and optionally auto-patches `cardInfo.cardThumbnail` in one call. Use when you want a *designed representation* of a card rather than its actual rendering; composes with `link-command-menu-item` for one-click menu actions.
- `integrate-send-request-via-proxy` — Generic third-party HTTP through the host proxy (host handles credentials per URL host).
- `integrate-three-js-via-cdn` — Three.js inside a card via ESM CDN. Lifecycle-managed via Glimmer modifier with explicit cleanup. Same modifier shape covers Babylon.js and raw WebGL shaders.
- `integrate-three-js-3mf-fabrication` — Raised relief versus flat/flush inlay geometry, cavity overtravel, positive-scale extrusion, welded manifold meshes, and color-mapped component assemblies for 3MF slicers.
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

Each `patterns/<slug>/` is `README.md` (when/why/insight/gotchas/recipe) + optionally `example.gts` (minimal compilable code); `(README-only)` patterns keep the worked code in the README. READMEs open with `validated:` frontmatter (`linted` / `source-proven` / `sketch` / `deprecated`) — treat `sketch` as a draft and `deprecated` as a migration pointer. Full template, naming conventions, validation ladder, and promotion bar: `references/pattern-authoring.md`.

## See also — adjacent references

A few skill-tree references aren't catalogued as ready patterns but solve real implementation problems:

- **Container-query fitted layout** — `boxel/references/container-query-fitted-layout.md`. The canonical implementation guide for CSS-only fitted views with a single-root `.fit` grid querying the host's `fitted-card` container, six height quanta, `pow()`-based typography, line-budget math, and the magazine-spread / thumbnail-sidebar width thresholds. Sometimes called "CQ fitted" — searching for that in the patterns dir comes up empty because it lives as a reference. Don't add a duplicate pattern folder; link to the existing reference instead.
- **Card references in JSON** — `boxel/references/card-references.md`. Cardinal rules for `links.self` (relative vs absolute, file-extension rules for FileDef-typed relationships, why `$REALM` and `@cardstack/...` resolution work differently).
- **Command invocation modes** — `boxel/references/command-invocation-modes.md`. The taxonomy of how to expose a Command (direct call, reactive resource, card menu item, CLI script, AI invocation, atomic install).
- **Delegated render control** — `boxel-ui-guidelines/references/delegated-render-control.md`. The chrome contract + plural-field wrapper trap + divider strategy.

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

Moved to [`references/pattern-backlog.md`](references/pattern-backlog.md) — reserved slugs with no working code. Do not chase them; fall back to source realms or core skills.
