---
status: proposed
date: 2026-11-03
scope:
  - packages/runtime-common/ai/external-fields.ts
  - packages/runtime-common/ai/history.ts
  - packages/host/app/services/matrix-service.ts
  - packages/host/app/services/tool-service.ts
  - packages/ai-bot/lib/code-patch-correctness.ts
  - packages/runtime-common/ai/prompt.ts
  - packages/runtime-common/ai/correctness-*.ts
  - packages/host/app/tools/check-correctness.ts
---

# 016. Carry a Matrix event's oversized structured fields as media

Matrix refuses an event over 64 KB, and some events the ai-bot and the host
send grow with the work they describe: a bulk edit's correctness check names
every changed card. When such an event's content would pass the limit, the
fields that grow are uploaded to Matrix media and the event carries a
reference in their place; every reader puts them back before it reads the
event. The event stays one event, and code past the read path never sees the
difference. A reply's correctness checks follow this rule: one event, one
batched request, whatever the number of targets.

## 1. Decision

### 1.1. Externalizing

An event whose structured content is complete when it is sent, and can grow
past the limit, MUST go through `externalizeOversizedFields`. Content within
`MAX_MATRIX_EVENT_CONTENT_BYTES`, measured as UTF-8 JSON, MUST be sent as it
is. Over it, each named field MUST be uploaded as JSON, removed from the
content, and listed under `app.boxel.externalFields` with its `mxc://` URL.
The sender MUST NOT send content still over the limit without those fields.

### 1.2. Restoring

Every path that reads such events MUST put the fields back with
`restoreExternalFields` before anything else reads the event: the ai-bot in
`constructHistory`, the host in `processDecryptedEvent`. A reader MUST fetch
only `mxc://` media, from its own homeserver. A field that can't be fetched
MUST stay listed under `app.boxel.externalFields`, and the reader SHOULD log
why.

### 1.3. A reply's correctness checks

A reply's edits MUST be checked by one correctness event holding one
`checkCorrectness` request, which lists every target in `targets`. Each
target MUST name its `type` and its `ref` as a full RRI. A target MAY carry
`lintIssues`. A target MUST carry `attempt` only when the attempt is above 1.
The request MUST be externalized as §1.1 says, under
`app.boxel.toolRequests`. The host tool MUST still accept the single-target
shape (`targetType`, `targetRef`) and answer it as it did before batching.

### 1.4. Attempts

The bot MUST derive each target's next attempt from that target's earlier
checks and their results in the room's history. A target passes in a batch
only when the result is `applied`, its result card can be read, and no
`targetResults` entry names it. The bot MUST NOT send a check for a target
past `MAX_CORRECTNESS_FIX_ATTEMPTS`.

### 1.5. Host isolation

A target whose check throws SHOULD fail only that target, with the error as
its own.

## 2. Rationale

The correctness sender put one request per target in a single event, so the
event grew with the edit. About 75–95 cards passed 64 KB, Synapse answered
`M_TOO_LARGE`, and the room stopped. Synapse's limit covers the whole event,
envelope included, so the content budget sits 8 KB under it.

The codebase already carries large structured payloads that are complete when
sent as Matrix media: cards, tool definitions, skill files and every tool
result card. A list of check targets is the same kind of payload. Uploading it
only when it is over the budget keeps the common case inline and free, and
keeps a reply's checks as one event with one result, so the bot needs no rules
for an event split in parts. The model sees every target's result at once,
with one instruction.

Batching checks the targets of one event together, which keeps the host's
work and the bot's wake-ups to one per reply. Attempts read from history let
a fix round re-check only the targets that failed.

## 3. Considered options

- **Externalize oversized fields, through one helper (chosen).** One event
  per check, nothing uploaded under the budget, and the same helper serves
  any other event that grows.
- **Split the targets across several events, grouped by the reply they
  relate to.** Every event fits, but the bot has to wait on a group, resume a
  send that stopped partway, and keep a send failure after the first event
  out of the room. This was the first design for the correctness check.
- **Continuation (`hasContinuation` / `continuationOf`).** Built for a reply
  streamed before it exists. The host reads one part's tools, the bot doesn't
  wait on an incomplete chain, and a broken chain would need resuming. A
  second tool result event would also read as a newer outcome of the same
  request.
- **Cap the number of targets.** The model never learns about the rest.
- **Compress the requests.** The event still grows with the edit. It only
  moves the limit.

## 4. Remediation

Known gaps are listed in [remediation/016.md](remediation/016.md).
