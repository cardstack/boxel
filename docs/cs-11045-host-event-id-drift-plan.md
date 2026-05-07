# CS-11045 — Host event_id drift on commandResult

Linear: https://linear.app/cardstack/issue/CS-11045

## Problem

Mid-conversation the ai-bot crashes with an Anthropic API rejection:

```
messages.4.content.0: unexpected `tool_use_id` found in `tool_result` blocks: check-e891cab5-…
Each `tool_result` block must have a corresponding `tool_use` block in the previous message.
```

Once it happens, every subsequent message in the room returns "There was an error processing your request" until the room is reset.

Reproducible flow (production: room `!djuQxlnuYUoIABVEme:boxel.ai`, "create a recipe tracker"):
1. Bot streams a message that contains both a `SEARCH/REPLACE` block AND a `write-text-file_e5a1` tool_call.
2. User clicks "Apply".
3. Host emits `app.boxel.codePatchResult` with `m.relates_to.event_id = $POST_STREAM_ID` ✅
4. Host emits `app.boxel.commandResult` with `m.relates_to.event_id = $PRE_STREAM_ID` ❌ **(different event_id, same logical bot message)**
5. ai-bot's `getCommandResults` (`packages/runtime-common/ai/prompt.ts:813`) filters strictly by `m.relates_to.event_id`, so the result is dropped.
6. The OpenAI-format messages array ends up with two adjacent `assistant {tool_use=…}` messages and only one matching `tool_result`. Anthropic rejects.

## Root cause

**Host side (primary):** the bot's event_id captured for command-dispatch is a stale snapshot taken during streaming; codePatchResult somehow uses the post-stream id.

What I verified by reading the code:

- `MessageCommand.eventId` is set once in the constructor (`packages/host/app/lib/matrix-classes/message-command.ts:30`).
- `MessageBuilder` supplies it from `builderContext.effectiveEventId` (`message-builder.ts:355`).
- `effectiveEventId` is computed in `room.ts:640` (`getEffectiveEventId`) at first observation and threaded into the builder once per message.
- `Message.eventId` is also set once in the constructor (`message.ts:95`); `updateMessage` (`message-builder.ts:200`) refreshes body / reasoning / status / commandRequests but never `eventId`.
- `command-service.ts:600` (`run` task) destructures `eventId` from `MessageCommand` and passes it as `invokedToolFromEventId` to `sendCommandResultEvent`.

So `command.eventId` is whatever effectiveEventId was when the bot's commandRequest first appeared — typically the **streaming/intermediate** event_id — and never refreshes. By the time the user clicks Apply, streaming has finished and a *different* canonical id exists in the room, but the command still carries the old snapshot.

**Open mystery (intentionally not blocking):** by my reading, codePatchResult's `codeData.eventId` flows from `message.htmlParts → parseHtmlContent(... this.eventId)`, so it should also see the snapshot id. But the room data shows it using the post-stream id. This works in our favor for codePatch, but I haven't fully traced *why*. The fix below sidesteps the mystery by sourcing the event_id from current room state for both paths, so we don't depend on whichever accidental behavior makes codePatch "work" today.

**ai-bot side (secondary, defense in depth):** `getCommandResults` (`packages/runtime-common/ai/prompt.ts:813`) matches strictly by `m.relates_to.event_id`. Even after we fix the host, future drift (cancellations, partial sync, reconnects, future code changes) could re-introduce the orphan-tool_use shape. A small commandRequestId fallback makes ai-bot resilient.

## Goals

1. Host emits `commandResult.m.relates_to.event_id` referencing the bot message's **current** id at execute time, not a snapshot from streaming.
2. ai-bot's prompt construction tolerates event_id drift by also matching on `commandRequestId`.
3. The recipe-tracker conversation flow no longer crashes the assistant.
4. No regressions in correctness/title/cancellation/code-patch tests.

## Non-goals

- Don't rewrite the streaming/replace handling in `room.ts`. Targeted change only.
- Don't change `Message.eventId` to be mutable (keeps Message identity stable for everything else keyed by it).
- Don't filter `APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE` events out of prompt construction — the LLM needs to see those exchanges.
- Don't ship the orphan-tool_use safety-net sweep in this ticket. Once both fixes land it shouldn't be needed; if drift recurs we add it then.

## Approach

Two layered changes across two packages, narrow scope.

### 1. Host: source event_id from room state at execute time

`packages/host/app/services/command-service.ts`

In the `run` task (line 521+), instead of using the stale `command.eventId`, look up the **current** event_id of the bot message that owns this commandRequest by scanning `roomResource.events` for the latest event whose `APP_BOXEL_COMMAND_REQUESTS_KEY` array contains the executing tool_call id, and use *that* event's `event_id`.

Apply the same pattern to `executeReadyCodePatches` / `patchCode` so codePatchResult also uses the current id (removes the asymmetry without us needing to first explain why codePatch already happens to work).

Rough shape (final form to be decided during implementation):

```ts
private getCurrentEventIdForCommand(roomId: string, commandRequestId: string): string | undefined {
  const room = this.matrixService.roomResources.get(roomId);
  if (!room) return undefined;
  // Walk events newest-first; first match wins.
  for (let i = room.events.length - 1; i >= 0; i--) {
    const e = room.events[i];
    if (e.type !== 'm.room.message') continue;
    const reqs = (e.content as any)?.[APP_BOXEL_COMMAND_REQUESTS_KEY] ?? [];
    if (reqs.some((r: any) => r.id === commandRequestId)) {
      return e.event_id;
    }
  }
  return undefined;
}
```

Then in `run`:

```ts
const currentEventId =
  this.getCurrentEventIdForCommand(command.message.roomId, commandRequestId!) ??
  eventId; // fallback to snapshot if lookup fails
await this.matrixService.sendCommandResultEvent({
  ...,
  invokedToolFromEventId: currentEventId,
  ...
});
```

For codePatch, do the analogous thing keyed by `(eventId baseline + codeBlockIndex)` or by recomputing from the current message's body. Will be settled during implementation.

### 2. ai-bot: commandRequestId fallback in `getCommandResults`

`packages/runtime-common/ai/prompt.ts:813–827`

`getCommandResults` currently filters strictly on `m.relates_to.event_id`. Add a fallback: a result also matches if its `commandRequestId` is in the set of `APP_BOXEL_COMMAND_REQUESTS_KEY` ids on the bot message. Both event_id and commandRequestId are valid links; commandRequestIds are uuid-unique per tool_call so cross-message contamination isn't a real risk.

```ts
function getCommandResults(cardMessageEvent, history) {
  const requestIds = new Set(
    (cardMessageEvent.content[APP_BOXEL_COMMAND_REQUESTS_KEY] ?? [])
      .map((r) => r.id)
      .filter(Boolean),
  );
  return history.filter((e) => {
    if (!isCommandResultEvent(e)) return false;
    if (e.content['m.relates_to']?.event_id === cardMessageEvent.event_id) return true;
    if (requestIds.has(e.content.commandRequestId)) return true;
    return false;
  });
}
```

`getCodePatchResults` (line 850) has no equivalent unique id; leave it event_id-only. After change #1, both result-event paths will use the current event_id, so the strict match suffices.

## Files to modify

- `packages/host/app/services/command-service.ts`
  - `run` task (lines ~521–619): replace `eventId` usage with `getCurrentEventIdForCommand` lookup.
  - `executeReadyCodePatches` / `patchCode` (lines ~728–810): same lookup pattern for codePatch path.
  - Add `getCurrentEventIdForCommand` (or equivalent) helper.
- `packages/runtime-common/ai/prompt.ts`
  - `getCommandResults` (lines 813–827): add commandRequestId fallback.

## Tests (TDD — write failing first)

### Host (`packages/host/tests/integration/components/ai-assistant-panel/`)

A test that constructs a streaming bot message with multiple m.replace events, where the *latest* event_id differs from the *first observation* event_id, and the bot message contains both a SEARCH/REPLACE block and a tool_call. Click "Apply". Assert that:
- The emitted `commandResult` event's `m.relates_to.event_id` equals the latest bot message event_id.
- The emitted `codePatchResult` event's `m.relates_to.event_id` equals the latest bot message event_id.
- The two ids are equal to each other.

This test fails on `main` (commandResult uses the stale id) and passes after the fix.

### ai-bot (`packages/ai-bot/tests/prompt-construction-test.ts`)

Three cases:
1. **Drift fallback**: bot msg has tool_call `T1` and event_id `$NEW`; commandResult has `commandRequestId: T1` and `m.relates_to.event_id: $OLD`. Assert the resulting messages array has a `tool` message with `tool_call_id: T1` immediately after the assistant message.
2. **Strict match still works**: existing happy path (event_ids align) still produces correct pairing.
3. **Recipe-tracker regression**: three bot messages (switch-submode, write-text-file with mismatched event_id between bot msg and commandResult, codePatchCorrectness with checkCorrectness). Assert no two adjacent assistant messages without a tool message between, and every `tool_call_id` has exactly one matching `tool` message.

All three fail on `main`; pass after the fix.

## Verification

1. From `packages/ai-bot`: `pnpm test` — all new prompt-construction tests pass; full suite stays green.
2. From `packages/host`: run the new acceptance test in isolation via `ember test --path dist --filter "<test name>"` (full host suite runs in CI per AGENTS.md).
3. Local repro: fresh ai-bot room, ask "create a recipe tracker", let it emit SEARCH/REPLACE + tool_call, accept the patch, send a follow-up. The conversation continues normally instead of "There was an error processing your request".

## Assumptions / risks

- **Assumption**: `roomResource.events` is the canonical Matrix event list and is always up-to-date at execute time. Need to verify during implementation.
- **Assumption**: a `commandRequestId` appears in at most one bot message in a given room. UUID-based, but worth a sanity check during implementation.
- **Risk**: changing the codePatch path (when it currently appears to "just work") could regress. Mitigated by the new host test asserting both ids align.
- **Open question for follow-up**: why does codePatchResult already use the post-stream id given my reading of the code? Worth tracing once the immediate user-visible bug is fixed. Not blocking this ticket.

## Out of scope (this ticket)

- The "orphan tool_use safety net" defensive sweep in `buildPromptForModel`. Held back as a future addition if drift recurs.
- Any rewrite of `getAggregatedReplacement` / `getEffectiveEventId` semantics.
- Any change to how the bot streams (`response-publisher.ts`).
