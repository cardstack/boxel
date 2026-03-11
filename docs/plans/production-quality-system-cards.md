# Plan: Production-Quality System Cards — OpenRouter Model Sync

**Linear Project:** [Production-Quality System cards](https://linear.app/cardstack/project/production-quality-system-cards-7b400b8c99b8)
**Date:** 2026-03-11

## Executive Summary

Replace the manual management of OpenRouter model card instances with an automated daily sync pipeline. This involves:

1. A dedicated **OpenRouter Models realm** (public-readable) in each environment
2. An automated **sync command** that fetches from the OpenRouter API and writes/updates model cards
3. A **cron-scheduled job** in the worker-manager that triggers the sync daily via headless Chrome
4. **Refactoring ModelConfiguration** to link to OpenRouterModel cards instead of duplicating data
5. An **environment-mapped realm URL** (`@cardstack/openrouter/`) similar to `@cardstack/catalog/`

---

## Current State

### What exists today

- **`ModelConfiguration`** (base, `packages/base/system-card.gts`): Simple card with `modelId`, `toolsSupported`, `reasoningEffort`, `inputModalities`
- **Extended `ModelConfiguration`** (catalog-realm, `packages/catalog-realm/system-card/model-configuration.gts`): Adds `name`, `contextLength`, `canonicalSlug`, badge fields
- **`RecommendedModel`** (catalog-realm, `packages/catalog-realm/system-card/recommended-model.gts`): Extends `ModelConfiguration`, adds `purpose`, `thinkingEffort`, `linksTo(ModelConfiguration)`
- **`OpenRouterModel`** (catalog-realm, `packages/catalog-realm/system-card/openrouter-model.gts`): Rich card type with all OpenRouter API fields (pricing, architecture, top_provider, per_request_limits, default_parameters, supported_parameters)
- **`ModelUpdater`** (catalog-realm, `packages/catalog-realm/system-card/model-updater.gts`): Manual UI-driven sync — fetches `https://openrouter.ai/api/v1/models`, writes `OpenRouterModel/*.json` files. Uses `SendRequestViaProxyCommand` + `WriteTextFileCommand`. Currently requires manual button-press in a browser.
- **~400 OpenRouterModel instances** already exist in `packages/catalog-realm/system-card/OpenRouterModel/`
- **22 ModelConfiguration instances** in `packages/catalog-realm/ModelConfiguration/` — manually maintained, with basic fields only
- **Default SystemCard** (`packages/catalog-realm/SystemCard/default.json`) — links to the 22 ModelConfigurations via relative URLs

### Data flow for model selection

```
SystemCard.modelConfigurations → UI LLM picker → sendActiveLLMEvent(roomId, model)
  → ActiveLLMEvent { model, toolsSupported, reasoningEffort, inputModalities }
    → ai-bot reads event → openai.chat.completions.stream({ model })
      → OpenRouter API
```

### Existing scheduling pattern

The **daily credit grant** cron (`packages/realm-server/lib/daily-credit-grant-config.ts`) provides the pattern:
- Uses `cron` npm package via `CronJob`
- Configurable schedule via env var (default `0 3 * * *`)
- Started in worker-manager after all workers are up
- Enqueues a job to the queue which a worker picks up

### Existing realm patterns

Realms are configured in startup scripts (`start-development.sh`, `start-staging.sh`, `start-production.sh`) with `--path`, `--username`, `--fromUrl`, `--toUrl` args. The `@cardstack/catalog/` prefix demonstrates how a virtual URL gets mapped to environment-specific actual URLs.

---

## Linear Issues (Current Sprint)

| ID | Title | Key Intent |
|----|-------|------------|
| **CS-10404** | Create a public readable realm for OpenRouterModels | New realm infrastructure |
| **CS-10367** | Create OpenRouterModel card type | Already exists — needs review/refinement |
| **CS-10366** | Collapse RecommendedModel and ModelConfiguration into ModelConfiguration | Refactor data model; add `linksTo(OpenRouterModel)` |
| **CS-10364** | Allow model list to include items with same model ID multiple times | Support e.g. high/low thinking variants of same model |
| **CS-9564** | Add a mechanism for syncing model config cards from OpenRouter | Core sync + scheduling |

### Later / Backlog

| ID | Title |
|----|-------|
| CS-10363 | Move `reasoningEffort` from ModelConfiguration to an enum field |
| CS-10370 | Add options at bottom of AI Assistant model list |
| CS-10369 | Add UI to SystemCard for easy copy |
| CS-10368 | Add UI to SystemCard re: active status |
| CS-9584 | Allow SystemCard to add/exclude from parent's model configs |
| CS-9400 | Allow ModelConfiguration to include temperature and other config |
| CS-9680 | Improve appearance of SystemCard and ModelConfiguration |

---

## Proposed Architecture

### 1. OpenRouter Models Realm (CS-10404)

Create a new realm that is **public-readable, not writable by users**, dedicated to housing OpenRouterModel instances. This realm exists in every environment.

#### Realm URL mapping

| Environment | Virtual Prefix | Actual URL |
|-------------|---------------|------------|
| Development | `@cardstack/openrouter/` | `http://localhost:4201/openrouter/` |
| Staging | `@cardstack/openrouter/` | `https://realms-staging.stack.cards/openrouter/` |
| Production | `@cardstack/openrouter/` | `https://app.boxel.ai/openrouter/` |

#### Implementation steps

1. **Create `packages/openrouter-realm/` directory** with:
   - `.realm.json` — metadata (name: "OpenRouter Models", icon, etc.)
   - The `OpenRouterModel` card type definition (moved from catalog-realm) at `system-card/openrouter-model.gts`
   - A `ModelUpdater` singleton instance (optional — could stay in catalog)

2. **Add to startup scripts:**
   - `start-development.sh`: Add `--path='../openrouter-realm' --username='openrouter_realm' --fromUrl='@cardstack/openrouter/' --toUrl="${REALM_BASE_URL}/openrouter/"`
   - `start-staging.sh`: Same pattern with staging URL
   - `start-production.sh`: Same pattern with production URL

3. **Add host config mappings:**
   - `packages/host/config/environment.js`: Add `resolvedOpenRouterRealmURL` (env var `RESOLVED_OPENROUTER_REALM_URL`, default `http://localhost:4201/openrouter/`)
   - `packages/host/config/staging.env`: Add `RESOLVED_OPENROUTER_REALM_URL=https://realms-staging.stack.cards/openrouter/`
   - `packages/host/config/production.env`: Add `RESOLVED_OPENROUTER_REALM_URL=https://app.boxel.ai/openrouter/`

4. **Register URL prefix in network service:**
   - `packages/host/app/services/network.ts`: Register `@cardstack/openrouter/` similar to `@cardstack/catalog/`

5. **Add realm permissions:**
   - Database migration: public read (`username='*', read=true`), write only for `openrouter_realm` user
   - This ensures the realm is world-readable but only the sync process can write

6. **Add setup scripts** for deployment (similar to `setup:catalog-in-deployment`):
   - `pnpm setup:openrouter-in-deployment`

#### Decision: Separate realm vs. subdirectory of catalog

**Recommendation: Separate realm.** Rationale:
- Clear separation of concerns — catalog is curated content; openrouter-realm is API-synced data
- Different write permissions — catalog is edited by humans; openrouter-realm is written by automation
- Independent deployment lifecycle
- Clean URL namespace for `linksTo` references from ModelConfiguration

#### Alternative considered: Store in catalog realm

Pro: Simpler infrastructure. Con: Mixes curated and auto-generated content; harder to manage permissions; OpenRouterModel instances already at `system-card/OpenRouterModel/` path which is awkward.

---

### 2. OpenRouterModel Card Type (CS-10367)

The `OpenRouterModel` card type already exists at `packages/catalog-realm/system-card/openrouter-model.gts`. It needs to be:

1. **Moved** to `packages/openrouter-realm/openrouter-model.gts` (or kept in a shared location if catalog needs to import it)
2. **Reviewed** for completeness against current OpenRouter API response
3. **Ensure `adoptsFrom`** references use `@cardstack/openrouter/` prefix so they resolve correctly in all environments

The current type includes: `modelId`, `canonicalSlug`, `name`, `created`, `cardDescription`, `contextLength`, `pricing` (compound), `architecture` (compound with modalities), `topProvider` (compound), `perRequestLimits` (compound), `supportedParameters` (array), `defaultParameters` (compound).

**Open question:** Should the base `ModelConfiguration` definition move to the base realm, or should it remain where it is? It's already in base (`packages/base/system-card.gts`), which is correct.

#### New fields to add

The OpenRouter API also returns fields not yet captured:
- `expiration_date` — when a model will be deactivated (nullable)
- `pricing.web_search` — per-web-search cost (string, e.g. `"0.01"`)
- `deprecated` — boolean, added by our sync to mark models no longer in the API
- `lastSeenInApi` — number (epoch seconds), updated each sync run

#### Format Templates — Inspired by openrouter.ai model pages

The existing templates have a solid foundation but should be redesigned to better mirror the information hierarchy on https://openrouter.ai/openai/gpt-5.4-pro. Key design reference points from that page:

**Isolated format** (full page view):

```
┌─────────────────────────────────────────────────────────────┐
│  [Provider: Model Name]                    ← large heading  │
│  openai/gpt-5.4-pro  [copy]               ← mono code badge│
│                                                              │
│  Released Mar 5, 2026 │ 1,050,000 context │ $30/M input │   │
│  $180/M output │ $10/K web search         ← inline stats    │
│                                                              │
│  Input: text, image, file  Output: text   ← modality pills  │
│                                                              │
│  Description text with expandable show more/less...          │
├──────────────────────────────────────────────────────────────┤
│  MODEL DETAILS                                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                   │
│  │ Context  │  │ Modality │  │Tokenizer │  ← stat cards     │
│  │1,050,000 │  │text+img→ │  │  GPT     │                   │
│  └──────────┘  └──────────┘  └──────────┘                   │
├──────────────────────────────────────────────────────────────┤
│  PRICING                                                     │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                │
│  │ Input  │ │ Output │ │Request │ │  Image │  ← grid cells  │
│  │ $30.00 │ │$180.00 │ │   —    │ │   —    │                │
│  │ /1M tok│ │ /1M tok│ │/request│ │/image  │                │
│  └────────┘ └────────┘ └────────┘ └────────┘                │
├──────────────────────────────────────────────────────────────┤
│  PROVIDER LIMITS                                             │
│  Max Input: 922,000 tokens   Max Output: 128,000 tokens      │
│  Moderated: Yes                                              │
├──────────────────────────────────────────────────────────────┤
│  SUPPORTED PARAMETERS                                        │
│  [tools] [reasoning] [structured_outputs] [stop] [seed] ...  │
│                                            ← pill badges     │
├──────────────────────────────────────────────────────────────┤
│  DEFAULT PARAMETERS                                          │
│  temperature ........................... —                    │
│  top_p ................................. —  ← key-value table │
│  frequency_penalty ..................... —                    │
└──────────────────────────────────────────────────────────────┘
```

**Changes from current isolated template:**
- Remove the large OpenRouter SVG logo from the hero — replace with a subtle "OPENROUTER MODEL" type badge (like the embedded format already has)
- Move pricing into the inline stats strip alongside context and date (matching openrouter.ai's horizontal stat layout)
- Add modality indicators as small pills below the stats strip (e.g. `text` `image` `file` → `text`)
- Rename "Request Limits" section to "Provider Limits" and add the `isModerated` indicator
- Add web search pricing when available
- Remove non-functional tab navigation (Overview/Performance/Parameters tabs that don't do anything)
- Use CSS custom properties (`var(--boxel-*)`) instead of hardcoded hex colors, for theme compatibility

**Embedded format** (card-in-card view):

```
┌──────────────────────────────────────┐
│  OPENROUTER MODEL                    │  ← type badge with logo
│  OpenAI: GPT-5.4 Pro                │  ← title
│  openai/gpt-5.4-pro                 │  ← mono subtitle
│                                      │
│  Description text truncated to 3     │
│  lines with ellipsis overflow...     │
│                                      │
│  Context   Modality                  │
│  1.1M      text+image→text           │  ← 2-col stats
│                                      │
│  Input     Output                    │
│  $30/M     $180/M                    │  ← pricing in green
└──────────────────────────────────────┘
```

**Changes from current embedded template:** Minimal — the existing embedded is already well-designed. Add modality display and ensure pricing shows web search cost when present.

**Fitted format** (responsive container-query based):

The fitted format uses 4 breakpoints via CSS container queries. Key changes:

- **Badge format** (≤150px, <170px): Keep as-is — just the OpenRouter logo icon
- **Strip format** (>150px, <170px): Add pricing to the meta row: `openai/gpt-5.4-pro · 1.1M · $30/$180`
- **Tile format** (<400px, ≥170px): Add a second line showing pricing: `$30/M in · $180/M out`. Add modality pills if space allows.
- **Card format** (≥400px, ≥170px): Show description (2-line clamp), pricing, context, and modality indicators

**General style guidelines:**
- Use Boxel CSS custom properties (`var(--boxel-dark)`, `var(--boxel-light)`, etc.) for colors instead of hardcoded values, enabling dark mode support
- Use the existing `@cardstack/boxel-ui` component library where appropriate
- Pricing in green (`var(--boxel-teal)` or similar) to match the existing embedded format
- Monospace font for model IDs
- Consistent number formatting: context as "1.1M" or "200K" in compact formats, "1,050,000" in isolated

---

### 3. Refactor ModelConfiguration with `linksTo(OpenRouterModel)` (CS-10366)

**Goal:** ModelConfiguration should derive its core data from an OpenRouterModel link rather than duplicating it.

#### Current class hierarchy
```
CardDef
  └─ ModelConfiguration (base)         — modelId, toolsSupported, reasoningEffort, inputModalities
       └─ ModelConfiguration (catalog)  — +name, contextLength, canonicalSlug, badges
            ├─ RecommendedModel         — +purpose, thinkingEffort, linksTo(ModelConfiguration)
            └─ OpenRouterModel          — +pricing, architecture, topProvider, etc.
```

#### Proposed class hierarchy
```
CardDef
  └─ OpenRouterModel (openrouter-realm) — all OpenRouter API fields
  └─ ModelConfiguration (base)          — modelId, toolsSupported, reasoningEffort, inputModalities
       └─ ModelConfiguration (catalog)  — linksTo(OpenRouterModel), +purpose, +thinkingEffort, badges
                                          modelId/name/contextLength computed from linked OpenRouterModel
```

**Key changes:**
- `RecommendedModel` is **collapsed into** the catalog-realm `ModelConfiguration`
  - Its `purpose`, `thinkingEffort` fields move to ModelConfiguration
  - Its `linksTo(ModelConfiguration)` becomes `linksTo(OpenRouterModel)` — pointing to the openrouter-realm
- The catalog ModelConfiguration **derives** `modelId`, `name`, `contextLength`, `inputModalities` from the linked `OpenRouterModel`
- `toolsSupported` and `reasoningEffort` remain as overridable fields on ModelConfiguration (since these are configuration choices, not inherent model properties)
- Existing `RecommendedModel` instances are migrated to `ModelConfiguration` instances

#### Supporting CS-10364: Same model ID, multiple configurations

With this structure, you can have multiple `ModelConfiguration` instances linking to the same `OpenRouterModel` but with different `thinkingEffort` or `purpose` values. Each gets a distinct card ID and can appear separately in the SystemCard's `modelConfigurations` list.

Example:
- `ModelConfiguration/claude-sonnet-46` → links to `OpenRouterModel/anthropic-claude-sonnet-4.6`, thinkingEffort=none
- `ModelConfiguration/claude-sonnet-46-thinking` → links to same `OpenRouterModel`, thinkingEffort=high

---

### 4. Automated Sync Command (CS-9564)

#### 4a. The Sync Command itself

Refactor the existing `ModelUpdater` into a **Boxel Command** that can be invoked programmatically (not just via UI button press).

**File:** `packages/catalog-realm/commands/sync-openrouter-models.gts` (or in the host commands)

**Logic (adapted from existing ModelUpdater):**
1. Fetch `https://openrouter.ai/api/v1/models` via `SendRequestViaProxyCommand`
2. For each model in the response:
   - Generate a deterministic slug from the model ID
   - Build the `OpenRouterModel` card JSON
   - Write to `OpenRouterModel/{slug}.json` in the openrouter-realm via `WriteTextFileCommand`
   - Overwrite existing files (the current code skips on "file already exists" — change to always overwrite for true sync)
3. Optionally: detect and remove models that are no longer in the API response (soft delete or mark inactive)
4. Report results (count processed, errors)

**Key improvements over current ModelUpdater:**
- **Batch writes via `POST /_atomic`:** Write models in batches of ~50 instead of 400+ individual requests
- **Idempotent updates:** Query existing models first, use `op: "add"` for new and `op: "update"` for existing
- **Deprecation tracking:** Models no longer in API response get `deprecated: true` and `lastSeenInApi` timestamp
- **Deterministic slugs:** Use `modelId.replace(/\//g, '-')` consistently
- **No UI dependency:** Pure command, can run headless
- **Error resilience:** Continue on batch failures, report summary

#### 4b. Scheduling via Cron in Worker Manager

Follow the daily-credit-grant pattern:

**New file:** `packages/realm-server/lib/openrouter-sync-config.ts`
```typescript
import { CronJob } from 'cron';

export const OPENROUTER_SYNC_CRON_SCHEDULE =
  process.env.OPENROUTER_SYNC_CRON_SCHEDULE ?? '0 4 * * *'; // 4am daily
export const OPENROUTER_SYNC_CRON_TZ =
  process.env.OPENROUTER_SYNC_CRON_TZ ?? 'America/New_York';
```

**In worker-manager.ts:**
- After workers start, create and start the cron job
- On tick, enqueue a `run-command` job targeting the sync command
- The job flows through the existing pipeline: worker → prerender → headless Chrome → command execution

**Job args:**
```typescript
{
  realmURL: OPENROUTER_REALM_URL,        // e.g. https://app.boxel.ai/openrouter/
  realmUsername: 'openrouter_realm',       // the realm's matrix user
  runAs: '@openrouter_realm:boxel.ai',    // matrix user ID with write access
  command: '@cardstack/openrouter/commands/sync-models/default',
  commandInput: {}
}
```

**Environment variables needed:**
- `OPENROUTER_SYNC_CRON_SCHEDULE` — cron expression (default: `0 4 * * *`)
- `OPENROUTER_SYNC_CRON_TZ` — timezone (default: `America/New_York`)
- `OPENROUTER_REALM_URL` — the realm URL to write to (derived from environment)

**Note:** The OpenRouter `/api/v1/models` endpoint is **public** — no API key required. No secrets management needed for the sync.

#### 4c. Timeout considerations

The current `RUN_COMMAND_JOB_TIMEOUT_SEC` is 60 seconds. With batch writes (~8 batches of 50 for 400 models), this should be significantly faster than 400 individual writes. Still, use a dedicated timeout of **300 seconds** for the sync job to be safe. Add change detection (compare API response hash to existing card data, only write batches with changes) to minimize unnecessary writes.

---

### 5. Migration Plan

#### Phase 1: Infrastructure (CS-10404, CS-10367)
1. Create `packages/openrouter-realm/` with `.realm.json`, type definitions
2. Move `OpenRouterModel` type to the new realm (or share via base)
3. Add realm to all startup scripts (dev, staging, production)
4. Add host config and network service mappings
5. Add database migration for realm permissions
6. Deploy — realm exists but is empty initially

#### Phase 2: Sync Command (CS-9564)
1. Create the sync command (adapted from ModelUpdater)
2. Add cron config and scheduling in worker-manager
3. Test sync locally — run manually first, verify model cards appear
4. Deploy — models get synced automatically on schedule

#### Phase 3: Data Model Refactor (CS-10366, CS-10364, CS-10363)
1. Add `linksTo(OpenRouterModel)` to catalog-realm ModelConfiguration
2. Collapse RecommendedModel fields into ModelConfiguration
3. Move `reasoningEffort` to the right place (CS-10363)
4. Migrate existing ModelConfiguration instances to link to OpenRouterModel cards
5. Migrate existing RecommendedModel instances to ModelConfiguration
6. Update SystemCard/default.json to reference the new ModelConfiguration instances
7. Ensure the UI model picker still works correctly

#### Phase 4: Cleanup
1. Remove the old manual `ModelUpdater` card (or keep as fallback)
2. Remove redundant `RecommendedModel` type
3. Remove standalone `OpenRouterModel` instances from catalog-realm (they now live in openrouter-realm)
4. Update any tests

---

## Decisions

### 1. OpenRouterModel type definition location
**Decision: In the openrouter-realm.** Type and instances co-located. Module ref: `@cardstack/openrouter/openrouter-model`. The catalog-realm's ModelConfiguration imports it via:
```typescript
import { OpenRouterModel } from '@cardstack/openrouter/openrouter-model';
@field openRouterModel = linksTo(OpenRouterModel);
```

### 2. Sync command location
**Decision: In the openrouter-realm** at `@cardstack/openrouter/commands/sync-models`. It's the realm's own maintenance command.

### 3. Batch writes via `POST /_atomic`
**Decision: Use the existing realm batch write API.** The realm server exposes `POST /_atomic` which accepts multiple operations atomically:
```json
{
  "atomic:operations": [
    {
      "op": "add" | "update",
      "href": "OpenRouterModel/anthropic-claude-sonnet-46.json",
      "data": {
        "type": "card",
        "attributes": { ... },
        "meta": { "adoptsFrom": { "module": "./openrouter-model", "name": "OpenRouterModel" } }
      }
    }
  ]
}
```
**Constraint:** `add` returns 409 if file exists; `update` returns 404 if not. The sync command should:
1. First query existing OpenRouterModel cards to determine which exist
2. Use `op: "update"` for existing models and `op: "add"` for new ones
3. Batch in groups of ~50 to keep request sizes manageable

### 4. Model removal handling
**Decision: Mark as deprecated.** Add `deprecated` boolean and `lastSeenInApi` timestamp fields to `OpenRouterModel`. The sync marks models absent from the API response as deprecated rather than deleting them. This preserves `linksTo` references.

### 5. OpenRouter API key
**Decision: Skip it.** The `/api/v1/models` endpoint is public and the sync runs once daily, so rate limits aren't a concern.

### 6. Matrix username
**Decision: `openrouter_realm`.** Ensure the Matrix user is created during deployment setup (same pattern as other realm users).

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Sync job fails silently | Log errors, add monitoring/alerting on the cron job. Report status in a card field. |
| OpenRouter API changes format | Schema validation on response. Fail gracefully on unknown fields. |
| 400+ model writes overwhelm realm server | Batch writes via `POST /_atomic` (~50 per batch). Change detection to skip unchanged models. |
| Breaking linksTo references during migration | Phase the migration. Keep old ModelConfiguration instances working until all references are updated. |
| Headless Chrome timeout on large sync | Increase job timeout to 300s. Add progress tracking. |
| Development startup slows with new realm | The realm starts empty locally; sync populates it on demand or via cron. Can SKIP with env var. |

---

## Files to Create/Modify

### New files
- `packages/openrouter-realm/.realm.json`
- `packages/openrouter-realm/openrouter-model.gts` (moved from catalog-realm)
- `packages/openrouter-realm/commands/sync-models.gts`
- `packages/openrouter-realm/package.json`
- `packages/realm-server/lib/openrouter-sync-config.ts`
- DB migration for openrouter-realm permissions

### Modified files
- `packages/realm-server/scripts/start-development.sh` — add openrouter-realm
- `packages/realm-server/scripts/start-staging.sh` — add openrouter-realm
- `packages/realm-server/scripts/start-production.sh` — add openrouter-realm
- `packages/host/config/environment.js` — add `resolvedOpenRouterRealmURL`
- `packages/host/config/staging.env` — add `RESOLVED_OPENROUTER_REALM_URL`
- `packages/host/config/production.env` — add `RESOLVED_OPENROUTER_REALM_URL`
- `packages/host/app/services/network.ts` — register `@cardstack/openrouter/` prefix
- `packages/realm-server/worker-manager.ts` — add openrouter sync cron
- `packages/realm-server/main.ts` — add `@cardstack/openrouter/` prefix mapping
- `packages/catalog-realm/system-card/model-configuration.gts` — add `linksTo(OpenRouterModel)`, merge RecommendedModel fields
- `packages/base/system-card.gts` — possibly add `inputModalities` if not already there (it is)
- `packages/catalog-realm/SystemCard/default.json` — update ModelConfiguration references
- `packages/catalog-realm/ModelConfiguration/*.json` — add `linksTo` OpenRouterModel relationships

### Files to remove (Phase 4)
- `packages/catalog-realm/system-card/recommended-model.gts`
- `packages/catalog-realm/system-card/OpenRouterModel/` (instances move to openrouter-realm)
- `packages/catalog-realm/system-card/model-updater.gts` (replaced by command)
