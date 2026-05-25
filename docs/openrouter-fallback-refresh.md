# Refreshing `DEFAULT_FALLBACK_MODELS`

`DEFAULT_FALLBACK_MODELS` in `packages/runtime-common/matrix-constants.ts` is the realm-independent capability table for the curated set of LLMs the AI assistant can always fall back to (silent-tools-off prevention — see CS-11249). It is hand-maintained until/unless a live OpenRouter snapshot endpoint is wired up.

Refresh whenever the curated set of models changes, when a model's OpenRouter `supported_parameters` shape changes, or as part of a periodic audit (recommended quarterly).

## Procedure

1. Fetch the live model list:

   ```sh
   curl -s https://openrouter.ai/api/v1/models -o /tmp/openrouter-models.json
   ```

2. For each row in `DEFAULT_FALLBACK_MODELS`, look up the OpenRouter entry and re-derive the four data-bearing fields:

   ```sh
   MODEL_ID='anthropic/claude-sonnet-4.6'
   jq --arg id "$MODEL_ID" '
     .data[]
     | select(.id == $id)
     | {
         id,
         name,
         supported_parameters,
         input_modalities: .architecture.input_modalities
       }
   ' /tmp/openrouter-models.json
   ```

3. Derive each `FallbackModelConfig` field (mirroring `packages/host/app/commands/sync-openrouter-models.ts:67-141`):

   | Field | Derivation |
   |---|---|
   | `modelId` | OpenRouter `id` |
   | `displayName` | OpenRouter `name` |
   | `toolsSupported` | `supported_parameters.includes('tools')` |
   | `supportsReasoning` | `supported_parameters.includes('reasoning')` |
   | `inputModalities` | `architecture.input_modalities` (copy verbatim — order preserved) |

4. Paste the new rows into `DEFAULT_FALLBACK_MODELS`. Keep the curated set small (one row per model the assistant is allowed to silently fall back to). If you're adding a brand new model, also update `DEFAULT_FALLBACK_MODEL_ID` if the default should change.

5. Run the unit tests to catch shape regressions:

   ```sh
   cd packages/realm-server
   TEST_FILES=fallback-models-test pnpm test
   ```

6. If a curated model is not present on OpenRouter at refresh time (model retired, preview not yet shipped), decide per-row:

   - **Omit** — drop the row from `DEFAULT_FALLBACK_MODELS`. The picker will hide it; existing rooms keep working because their stored `model` id stays selectable via `usedLLMs`.
   - **Hand-write** — keep the row with educated-guess caps. Add a `// TODO(openrouter-missing): re-derive when published` comment so the next refresh re-checks.

## Why hand-maintained, not synced

The realm-served OpenRouter sync (see `packages/host/app/commands/sync-openrouter-models.ts`) writes cards into a realm, which the AI assistant only sees when the SystemCard chain is healthy. The whole point of `DEFAULT_FALLBACK_MODELS` is to work when that chain is broken — so it has to be statically bundled with the host. A periodic refresh PR is the cost of that guarantee.

If the project ever revives the deferred T2 ticket (live snapshot endpoint + IndexedDB cache), this doc and its constant will be retired in favor of a generated artifact.
