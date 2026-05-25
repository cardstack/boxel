# CS-11249 — T1: Realm-independent fallback model constant + host wire/picker integration

## Context

Today, capability data (`toolsSupported`, `supportsReasoning`, `inputModalities`) flows from `SystemCard.modelConfigurations` → `matrix-service.sendActiveLLMEvent` → matrix wire event → ai-bot. Any missing link collapses caps to `undefined`, which is `=== true` failing in the ai-bot, so tools are silently stripped. The realm-independent fallback constant introduced here closes the host-side leg of that bug for the 6 curated models.

This is the foundation ticket for the "Add Fallback System Card/config that is not realm-dependent" project. It absorbs the originally-separate T4 (sender) and T6 (picker) so the silent-tools-off fix lands end-to-end in one PR with a host integration test. T3 and T2 are cancelled (see comments on CS-11250 and CS-11256). T2/T3/T4 (ai-bot, banner, cleanup) follow.

## Changes

1. **`packages/runtime-common/matrix-constants.ts`** — append `FallbackModelConfig` interface, `DEFAULT_FALLBACK_MODELS` (6 rows), `DEFAULT_FALLBACK_MODEL_ID`. Existing `DEFAULT_LLM*` untouched (T4 retires them).
2. **`packages/host/app/services/matrix-service.ts`** — `sendActiveLLMEvent` fills any still-undefined `toolsSupported` / `inputModalities` from `DEFAULT_FALLBACK_MODELS.find(...)`. Explicit `false` from the caller is preserved (`??` not `||`). `reasoningEffort` is **not** filled (user choice).
3. **`packages/host/app/components/matrix/room.gts`** — picker's fallback branch (when `systemCard.modelConfigurations` is missing) iterates `DEFAULT_FALLBACK_MODELS` instead of the legacy 22-entry `DEFAULT_LLM_LIST` + `DEFAULT_LLM_ID_TO_NAME`. Prior-used non-curated models stay selectable via the existing `usedLLMs` merge.
4. **Tests:**
   - `packages/runtime-common/tests/fallback-models-test.ts` + `packages/realm-server/tests/fallback-models-test.ts` — shared-tests pattern, 5 assertions on the constant's shape (count, no duplicates, default member, typed fields, no extras). Locally green.
   - `packages/host/tests/integration/components/ai-assistant-panel/fallback-models-test.gts` — 4 scenarios: (a) curated caps fill-in when no SystemCard, (b) non-curated → undefined caps (constant doesn't cover), (c) explicit `toolsSupported: false` is preserved, (d) picker renders all 6 displayNames. Verified locally to lint clean; full run gated on CI (local run needs mkcert + realm-server stack which isn't set up on this machine).
5. **`docs/openrouter-fallback-refresh.md`** — short refresh procedure documenting how to re-derive `DEFAULT_FALLBACK_MODELS` from `https://openrouter.ai/api/v1/models` when the curated set changes.

## Capability source

All 6 curated rows derived live from `https://openrouter.ai/api/v1/models` on 2026-05-25:

| modelId | tools | reasoning | inputModalities |
|---|---|---|---|
| `anthropic/claude-sonnet-4.6` (default) | ✓ | ✓ | text, image, file |
| `anthropic/claude-opus-4.7` | ✓ | ✓ | text, image, file |
| `google/gemini-3-flash-preview` | ✓ | ✓ | text, image, file, audio, video |
| `google/gemini-3.1-pro-preview` | ✓ | ✓ | audio, file, image, text, video |
| `openai/gpt-5.4` | ✓ | ✓ | text, image, file |
| `openai/gpt-5.5` | ✓ | ✓ | file, image, text |

Derivation rules (mirror `packages/host/app/commands/sync-openrouter-models.ts:67-141`):
- `toolsSupported = supportedParameters.includes('tools')`
- `supportsReasoning = supportedParameters.includes('reasoning')`
- `inputModalities = architecture.input_modalities` (order preserved)
- `displayName = model.name`

## Verification

- `cd packages/realm-server && TEST_FILES=fallback-models-test pnpm test` — 5/5 unit tests pass.
- `cd packages/host && pnpm lint:js` — clean.
- `cd packages/realm-server && pnpm lint:js` — clean.
- `cd packages/runtime-common && pnpm lint:js` — clean (lint:types fails locally due to pre-existing unrelated TS errors in `base/`; CI runs glint in a properly built workspace).
- Host integration test verification deferred to CI — see Tests note above.

## Out of scope (follow-up tickets)

- **T2 (CS-11252):** ai-bot side. `ai-bot/main.ts` + `runtime-common/ai/prompt.ts` fill caps from `DEFAULT_FALLBACK_MODELS` when matrix events arrive with undefined fields. Defense-in-depth for pre-existing rooms.
- **T3 (CS-11254):** `isUsingFallbackSystemCard` + dismissible banner. Independent — can start in parallel.
- **T4 (CS-11255):** Retire `DEFAULT_LLM` / `_LIST` / `_ID_TO_NAME` and migrate 7 known call sites + `base/llm-model.gts`'s `LLM_MODEL_OPTIONS`.

This plan doc is scratch and will be removed before merge.
