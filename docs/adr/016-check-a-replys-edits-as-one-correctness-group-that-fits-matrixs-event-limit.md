---
status: proposed
date: 2026-11-02
scope:
  - packages/ai-bot/lib/code-patch-correctness.ts
  - packages/runtime-common/ai/prompt.ts
  - packages/runtime-common/ai/correctness-*.ts
  - packages/host/app/tools/check-correctness.ts
---

# 016. Check a reply's edits as one correctness group that fits Matrix's event limit

After a reply edits cards or files, the ai-bot asks the user's tab to check
every changed target, and the model reads the results before it answers. A
bulk edit can change hundreds of targets, and Matrix refuses an event over
64 KB. So the checks for one reply go out as a correctness group: one or more
correctness events that relate to the reply, each holding one batched
`checkCorrectness` request that fits a byte budget. The bot treats the group
as one check: it waits for all of it, resumes it if sending stopped, counts
attempts per target, and gives the model one instruction for it.

## 1. Decision

### 1.1. Batched requests

A correctness event MUST hold one `checkCorrectness` request that lists its
targets in `targets`. Each target MUST name its `type` and its `ref` as a full
RRI. A target MAY carry `lintIssues`. A target MUST carry `attempt` only when
the attempt is above 1. The host tool MUST still accept the single-target
shape (`targetType`, `targetRef`) and answer it as it did before batching.

### 1.2. The event budget

The content of each correctness event MUST fit
`MAX_MATRIX_EVENT_CONTENT_BYTES`, measured as UTF-8 JSON. The sender MUST
guarantee the fit by how it counts, not by the data it happens to get. The
sender MUST NOT drop a target to fit. A target too large for an event of its
own MAY have its `lintIssues` shortened, with a last line that counts the
issues left out. Modules SHOULD go first, since a broken definition breaks
every instance of it.

### 1.3. The group

A correctness group MUST be every correctness event whose
`m.relates_to.event_id` is the reply. Correctness events MUST NOT carry a part
index or a part count. The bot MUST NOT prompt the model until every request
in the group has a terminal result. The model MUST get one follow-up
instruction for the group, after the group's last event.

### 1.4. Resuming a group

The bot MAY send the targets a group has not asked for only while an event of
the group is the latest non-result event in the room. Once anything else is
said in the room, the group is complete. A failure to send an event after the
group's first MUST NOT post a room message, because that message would
complete the group.

### 1.5. Attempts

The bot MUST derive each target's next attempt from that target's earlier
checks and their results in the room's history. A correctness event MUST NOT
carry attempt bookkeeping beyond each target's own `attempt`. A target passes in a batch only when the
result is `applied`, its result card can be read, and no `targetResults` entry
names it. The bot MUST NOT send a check for a target past
`MAX_CORRECTNESS_FIX_ATTEMPTS`.

### 1.6. Host isolation

A target whose check throws SHOULD fail only that target, with the error as
its own.

## 2. Rationale

The old sender put one request per target in a single event, so the event grew
with the edit. About 75–95 cards passed 64 KB, Synapse answered
`M_TOO_LARGE`, and the room stopped. Synapse's limit covers the whole event,
envelope included, so the content budget sits 8 KB under it.

The model has to see every target's result to fix what broke and to tell the
user what it changed. Dropping targets or sampling them would hide failures.
Splitting keeps every target, and the group rule keeps the model's view whole:
it reads all the results at once, with one instruction, as it did when a
reply had one event.

The relation to the reply already names the group, so a part index or count
adds nothing the bot can't derive. A count would also have to be known before
the first event goes out, and a resumed send changes it. Resuming only while
the group is the latest event keeps the bot from re-checking edits after the
user has moved on.

Attempts read from history survive any split, keep a map of attempts out of
every event, and let a fix round re-check only the targets that failed.

## 3. Considered options

- **Batched requests split across events by a byte budget (chosen).** Every
  target is checked, events stay small, and old single-target rooms still
  read the same.
- **Cap the number of targets.** Simple, but the model never learns about the
  rest, and the cap sits wherever the next large edit lands.
- **One event per target.** Each event fits, but a bulk edit posts hundreds of
  events, and the bot wakes for each result.
- **Upload the target list as a Matrix media file.** Fits any size, but adds an
  upload and an authenticated fetch to every check, and the list leaves the
  room's history.
- **Compress the requests.** The event still grows with the edit. It only
  moves the limit.
- **Number the parts.** Covered in the Rationale: the relation already names
  the group.

## 4. Remediation

Known gaps are listed in [remediation/016.md](remediation/016.md).
