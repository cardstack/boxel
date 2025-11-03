# Store Atomic Write API Plan

## Goal
Design a lightweight store extension (e.g. `store.addMany`) that can submit multiple card mutations in one request via the realm server’s `_atomic` endpoint (or a future bulk write API). The new method should hand back the created/updated instances while letting all existing store behavior (auto-save, GC, single-card `save`) remain untouched.

## Guiding Principles
- **Compatibility first**: Keep the public store surface area stable (`store.save`, auto-save) so current callers continue working.
- **Opt-in batching**: Allow commands to enqueue multiple operations and flush them atomically. Single-card saves can still fall back to the existing POST/PATCH path.
- **Shared plumbing**: Reuse the garbage-collecting store, auto-save queuing, and identity resolution. Only the persistence layer should change.
- **Error safety**: Surface atomic failures with enough context so callers can retry or present actionable UI feedback.

## Proposed Architecture
1. **New API Surface**
   - Add `store.addMany(documents: LooseSingleCardDocument[], opts?: { realm?: string }): Promise<CardDef[]>`.
   - Documents are pre-serialized (callers decide `add` vs `update` by presence of `data.id`).
   - No change to `store.save`, auto-save, or mutation queues.

2. **Atomic Payload Builder (inside `addMany`)**
   - Translate the provided docs into JSON:API atomic operations:
     ```json
     {
       "atomic:operations": [
         { "op": "add", "data": { ...serialized card... } },
         { "op": "update", "ref": { "type": "card", "id": "<existing>" }, "data": {...} }
       ]
     }
     ```
   - Automatically determine `op` (`add` for missing `id`, otherwise `update`).
   - Optional `opts.realm` chooses the realm; otherwise use each doc’s absolute id/realm metadata.

3. **Transport Layer**
   - Call `cardService.executeAtomicOperations()` with the generated payload.
   - Propagate errors from `_atomic` back to the caller; do not fall back to legacy per-card saves so the API stays predictable.

4. **Post-Commit Integration**
   - On success, merge server state (final IDs, realm info) into the returned card instances using `needsServerStateMerge`.
   - Register each card with GC/identity maps via existing helper (`setIdentityContext`, `startAutoSaving` when needed).

5. **Error Handling**
   - If `_atomic` responds with an error, throw a single `CardError` describing the batch failure.
   - Do **not** partially apply changes; callers can inspect the error payload for retry logic.

## API Sketch
```ts
class CardStoreWithGC {
  /**
   * Persist multiple card documents in one call.
   */
  addMany(
    docs: LooseSingleCardDocument[],
    opts?: { realm?: string },
  ): Promise<CardDef[]>;
}
```

Usage example:
```ts
const docs = [doc1, doc2]; // prepared via cardService.serializeCard
const [styleRef, brandGuide] = await store.addMany(docs, {
  realm: 'http://localhost:4200/catalog/',
});
```

## Implementation Notes
- Keep `addMany` thin: serialize docs outside, validate minimal fields inside.
- Share helper utilities (`needsServerStateMerge`, `setIdentityContext`, `startAutoSaving`) so returned cards behave like ones created through existing store APIs.
- Do not expose atomic queuing internally; the method simply wraps the `_atomic` call and merges results.
- Optional enhancements (later):
  - Accept plain card instances and serialize internally.
  - Allow relationship-only operations (`op: "update"` with minimal payload).
  - Track metrics on batch size and latency.

## Open Questions
- Should we expose atomic batching to plugins/commands directly (e.g., `store.atomic(batch => ...)`) or keep batching internal to auto-save?
- How do we handle cross-realm atomic writes? Current `_atomic` contracts are realm-local.
- Can we reuse the same mechanism to batch deletions (`op: "remove"`) and relationship-only changes?

## Next Steps
1. Implement `store.addMany` with minimal validation + `_atomic` call.
2. Add unit/integration tests covering successful batches, unsupported endpoint fallback, and error propagation.
3. Update developer docs with guidance on preparing docs via `cardService.serializeCard` before calling `addMany`.
- Do not expose atomic queuing internally; the method simply wraps the `_atomic` call and merges results. (No fallback—callers get errors directly if the realm rejects the batch.)
