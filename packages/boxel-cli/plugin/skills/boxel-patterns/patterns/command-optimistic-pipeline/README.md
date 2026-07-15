---
validated: source-proven
---

# command-optimistic-pipeline - Observable pipeline with optimistic card saves

**What this gives you:** A user-facing workflow that feels fast while still leaving a durable, queryable run card with steps, logs, progress, errors, and final outputs.

**When to use:** Multi-step actions that mix card writes with slow work: LLM calls, image generation, imports, migrations, bulk edits, diagnostics, or any workflow that would feel bad if every progress write waited for realm indexing.

**The insight:** The card instance is live in the browser store before the realm finishes indexing it. Create a typed run card, mutate that same instance as the workflow advances, and fire `SaveCardCommand` without awaiting each progress write. Await only real dependency boundaries: the first save when you need the persistent URL immediately, the external API call that returns bytes/text, a binary upload, and a final `settle()` that reports late save failures.

**Recipe shape:**

1. Model the run as a real CardDef: `status`, `progressCurrent`, `progressTotal`, `currentStepIndex`, `steps`, `logs`, `startedAt`, `completedAt`, and output fields.
2. In the invoking component, get `this.args.context?.commandContext` and the current card realm via `realmURL`.
3. Wrap `SaveCardCommand` in a small `OptimisticSave` helper that stores pending promises and exposes `save(card, realm)` plus `settle()`.
4. Create one run card per invocation. Save it once, then mutate the same instance for each phase.
5. Reassign `containsMany` arrays when changing nested steps/logs so tracking sees the structural change.
6. Await slow external work. Do not await cosmetic progress saves.
7. On success or failure, mutate the run card to a terminal state and fire one final save.
8. Call `settle()` after the UI has already completed so late persistence failures are logged, not hidden.

**Gotchas:**

- If later updates require the run card URL immediately, await the first save. If the UI can wait for the URL to arrive reactively, the first save can be queued and the `.id` can be captured from the save promise.
- Keep one logical run in one card unless child cards have their own lifecycle. This avoids a swarm of intermediate cards and keeps search/query output compact.
- Use host commands for normal IO. Direct `fetch` is only acceptable for a documented host-command gap, such as the sticky-bat binary upload workaround.
- For LLM/image APIs, snapshot the prompt, model id, source card URL, finish reason, and latency on the run card. The run card is the audit trail.
- For image output, persist bytes to a FileDef/ImageDef URL when possible. Do not store large base64 data URLs in normal JSON fields except as a temporary on-screen preview.

**Source:** Distilled from a `sticky-bat` realm's command pipeline (`optimistic-save.gts`, `demo-pipeline.gts`, `image-gen.gts`, `bench.gts`). Ask the user for the current URL if you want to read the original.

**See also:** `command-typed-with-progress`, `integrate-one-shot-llm`, `integrate-send-request-via-proxy`, `boxel/references/command-development.md`.
