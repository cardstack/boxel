# CS-11252 — ai-bot fills capability fields from fallback constant

> Scratch planning doc. Deleted before this PR merges.

## Context

T1 ([CS-11249](https://linear.app/cardstack/issue/CS-11249), merged on main) shipped `DEFAULT_FALLBACK_MODELS` and `DEFAULT_FALLBACK_MODEL_ID` in `packages/runtime-common/matrix-constants.ts` and wired the host side (matrix-service + picker) to fill capability fields from the constant when the realm-side SystemCard misses.

The remaining hole is the ai-bot side. Pre-existing rooms have `APP_BOXEL_ACTIVE_LLM` events from before capability fields existed on the schema: `toolsSupported` and `inputModalities` are `undefined` on the event payload. `packages/ai-bot/main.ts:150-157` strictly gates tools on `prompt.toolsSupported === true`, so for those rooms the bot silently strips tools — even when the active model is one of the curated 6 that fully supports tools.

This ticket closes that path: when capability fields are missing on the event, fill them from `DEFAULT_FALLBACK_MODELS` keyed by the event's `model`. Explicit `false` on the event is respected (no fill). Non-curated models (not in the constant) keep today's behavior. AC: replaying a pre-change room with a curated model produces an OpenAI request that includes tools.

## Approach

**Single fill point: `getActiveLLMDetails` in `packages/runtime-common/ai/prompt.ts:2241-2266`.** Its output already flows into `PromptParts.toolsSupported` / `inputModalities` (assembled at `prompt.ts:232-250`), which is exactly what `ai-bot/main.ts:150` reads. Filling at the source means the bot's gate is unchanged — the value reaching it is just correctly populated.

### Files to change

**`packages/runtime-common/ai/prompt.ts:2241-2266`** — rewrite `getActiveLLMDetails`:

- Import `DEFAULT_FALLBACK_MODELS` and `DEFAULT_FALLBACK_MODEL_ID` from `./matrix-constants`.
- **No `APP_BOXEL_ACTIVE_LLM` event in history**: use `DEFAULT_FALLBACK_MODEL_ID` as `model`, fill caps from that row.
- **Event present**:
  - `model` = `activeLLMEvent.content.model`.
  - `reasoningEffort` = normalize from event (not filled from constant — user choice).
  - For `toolsSupported` and `inputModalities`: if event value is **strictly `undefined`**, look up `DEFAULT_FALLBACK_MODELS.find((m) => m.modelId === model)` and take the row's value. Missed lookup (non-curated model) → leave `undefined`. Any other value (including `false`) → pass through.

### Files NOT modified

- `packages/ai-bot/main.ts` — strict `=== true` gate stays; fix is upstream.

### Tests

New `module('CS-11252 fill missing caps from fallback constant', …)` in `packages/ai-bot/tests/prompt-construction-test.ts`, inline-eventList style. Five cases mirroring the AC matrix.

## Verification

- ai-bot prompt-construction module passes; existing `set model in prompt` module unchanged.
- `pnpm lint` clean in `runtime-common` and `ai-bot`.
