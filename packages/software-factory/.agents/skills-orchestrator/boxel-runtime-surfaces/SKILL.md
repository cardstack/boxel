---
name: boxel-runtime-surfaces
description: Map of everything Boxel card code can reach — base card-api, host tools, boxel-ui components/helpers, runtime-common, CardContext, AI services, BFM. Use when writing card code that needs an import you don't know the path for, or before reaching for raw fetch / a CDN / a hand-rolled capability.
---

# Boxel Runtime Surfaces

Every capability a card (`.gts`) can reach, and where its import comes from.
Before hand-rolling anything or importing from a CDN, check whether one of
these surfaces already provides it.

Two on-demand references carry the full detail:

- `references/libraries.md` — the import-path catalogue (exact `import` lines per symbol).
- `references/integration-surfaces.md` — the capability cheatsheet (what each surface lets you DO, plus realm-server endpoints, BFM features, and boxel-cli).

## The capability groups

### 1. Base card API (URL-pinned, always available)

`https://cardstack.com/base/<module>` — `card-api` provides `CardDef`,
`FieldDef`, `Component`, `field`, `contains`, `containsMany`, `linksTo`,
`linksToMany`, plus the `realmURL` Symbol on models. Field types each live in
their own module (`string`, `number`, `boolean`, `date`, `datetime`,
`markdown`, `enum`, `color`, `url`, `email`, …). File-backed fields
(`FileDef`, `ImageDef`, `PngDef`, `MarkdownDef`, `CsvFileDef`, …) come from
the `*-file-def` modules and are used via `linksTo`. Base field modules are
**default exports** (`import StringField from 'https://cardstack.com/base/string'`).

### 2. Runtime APIs — `@cardstack/runtime-common`

`getCards`, `getCard`, `Command`, `Query`/`Sort`/`TypedFilter` types,
`codeRef()`, the `realmURL` Symbol (import it — **never**
`Symbol.for('realmURL')`), `searchEntryWireQueryFromQuery` +
`SearchEntryWireQuery` (the wire-query builder for
`@context.searchResultsComponent`), JSON:API relationship helpers, logging.

### 3. Host tools — `@cardstack/boxel-host/tools/<kebab-name>`

Default-export `Command` classes, only available inside the running app:
search-cards, save-card, patch-fields, show-card, switch-submode, ai-assistant,
one-shot-llm-request, send-request-via-proxy, authed-fetch, write-binary-file,
reindexing controls, catalog/listing operations, and more.

> **Path rule:** the import root is `tools/`. The pre-rename
> `@cardstack/boxel-host/commands/…` path NO LONGER EXISTS — imports of it
> pass every static gate (lint, schema probe, evaluate, indexing) and fail
> only when a user triggers the code path in the browser. LLMs trained
> before the rename write `commands/` — correct it on sight.

### 4. UI kit — `@cardstack/boxel-ui`

- `/components` — `Button`, `Pill`, `Avatar`, `BoxelInput`, `BoxelSelect`,
  `CardContainer`, `Modal`, `Drawer`, `Toast`, `FieldContainer`,
  `KanbanPlane` (+ drag/drop helpers), and more.
- `/helpers` — logic (`eq`, `cn`, `gt`, `and`, `or`, …), formatters
  (`formatDateTime`, `formatNumber`, `formatCurrency`,
  `formatRelativeTime`, …), `markdownEscape`.
- `/icons/<name>` — curated icon set; broader set at `@cardstack/boxel-icons/<name>`.

### 5. CardContext — `@context` in templates

The host injects a context into every card component:
`@context.searchResultsComponent` (live result lists — see the
`boxel-live-surfaces` skill), `@context.cardComponentModifier` (makes
rendered tiles clickable in-app), and a `commandContext` for running host
commands from card code. Data access from card code goes through the
store APIs (`getCard`, `getCards`, store search) — these carry the user's
authenticated session; raw `fetch()` does not.

### 6. AI services

- **One-shot LLM** — `OneShotLlmRequestCommand`
  (`tools/one-shot-llm-request`): single LLM call, no conversation, routed
  through the host's OpenRouter credentials.
- **Multi-turn** — `UseAiAssistantCommand` (`tools/ai-assistant`): opens an
  AI room with a Skill card pre-loaded.
- **Image generation** — `SendRequestViaProxyCommand` against
  `https://openrouter.ai/api/v1/chat/completions` with
  `modalities: ['image', 'text']`; default model
  `google/gemini-2.5-flash-image`. Persist returned data-URL bytes with
  `WriteBinaryFileCommand`, then link an `ImageDef`/`PngDef` — never inline
  base64 into card JSON.
- **Generic HTTP** — `SendRequestViaProxyCommand` (`/_request-forward` on
  the realm server) for any external API; credentials are handled host-side.

### 7. BFM — Boxel Flavored Markdown

`MarkdownField` values render as rich markdown: CommonMark + GFM, plus card
directives (`:card[<url>]` inline, `::card[<url>]` block), mermaid, LaTeX
math, fenced data renderers (`csv`, `kanban`, `excalidraw`, `geojson`, …),
and computed renderers (`toc`, `tasks`, `backlinks`, …). Spec:
[bfm.boxel.site](https://bfm.boxel.site).

### 8. ESM CDN (last resort for third-party libs)

`https://esm.run/<pkg>` / `https://esm.sh/<pkg>` for libraries not covered
above (Three.js, Leaflet, Tone.js, …). URL-pin the version and document it
in a comment — there is no reproducible build.

## Quick triage

| I need to… | Reach for |
|---|---|
| Define schema / fields | Base card API (§1) |
| Query or load cards from card code | CardContext store APIs / `getCards` (§2, §5) — never raw fetch |
| Run an app-level action (save, show, search, reindex) | Host tools (§3) |
| Build UI | boxel-ui (§4) + Glimmer/Ember primitives (see references/libraries.md) |
| Live, self-updating card lists | `@context.searchResultsComponent` — load the `boxel-live-surfaces` skill |
| Call an LLM / generate an image / hit an external API | AI services (§6) |
| Rich text content | BFM (§7) |
| A third-party JS library | ESM CDN (§8), pinned |
