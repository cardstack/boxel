# Boxel Integration Surfaces — Cheatsheet

Every place a Boxel card can reach for capability. Use this as a lookup when planning a build; load only the sections that match the task.

> **Companion doc:** `references/libraries.md` covers import-path mechanics in more detail. This file covers the *capability* dimension — what each surface lets you DO.

---

## 1. Base Card APIs (URL-pinned)

The Boxel base realm. Always available. Imports live at `https://cardstack.com/base/<name>`.

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
| `resources/command-data` | `commandData<T>(this, CommandClass)` | Reactive resource that calls a host command. See pattern `command-data-resource`. |
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
| `planModuleInstall`, `planInstanceInstall`, `PlanBuilder` | Atomic-install planning (used by `command-atomic-install`). |
| `isCardInstance` | Type guard for command inputs. |
| `logger('namespace:operation')` | Realm-side structured logging. |
| `join` | URL join helper. |
| `loadCommandModule`, `CommandContext`, `Loader` | Command-loading internals. |
| `baseRealm`, `devSkillLocalPath`, `envSkillLocalPath` | Base-realm constants. |

---

## 3. Host Commands (`@cardstack/boxel-host/tools/<name>`)

Available only inside the running Boxel app. Each is a default-export `Command` class.

**Live audit:** verify command names against your Boxel checkout's `packages/host/app/tools/index.ts` shim list. Older audits run against a stale checkout reported `write-binary-file`, `screenshot-card`, and `generate-thumbnail` missing — they're present in the current mainline (lines 400 / 420 / 424 of the shim list at the time of writing, May 2026). When something looks "missing," check the freshness of the checkout you audited (`git log -1` in that worktree) before concluding the command isn't live.

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

These are the HTTP endpoints the host commands map to. Useful when scripting via `curl` or `boxel-cli`:

OpenRouter calls go through `/_request-forward` to the external `https://openrouter.ai/api/v1/chat/completions` URL. There is no live `/_openrouter/chat/completions` or `/_screenshot-card` endpoint in the current monorepo checkout.

| Endpoint | Method | Purpose |
|---|---|---|
| `/_federated-search` | QUERY | Cross-realm search (used by `npx boxel search` + `SearchCardsByQueryCommand` when crossing realms). |
| `/_federated-search-prerendered` | QUERY | Same with prerendered card results. |
| `/_federated-info` | GET | Cross-realm realm metadata. |
| `/_federated-types` | GET | Cross-realm type info. |
| `/_request-forward` | POST | Generic proxy endpoint (underlying `SendRequestViaProxyCommand`). |
| `/_prerender-card`, `/_prerender-module`, `/_prerender-file-extract` | POST | Prerenderer entry points. |
| `/_publish-realm`, `/_unpublish-realm` | POST | Realm publishing controls. |
| `/_create-realm`, `/_delete-realm` | POST | Realm lifecycle. |
| `/_run-command` | POST | Server-side host command execution (underlying `npx boxel run-command`). |
| `/_realm-auth` | GET | Realm auth metadata. |
| `/_queue-status` | GET | Indexing queue state. |
| `/_catalog-realms` | GET | List of catalog realms. |
| `/_standby` | GET | Health check. |

---

## 4. Boxel UI (`@cardstack/boxel-ui`)

UI kit. Three sub-paths.

### `/components`

`Button`, `BoxelButton`, `Pill`, `Avatar`, `BoxelInput`, `BoxelSelect`, `BoxelDropdown`, `Menu`, `ColorPalette`, `ColorPicker`, `Header`, `FieldContainer`, `CardContainer`, `Modal`, `Drawer`, `Toast`, `Accordion`, `FilterList`, `RadioInput`, `SkeletonPlaceholder`, `TabbedHeader`, `ViewSelector`, `ViewItem`, `BasicFitted`, `KanbanPlane`, `KanbanDragManager`, `KanbanColumnConfig`, `KanbanPlacement`, `autoPlaceKanban`, `cardsInColumn`, `kanbanColumnCount`, `resolveInsertion`.

Use `KanbanPlane` for lane-based drag/drop boards instead of hand-rolled DOM drag code. Persist placements by stable card id + column key + sort order, map to `KanbanPlacement.index` only at render time, and render child cards through `@fields` at fitted format. Pattern: `layout-kanban-drag-drop`.

### `/helpers`

Logic: `eq`, `not`, `and`, `or`, `gt`, `gte`, `lt`, `lte`, `add`, `subtract`, `multiply`, `divide`.
Templates: `cn` (class names), `cssVar`, `element` (dynamic tag), `optional`, `pick`.
Format: `formatDateTime`, `formatNumber`, `formatCurrency`, `formatRelativeTime`, `formatDuration`, `formatCountdown`, `formatFileSize`, `formatList`, `formatNames`, `formatOrdinal`, `formatPeriod`, `formatAge`, `currencyFormat` (legacy), `dayjsFormat` (deprecated).
Markdown: `markdownEscape`.
Menus: `MenuItem`, `MenuItemOptions`.

### `/icons`

Boxel UI's curated icon set. Imported as `import IconName from '@cardstack/boxel-ui/icons/<name>'`. Also `@cardstack/boxel-icons/<name>` for the broader Lucide/Tabler-style set used in catalog.

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

## 6. Realm-bundled libraries (workspace-specific)

Substantial libraries shipped inside the realm filesystem rather than via npm — Boxel's de-facto package manager. The actual library catalogue, canonical URLs, and import statements are workspace-specific.

Common kinds of realm-bundled libraries:

- **UI surface frameworks** — layout primitives (Layout / Pane / Form / Grid / Cell / Run / Lift), focus-tree keyboard nav, pluggable CSS themes.
- **Computation runtimes** — bxl-style unified runtimes that combine a jq-flavored JSON query language with Excel-compatible formula libraries (Bessel, statistical, financial, engineering, validation).
- **Canvas / flow editors** — XYFlow-style node-graph editors, flowcharts, canvas pan/zoom.

Ask the user which of these (or other) realm-bundled libraries the workspace hosts. The extension pattern (e.g. `library-<name>`) has the import root and idiomatic usage. The realm-bundle-shim convention (how to ship a library inside a realm) also lives in extensions.

---

## 7. AI services

### `OneShotLlmRequestCommand` — via OpenRouter

Single LLM call, no conversation. Routes through the host's OpenRouter credentials.

Pattern: `integrate-one-shot-llm`.

Common models: `anthropic/claude-haiku-4.5`, `anthropic/claude-sonnet-4.6`, `openai/gpt-4.1-nano`, `openai/gpt-5`.

### `UseAiAssistantCommand` — multi-turn

Card kicks off an AI conversation with a Skill card pre-loaded. For interactive flows.

Pattern: `command-with-skill-card-ref`.

Path: `@cardstack/boxel-host/tools/ai-assistant` (newer than the older `commands/use-ai-assistant`).

### OpenRouter Image Generation

Preferred image generation surface. Use `SendRequestViaProxyCommand` against `https://openrouter.ai/api/v1/chat/completions` with `modalities: ['image', 'text']`.

Default to `google/gemini-2.5-flash-image`. Use ChatGPT/OpenAI image models, such as `openai/gpt-5.4-image-2` or `openai/gpt-5-image-mini`, when requested.

Generated images arrive as data URLs in `choices[0].message.images`. Persist the bytes with `WriteBinaryFileCommand`, then link `ImageDef` / `PngDef` / `FileDef`.

Pattern: `integrate-openrouter-image-generation`.

### Generated Image FileDef

Write generated image bytes to the realm with `WriteBinaryFileCommand`.

The command returns `fileIdentifier`; assign a new `ImageDef` / `PngDef` with `id`, `url`, and `sourceUrl` set to that identifier, then save the owning card. Legacy image-card persistence is deprecated for new work.

### `SendRequestViaProxyCommand` — generic HTTP

Underlying primitive for any API. Pattern: `integrate-send-request-via-proxy`. Use when OneShot or a specific API recipe does not cover your shape.

---

## 8. ESM CDN libraries

Direct browser ESM imports for libraries Boxel realms don't bundle.

| URL pattern | Use for | Pattern |
|---|---|---|
| `https://esm.run/three@<ver>` | Three.js — 3D / WebGL (also Babylon.js, raw WebGL — same modifier shape) | `integrate-three-js-via-cdn` |
| `https://esm.sh/leaflet@<ver>` | Leaflet — maps | `integrate-leaflet-via-cdn` |
| `https://esm.run/chess.js@<ver>` + `cm-chessboard` | Chess engine + board | `integrate-chess-js-via-cdn` |
| `https://esm.run/tone@14` | Tone.js — music toolkit (synths, transports, effects) | `integrate-tone-js-via-cdn` |
| `https://esm.sh/<any-package>` | Any npm package as ESM | Same lifecycle pattern as above |

**Built-in audio** doesn't need a CDN: `AudioContext`, `OscillatorNode`, and friends live in the browser. See `integrate-web-audio-synthesis` for the raw-API pattern — UI sound feedback, drum machines, tone generators — paralleling the Three.js modifier lifecycle.

**Trade-off:** No reproducible build. URL-pin versions and document the choice. For reproducibility, use the realm-bundled approach.

---

## 9. BFM (Boxel Flavored Markdown) features

The dialect Boxel reads and writes. See [bfm.boxel.site](https://bfm.boxel.site) for the spec. Patterns: `show-runtime-markdown-html` (render), `boxel-markdown-format` skill (emit).

### CommonMark + GFM baseline

Headings, lists, code fences, tables, alerts (`> [!NOTE]`), task lists, strikethrough, footnotes, extended autolinks.

### Boxel extensions

- **Card directives** — `:card[<url>]` inline embed, `::card[<url>]` block embed, `::card[<url> | size]` sized block embed.
- **Mermaid** — ` ```mermaid ` fenced diagrams.
- **Math** — `$...$` (inline) / `$$...$$` (block) LaTeX via KaTeX.
- **Wiki links / embeds** — `[[name]]` and `![[name]]` (Obsidian compatibility).
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
- `markdown-helpers` module (`@cardstack/...`) — pre-escaped formatters for dates, links, images, card embeds.

---

## 10. boxel-cli commands

Local CLI for realm sync, watching, checkpoints, federated search, and scripted host commands. Workflow command: `/boxel-sync-workspace`.

> **Note on versions.** If `/usr/local/bin/boxel --help` shows a smaller surface (just `realm create/pull/push/sync` + `profile` + `run-command`), that's a stale install. The full set below comes from the source at `~/Projects/boxel/packages/boxel-cli`. Rebuild + relink to get all commands.

### Full subcommand surface

```
boxel profile [list|use|create|delete] [name]               Profile / environment management

npx boxel realm create <name> <display-name>                    Create a realm on the server
npx boxel realm list [--all-accessible|--hidden] [--json]       List realms in current profile
npx boxel realm remove <realm-url>                              Remove a realm (destructive)
npx boxel realm wait-for-ready --realm <url> [--timeout <ms>]   Block until realm is reachable
npx boxel realm cancel-indexing --realm <url> [--cancel-pending] Cancel indexing jobs

npx boxel realm pull <realm-url> <local-dir>                    Realm → local
npx boxel realm push <local-dir> <realm-url>                    Local → realm
npx boxel realm sync <local-dir> <realm-url>                    Bidirectional
npx boxel realm status <local-dir>                              Classify changes vs the manifest

npx boxel realm history <local-dir>                             List checkpoints
npx boxel realm history <local-dir> --restore <id|hash>         Restore a checkpoint
npx boxel realm history <local-dir> --message "<msg>"           Create a manual checkpoint
npx boxel realm history <local-dir> --limit <n>                 Extend listing depth (default 100)

npx boxel realm milestone <local-dir> --mark <id> --name <name> Mark a checkpoint as milestone
npx boxel realm milestone <local-dir> --remove <id|hash>        Remove a milestone tag

npx boxel realm watch start <local-dir>                         Auto-sync on file changes (acquires lock)
npx boxel realm watch stop                                      Stop the running watcher

npx boxel file read <path>                                       Read one file from a realm
npx boxel file write <path> [< stdin]                            Write one file to a realm
npx boxel file list <path>                                       List realm contents
npx boxel file touch <path>                                      Re-index one file
npx boxel file delete <path>                                     Delete one file

npx boxel file lint <path> --realm <url> --file <local-file>     Lint a local file against a realm
npx boxel lint [path] --realm <url>                              Lint one remote file or a whole realm

# Do NOT use `npx boxel check <file>` for lint — that's a sync-state report only.
# Clean lint means `No lint issues found` or JSON messages: [].

npx boxel search '<query-json>' --realms <urls>                 Federated search across realms
                                                            (hits /_federated-search)

npx boxel run-command <command-specifier> [--realm <url>] [--input <json>] [--json]
                                                            Execute a host command via the prerenderer

boxel consolidate-workspaces                                Merge multiple watched workspaces (interactive)
```

### Common flags

| Flag | Applies to | Effect |
|---|---|---|
| `--dry-run` | pull / push / sync / status | Preview without writing. |
| `--delete` | pull / push / sync | Also propagate deletions. |
| `--force` | push | Re-upload everything, even unchanged. |
| `--prefer-local` / `--prefer-remote` / `--prefer-newest` | sync | Conflict resolution policy. One required for sync. |
| `--realm <url>` | run-command, wait-for-ready, cancel-indexing | Realm context. |
| `--input <json>` | run-command | JSON-string input. |
| `--json` | run-command, list, search | Raw JSON output (for piping). |
| `--limit <n>` | history | Listing depth (default 100). |
| `--restore <id\|hash>` | history | Restore to a checkpoint. |
| `--message <msg>` | history | Manual checkpoint. |
| `--mark <id> --name <name>` | milestone | Tag a checkpoint as a milestone. |

### Per-realm artifacts the CLI manages

- `.boxel-sync.json` — file → md5 checksum map (the manifest the CLI compares against).
- `.boxel-history/.git/` — per-realm git history. Each pull/push/sync auto-commits with source-tagging (`local`, `remote`, `manual`).
- Milestones are git tags on `.boxel-history/.git`.
- Watch lock: stored inside `.boxel-sync.json` so only one watcher runs per workspace.

---

## Index by intent

| If you want to… | Look here |
|---|---|
| Define a card schema | §1 (base APIs) + §2 (runtime types) |
| Render a UI | §4 (Boxel UI) + §5 (Ember/Glimmer) |
| Build a drag/drop kanban board | §4 (`KanbanPlane`) + pattern `layout-kanban-drag-drop` |
| Build a layout/dashboard | §6 (a workspace's UI surface library, if present) + patterns `layout-*` |
| Add a file/image field | §1 (FileDef subtypes) + pattern `add-file-field` |
| Call an LLM | §3 (host commands) + §7 (AI services) + pattern `integrate-one-shot-llm` |
| Generate an AI image | §7 (OpenRouter image generation) + pattern `integrate-openrouter-image-generation`; write output bytes with `WriteBinaryFileCommand` |
| Hit a third-party HTTP API | §3 + §7 + pattern `integrate-send-request-via-proxy` |
| Embed Three.js / Leaflet / chess.js | §8 (ESM CDN) + patterns `integrate-three-js-via-cdn` etc. |
| Render BFM | §9 (BFM features) + pattern `show-runtime-markdown-html` |
| Write BFM (static markdown format) | §9 + skill `boxel-markdown-format` |
| Sync a realm locally | §10 (boxel-cli) + command `/boxel-sync-workspace` |
| Drive the live Boxel app | §3 (host commands) + skill `boxel-environment` |
