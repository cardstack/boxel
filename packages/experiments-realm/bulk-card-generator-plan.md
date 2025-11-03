# Bulk Card Generator Card

This plan covers the iterative bulk card generator that loops `GenerateExampleCardsOneShotCommand` to create multiple card instances. It builds on the existing `bulk-card-generator.gts` layout while clarifying the iterative-only workflow (no `_atomic` endpoint usage).

## Purpose

- Provide an in-app experience for generating multiple card instances from a chosen definition.
- Maintain predictable indexing by reusing the one-shot command for each generated card.
- Offer future flexibility to reintroduce additional modes (e.g., atomic batching) without committing to them now.

## UI Surface

- Fields: `targetRealmUrl`, `codeRef`, `localDir`, optional `llmModel`, `prompt`, a `csv` StringField that holds optional CSV content (manually pasted or populated via a lightweight upload helper), and an `exampleCard` linksTo relationship so the operator can pick an existing instance as reference material.
- Read-only indicator describing the current mode (“Iterative One-Shot”).
- Status banner reflecting progress through stages (`idle`, `requesting-payload`, `writing-cards`, `completed`, `error`).
- Progress table/list that mirrors the CSV rows (or single default entry) and shows per-item status (`pending`, `in-progress`, `completed`, `failed`) with visual ticks.
- Persist progress state within the card instance itself—e.g., `containsMany` of progress entries derived from the CSV rows, each including a `linksTo` reference to the generated card when available—so state survives refresh and is shareable across sessions.
- “Existing Cards” section with pagination that highlights newly generated cards, scoped to the selected `codeRef` and sorted by `createdAt` (most recent first).

## Workflow

1. Validate inputs before enabling the Generate button (realm, code ref, localDir).
2. On submit, reset state, mark `isGenerating`, and set status to `requesting-payload`.
   - If a CSV is supplied, read it client-side, parse rows/headers (reuse the parsing helpers from `catalog-realm/spreadsheet/spreadsheet.gts`, such as `detectDelimiter`, normalization logic, etc.), and synthesize a summary string suitable for prompt inclusion.
3. Sync the `containsMany` progress relationship to the current CSV rows (creating one entry per row, or a single default entry when no CSV is present) before kicking off generation; each entry should carry row metadata plus a `resultCard` linksTo slot (initially empty).
4. Derive the set of generation iterations from the CSV content (one row per iteration) or default to a single iteration when no CSV is present:
   - Prepare per-entry async tasks that update the progress table entry to `in-progress`, then `completed`/`failed` as they finish (mutating the `containsMany` relationship, setting the `resultCard` link when a card is created, and saving when appropriate).
   - Compose iteration-specific prompts (including iteration index, when applicable, and uniqueness reminders) and incorporate serialized data from the selected `exampleCard`, when provided.
   - Trigger all `GenerateExampleCardsOneShotCommand` calls together with `Promise.allSettled`, updating each entry’s status as soon as its promise resolves.
5. After all tasks settle, mark overall status `completed`, surface generated IDs, persist the final relationship state, and ensure failed entries report errors alongside their table rows.

## Prompt Strategy

- Base system prompt from the one-shot command.
- User prompt combines form input plus iteration metadata (e.g., “item 3 of 5”), the synthesized CSV summary (when provided), and optionally references prior results or serialized details from the linked `exampleCard` to drive variety.

## Command Integration

- Instantiate `GenerateExampleCardsOneShotCommand` with the card’s `commandContext`.
- Pass per-iteration inputs (`codeRef`, `targetRealmUrl`, optional `llmModel`, `localDir`, `exampleCard` when selected).
- Handle command errors per iteration; decide whether to skip or abort (default: skip and log, then summarize).

## Result Display

- Track generated IDs in a list, render below the action button, and highlight within the recent-cards component via existing normalization logic.
- Render the per-iteration progress table with checkmarks or error badges so operators can see which CSV rows completed, are pending, or failed (include retry affordance if feasible later) and show links to the produced cards via the `resultCard` references.
- Persist the progress dataset to a `containsMany` field so the card reloads with historical status and can drive a “resume” affordance based on stored entries.
- Preserve pagination and total-count tracking for the “Existing Cards” section, refreshing the scoped search (sorted by `createdAt`) so newly generated cards appear without manual reload.

## Error Handling

- Catch and log failures during each iteration.
- Surface concise error messages in the status banner; keep UI responsive even when one iteration fails.

## State & Telemetry

- Maintain progress steps to give operators visibility into request/creation phases.
- Optionally capture iteration durations or indexing latency for future analysis (not required initially).

## Future Enhancements

- Reintroduce alternate modes (e.g., atomic batching) once ready.
- Support parallel LLM requests for faster throughput.
- Add prompt templates or saved configurations for repeat runs.
