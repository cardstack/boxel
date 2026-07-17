# Boxel Integration Surfaces — Cheatsheet

Every place a Boxel card can reach for capability. Use this as a lookup when
planning a build; load only the sections that match the task.

> **Companion doc:** `libraries.md` covers import-path mechanics in more
> detail. This file covers the *capability* dimension — what each surface
> lets you DO.

---

## 1. Base Card APIs (URL-pinned)

The Boxel base realm. Always available. Imports live at
`https://cardstack.com/base/<name>`.

| Module | Provides | Use for |
|---|---|---|
| `card-api` | `CardDef`, `FieldDef`, `Component`, `Box`, `field`, `contains`, `containsMany`, `linksTo`, `linksToMany`, `instanceOf`, `realmURL` | Every CardDef and FieldDef in the system. |
| `string` | `StringField` | Plain text. |
| `number` | `NumberField` | Numeric values. |
| `boolean` | `BooleanField` | True/false. |
| `date` | `DateField` (+ `date/year` for year-only) | Calendar dates. |
| `datetime` | `DatetimeField` | Date + time. |
| `date-range-field` | `DateRangeField` | Spans. |
| `email` | `EmailField` | Validated email. |
| `url` | `UrlField` | Validated URLs (used by AI services for image refs). |
| `markdown` | `MarkdownField` | Rich markdown content (BFM) — renders as HTML in templates. |
| `rich-markdown` | Variants of MarkdownField | Extended BFM rendering. |
| `enum` | `EnumField` and helpers | Constrained-value dropdowns. |
| `color` | `ColorField` | CSS color values. |
| `currency` | `CurrencyField` | Currency codes (ISO). |
| `amount-with-currency` | Compound currency-typed amount | Money values. |
| `code-ref` | `CodeRefField`, `AbsoluteCodeRefField` | References to other CardDefs/FieldDefs. |
| `image` | `ImageCard` (CardDef base) | Image card base for custom image-card schemas. Prefer FileDef subtypes for stored media files. |
| `base64-image` | `Base64ImageField` (legacy — avoid) | Inlined base64 image. **Don't use for new cards** — embeds binary in JSON. Use FileDef subtypes instead. |
| `image-file-def`, `png-image-def`, `svg-image-def`, `gif-image-def`, `webp-image-def`, `avif-image-def`, `jpg-image-def` | `ImageDef`, `PngDef`, etc. | File-backed image fields (use `linksTo`). |
| `markdown-file-def` | `MarkdownDef` | File-backed markdown asset (different from MarkdownField — that's a value, this is a file). |
| `text-file-def`, `ts-file-def`, `gts-file-def`, `json-file-def`, `csv-file-def` | File-backed text-format assets | Linked file assets. |
| `file-api` | `FileDef` | Generic file-backed field base. |
| `shared-state` | `sharedState()` | Cross-component reactive state. |
| `skill`, `skill-plus`, `skill-set` | `Skill`, `SkillPlusMarkdown`, `SkillSet`, `SkillReference` | Boxel skill cards. |
| `spec` | `Spec` | Card/Field/App/Skill/Command specs. |
| `system-card` | `SystemCard` and members | System-level cards (model configuration, realm metas). |
| `resources/command-data` | `commandData<T>(this, CommandClass)` | Reactive resource that calls a host command. |
| `command` | `GetAllRealmMetasResult`, `RealmMetaField`, `ListingInstallInput`, etc. | Type definitions for host command results. |
| `commands/search-card-result` | Result types | For search command typing. |

---

## 2. Runtime APIs (`@cardstack/runtime-common`)

The shared runtime layer. Available in any `.gts` or `.ts` in the realm.

| Symbol | Use for |
|---|---|
| `Command<TInput, TResult>` | Base class for new Commands. |
| `getCards`, `getCard` | Query the realm for cards by filter. |
| `getField`, `getFieldIcon`, `cardDefComputedFields` | Field metadata for generic rendering. |
| `searchResultsComponent` | Preferred result-list surface for new work — the `<SearchResults>` component, used via `@context.searchResultsComponent` (entry-rooted query built with `searchEntryWireQueryFromQuery`). |
| `prerenderedCardSearchComponent` | Older card-grid surface (via `@context.prerenderedCardSearchComponent`), superseded by `searchResultsComponent`. |
| `searchEntryWireQueryFromQuery`, `SearchEntryWireQuery` | Build the entry-rooted query that `@context.searchResultsComponent` takes, from an ordinary `Query`. |
| `getMenuItems`, `GetMenuItemParams` | Typed menu construction. |
| `baseRRI('<module>')` | Canonical base-realm module URL. |
| `Query`, `Sort`, `TypedFilter` | Query type primitives. |
| `ResolvedCodeRef` | Strongly-typed code references. |
| `Relationship`, `extractRelationshipIds` | JSON:API relationship helpers. |
| `planModuleInstall`, `planInstanceInstall`, `PlanBuilder` | Atomic-install planning. |
| `isCardInstance` | Type guard for command inputs. |
| `logger('namespace:operation')` | Realm-side structured logging. |
| `join` | URL join helper. |
| `loadCommandModule`, `CommandContext`, `Loader` | Command-loading internals. |
| `baseRealm`, `devSkillLocalPath`, `envSkillLocalPath` | Base-realm constants. |

---

## 3. Host Tools (`@cardstack/boxel-host/tools/<name>`)

Available only inside the running Boxel app. Each is a default-export
`Command` class.

**Live audit:** verify tool names against the Boxel monorepo's
`packages/host/app/tools/index.ts` shim list. `write-binary-file`,
`screenshot-card`, and `generate-thumbnail` are present in current mainline;
if something looks "missing," check the freshness of the checkout you
audited before concluding the tool isn't live.

| Path | Purpose |
|---|---|
| `ai-assistant` | Open the AI room with a skill card + attached cards (the canonical "ask AI" recipe). |
| `create-ai-assistant-room`, `open-ai-assistant-room`, `send-ai-assistant-message` | Lower-level AI room lifecycle primitives used by the host UI. Prefer `ai-assistant` unless you are matching app behavior. |
| `one-shot-llm-request` | Single LLM call, no conversation. Routes via OpenRouter. |
| `set-active-llm` | Pin the LLM model for the next conversation. |
| `sync-openrouter-models` | Refresh OpenRouter model cards into the configured OpenRouter realm. |
| `send-request-via-proxy` | Arbitrary HTTP through the realm proxy (credentials handled host-side). |
| `authed-fetch` | Host-side fetch wrapper with authenticated realm access. |
| `save-card` | Persist a CardDef instance to a realm. |
| `patch-fields` | Surgical field updates on an instance (requires approval). |
| `patch-card-instance` | Full-card replace (use sparingly). |
| `apply-markdown-edit` | Targeted edits in long markdown fields (requires approval). |
| `write-text-file` | Write a `.json` instance (requires approval). **Never use for `.gts`** — UI freezes. |
| `copy-card`, `copy-source`, `copy-file-to-realm` | Duplicate a card, source file, or FileDef-backed asset (requires approval where applicable). |
| `transform-cards` | Bulk command-applied transform (requires approval). |
| `read-file-for-ai-assistant`, `read-card-for-ai-assistant` | Load file or card content into context. |
| `search-cards` | `SearchCardsByQueryCommand` (advanced) and `SearchCardsByTypeAndTitleCommand` (simple). |
| `search-google-images` | Google Custom Search image lookup through `send-request-via-proxy`; returns image/result metadata, not a stored realm file. |
| `search-and-choose` | Search cards, ask the LLM to choose numbered options, and return selected ids/cards. Used by listing flows. |
| `switch-submode` | Toggle interact/code modes, create-file mode. |
| `show-card`, `show-file` | Display a card or source file in the current submode. |
| `preview-format` | Open module + card preview side-by-side (code mode). |
| `update-code-path-with-selection` | Navigate the code editor. |
| `open-workspace` | Switch workspace by URL. |
| `update-room-skills` | Activate / deactivate skills in the AI room. |
| `execute-atomic-operations` | Run a transactional plan (used by listing-install). |
| `fetch-card-json`, `get-card`, `read-source`, `serialize-card`, `validate-realm` | Realm-server primitives. |
| `get-card-type-schema` | Introspect a CardDef's field shape. |
| `get-all-realm-metas`, `get-available-realm-urls`, `get-default-writable-realm` | Realm metadata and writable-realm discovery. |
| `get-catalog-realm-urls`, `get-realm-of-url`, `can-read-realm` | Catalog/realm lookups and access checks. |
| `store-add` | Add a card to the store. |
| `listing-create`, `listing-install`, `listing-remix`, `listing-use`, `listing-generate-example`, `listing-update-specs` | Catalog operations. |
| `listing-action-build`, `listing-action-init` | Listing workflow setup/build actions. |
| `create-and-open-submission-workflow-card`, `create-submission-workflow` | Catalog submission flow. |
| `generate-example-cards`, `populate-with-sample-data`, `generate-readme-spec`, `generate-theme-example` | Code-mode/sample-data helpers used by app workflows. Treat as app affordances, not portable card patterns. |
| `get-user-system-card`, `set-user-system-card`, `summarize-session` | User/system-card and session helper commands. |
| `reindex-realm`, `full-reindex-realm`, `cancel-indexing-job`, `invalidate-realm-identifiers` | Indexing control (requires write access). |
| `sanitize-module-list` | Validate a module list. |

### Realm-server underscored endpoints (called directly when scripting)

These are the HTTP endpoints the host tools map to. Useful when scripting
via `curl` or `boxel-cli`:

OpenRouter calls go through `/_request-forward` to the external
`https://openrouter.ai/api/v1/chat/completions` URL. There is no live
`/_openrouter/chat/completions` or `/_screenshot-card` endpoint in the
current monorepo.

| Endpoint | Method | Purpose |
|---|---|---|
| `/_federated-search` | QUERY | Cross-realm search (used by `boxel search` + `SearchCardsByQueryCommand` when crossing realms). |
| `/_federated-search-prerendered` | QUERY | Same with prerendered card results. |
| `/_federated-info` | GET | Cross-realm realm metadata. |
| `/_federated-types` | GET | Cross-realm type info. |
| `/_request-forward` | POST | Generic proxy endpoint (underlying `SendRequestViaProxyCommand`). |
| `/_prerender-card`, `/_prerender-module`, `/_prerender-file-extract` | POST | Prerenderer entry points. |
| `/_publish-realm`, `/_unpublish-realm` | POST | Realm publishing controls. |
| `/_create-realm`, `/_delete-realm` | POST | Realm lifecycle. |
| `/_run-command` | POST | Server-side host command execution (underlying `boxel run-command`). |
| `/_realm-auth` | GET | Realm auth metadata. |
| `/_queue-status` | GET | Indexing queue state. |
| `/_catalog-realms` | GET | List of catalog realms. |
| `/_standby` | GET | Health check. |

---

## 4. Boxel UI (`@cardstack/boxel-ui`)

UI kit. Three sub-paths.

### `/components`

`Button`, `BoxelButton`, `Pill`, `Avatar`, `BoxelInput`, `BoxelSelect`,
`BoxelDropdown`, `Menu`, `ColorPalette`, `ColorPicker`, `Header`,
`FieldContainer`, `CardContainer`, `Modal`, `Drawer`, `Toast`, `Accordion`,
`FilterList`, `RadioInput`, `SkeletonPlaceholder`, `TabbedHeader`,
`ViewSelector`, `ViewItem`, `BasicFitted`, `KanbanPlane`,
`KanbanDragManager`, `KanbanColumnConfig`, `KanbanPlacement`,
`autoPlaceKanban`, `cardsInColumn`, `kanbanColumnCount`, `resolveInsertion`.

Use `KanbanPlane` for lane-based drag/drop boards instead of hand-rolled DOM
drag code. Persist placements by stable card id + column key + sort order,
map to `KanbanPlacement.index` only at render time, and render child cards
through `@fields` at fitted format.

### `/helpers`

Logic: `eq`, `not`, `and`, `or`, `gt`, `gte`, `lt`, `lte`, `add`,
`subtract`, `multiply`, `divide`.
Templates: `cn` (class names), `cssVar`, `element` (dynamic tag),
`optional`, `pick`.
Format: `formatDateTime`, `formatNumber`, `formatCurrency`,
`formatRelativeTime`, `formatDuration`, `formatCountdown`, `formatFileSize`,
`formatList`, `formatNames`, `formatOrdinal`, `formatPeriod`, `formatAge`,
`currencyFormat` (legacy), `dayjsFormat` (deprecated).
Markdown: `markdownEscape`.
Menus: `MenuItem`, `MenuItemOptions`.

### `/icons`

Boxel UI's curated icon set. Imported as
`import IconName from '@cardstack/boxel-ui/icons/<name>'`. Also
`@cardstack/boxel-icons/<name>` for the broader Lucide/Tabler-style set used
in catalog.

---

## 5. Ember / Glimmer tools

| Module | Provides | Notes |
|---|---|---|
| `@glimmer/component` | `GlimmerComponent` (default), `Component` | Class-based components. |
| `@glimmer/tracking` | `tracked` decorator | Reactive state. |
| `@ember/component/template-only` | `TemplateOnlyComponent<Sig>` | Pure-render components. |
| `@ember/component` | `setComponentTemplate` | Low-level template attachment. |
| `@ember/template` | `htmlSafe`, `precompileTemplate` | Safe-string + dynamic templates. |
| `@ember/template-compilation` | `precompileTemplate` | Compile-time templates. |
| `@ember/modifier` | `on` modifier | Event listeners. |
| `@ember/helper` | `fn`, `hash`, `array`, `get`, `concat` | Template helpers. |
| `@ember/object` | `action` decorator | Method binding. |
| `@ember/owner` | `Owner` type | Component owner. |
| `@ember/service` | Service decorator | Ember services. |
| `@ember/destroyable` | `registerDestructor` | Lifecycle cleanup. |
| `ember-concurrency` | `task`, `restartableTask`, `dropTask`, `enqueueTask`, `keepLatestTask` | Async coordination. |
| `ember-resources` | `Resource`, `resource()`, `use` | Reactive resources. |
| `ember-modifier` | `modifier()` | DOM-lifecycle modifiers. |

---

## 6. AI services

### `OneShotLlmRequestCommand` — via OpenRouter

Single LLM call, no conversation. Routes through the host's OpenRouter
credentials.

Common models: `anthropic/claude-haiku-4.5`, `anthropic/claude-sonnet-4.6`,
`openai/gpt-4.1-nano`, `openai/gpt-5`.

### `UseAiAssistantCommand` — multi-turn

Card kicks off an AI conversation with a Skill card pre-loaded. For
interactive flows.

Path: `@cardstack/boxel-host/tools/ai-assistant` (newer than the older
`commands/use-ai-assistant`).

### OpenRouter Image Generation

Preferred image generation surface. Use `SendRequestViaProxyCommand` against
`https://openrouter.ai/api/v1/chat/completions` with
`modalities: ['image', 'text']`.

Default to `google/gemini-2.5-flash-image`. Use ChatGPT/OpenAI image models,
such as `openai/gpt-5.4-image-2` or `openai/gpt-5-image-mini`, when
requested.

Generated images arrive as data URLs in `choices[0].message.images`. Persist
the bytes with `WriteBinaryFileCommand`, then link `ImageDef` / `PngDef` /
`FileDef`.

### Generated Image FileDef

Write generated image bytes to the realm with `WriteBinaryFileCommand`.

The command returns `fileIdentifier`; assign a new `ImageDef` / `PngDef`
with `id`, `url`, and `sourceUrl` set to that identifier, then save the
owning card. Legacy image-card persistence is deprecated for new work.

### `SendRequestViaProxyCommand` — generic HTTP

Underlying primitive for any API. Use when OneShot or a specific API recipe
does not cover your shape.

---

## 7. ESM CDN libraries

Direct browser ESM imports for libraries Boxel realms don't bundle.

| URL pattern | Use for |
|---|---|
| `https://esm.run/three@<ver>` | Three.js — 3D / WebGL (also Babylon.js, raw WebGL — same modifier shape) |
| `https://esm.sh/leaflet@<ver>` | Leaflet — maps |
| `https://esm.run/chess.js@<ver>` + `cm-chessboard` | Chess engine + board |
| `https://esm.run/tone@14` | Tone.js — music toolkit (synths, transports, effects) |
| `https://esm.sh/<any-package>` | Any npm package as ESM |

**Built-in audio** doesn't need a CDN: `AudioContext`, `OscillatorNode`, and
friends live in the browser — UI sound feedback, drum machines, tone
generators.

**Trade-off:** No reproducible build. URL-pin versions and document the
choice.

---

## 8. BFM (Boxel Flavored Markdown) features

The dialect Boxel reads and writes. See
[bfm.boxel.site](https://bfm.boxel.site) for the spec.

### CommonMark + GFM baseline

Headings, lists, code fences, tables, alerts (`> [!NOTE]`), task lists,
strikethrough, footnotes, extended autolinks.

### Boxel extensions

- **Card directives** — `:card[<url>]` inline embed, `::card[<url>]` block
  embed, `::card[<url> | size]` sized block embed.
- **Mermaid** — ` ```mermaid ` fenced diagrams.
- **Math** — `$...$` (inline) / `$$...$$` (block) LaTeX via KaTeX.
- **Wiki links / embeds** — `[[name]]` and `![[name]]` (Obsidian
  compatibility).
- **Highlights** — `==text==`.
- **Block references** — `^block-id`.
- **Heading IDs** — `# Heading {#custom-id}`.
- **Code highlighting** — Monaco for any ` ```language ` block.

### Fenced renderers (data-in)

- `mermaid` — diagrams.
- `geojson`, `topojson` — maps.
- `stl` — 3D model viewer.
- `math` — LaTeX.
- `csv` — auto-rendered table.
- `slides` — markdown slide deck.
- `excalidraw` — whiteboard.
- `kanban` — board.

### Computed renderers (data-from-document)

- `toc` / `table-of-contents`.
- `comments` — comment summary.
- `tasks` — task rollup.
- `backlinks`, `outlinks` — link views.
- `graph` — connection map.
- `tags` — tag summary.

### Card layout renderers

- `canvas` — JSON canvas with positioned card frames.
- `timeline`, `gallery`, `chart`, `embed`.

### Tools

- `markdownEscape` from `@cardstack/boxel-ui/helpers` — escape user input.
- `markdown-helpers` module (`@cardstack/...`) — pre-escaped formatters for
  dates, links, images, card embeds.

---

## Index by intent

| If you want to… | Look here |
|---|---|
| Define a card schema | §1 (base APIs) + §2 (runtime types) |
| Render a UI | §4 (Boxel UI) + §5 (Ember/Glimmer) |
| Build a drag/drop kanban board | §4 (`KanbanPlane`) |
| Add a file/image field | §1 (FileDef subtypes) |
| Call an LLM | §3 (host tools) + §6 (AI services) |
| Generate an AI image | §6 (OpenRouter image generation); write output bytes with `WriteBinaryFileCommand` |
| Hit a third-party HTTP API | §3 (`send-request-via-proxy`) + §6 |
| Embed Three.js / Leaflet / chess.js | §7 (ESM CDN) |
| Render or write BFM | §8 (BFM features) |
| Drive the live Boxel app | §3 (host tools) |
