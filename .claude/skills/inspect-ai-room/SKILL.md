---
name: inspect-ai-room
description: Inspect an AI assistant room's Matrix events on local, staging, or production — token usage/cost per turn, decoded timeline (edits, tool requests/results, streaming flags), room state (LLM model, mode, skills) — and export a room as a replay fixture for the host's motion replay test. Use when the user hands over a room id (local, staging, or production) and wants the session analyzed, when analyzing benchmark sessions, diagnosing a stalled/stuck assistant response, checking whether prompt caching is working, or when a motion bug in the assistant transcript (a jump, a squash, an overlap) needs re-creating from the room it happened in.
---

# Inspect an AI assistant room

All inspection goes through the Matrix client API. Locally the script logs in
as `aibot` (password `pass`), which is a member of every assistant room. The
consolidated script:

```sh
node scripts/inspect-room.mjs rooms [N]           # N most recent rooms, newest first
node scripts/inspect-room.mjs timeline <roomId>   # decoded event timeline
node scripts/inspect-room.mjs usage <roomId>      # per-turn tokens/cost + session total
node scripts/inspect-room.mjs state <roomId>      # LLM model, act/ask mode, skills
node scripts/inspect-room.mjs raw <roomId> [str]  # full event JSON, filtered by substring
node scripts/inspect-room.mjs replay <roomId>     # a fixture for the motion replay test
```

(paths relative to this skill's base directory)

## Staging / production rooms

The aibot password for deployed environments is not readable by the
`boxel-claude-readonly` AWS role (checked; `ssm:GetParameter` on
`BOXEL_AIBOT_PASSWORD` is denied by design). Instead the script reuses the
Matrix token that boxel-cli stores in `~/.boxel-cli/profiles.json`:

```sh
node scripts/inspect-room.mjs --profile staging timeline '!abc:stack.cards'
node scripts/inspect-room.mjs --profile staging usage    '!abc:stack.cards'
node scripts/inspect-room.mjs --profile @me:stack.cards rooms 10
```

`--profile` takes a profile id or a substring of its `matrixUrl`
(`staging`, `boxel.ai`). A substring that matches more than one profile is
rejected; pass the exact id then. Every subcommand works; `rooms` lists the
profile user's rooms, not all rooms. Room ids on staging end in `:stack.cards`;
quote them in the shell because of the `!`.

Limits: the profile's user must be a member of the room (the user who ran the
session — that is the normal case when the user tests on staging with the same
account boxel-cli is logged in as). If the token was revoked, `boxel profile
add` re-authenticates. `MATRIX_URL` + `MATRIX_TOKEN` env vars are the raw
fallback for a token from elsewhere (e.g. copied from the browser's
`auth` localStorage entry).

## Replaying a room to debug the transcript's motion

`replay` turns a room into a fixture for the host's motion replay test
(`packages/host/tests/integration/components/ai-assistant-panel/motion-replay-test.gts`;
the assistant motion README's "Replaying a room" section has the rest),
which plays it back into the real panel with motion on and fails on a
scaled message, an overlap, a one-frame jump or a glide the scroll cancels.

```sh
node scripts/inspect-room.mjs replay '!abc:localhost'
node scripts/inspect-room.mjs --profile staging replay '!abc:stack.cards' --turns 2
```

- The last `--turns` turns (default 1) play on the clock; everything before
  is history and lands at once. Pauses over `--max-gap` (1500 ms) are cut,
  and a reply's streaming over `--max-stream` (4000 ms).
- The bot streams over to-device previews, which the room does not keep:
  each reply's previews are made up from its final edit, every 250 ms.
- Text (bodies, reasoning, string values in tool arguments) is replaced by
  filler of the same shape, so the transcript lays out the same and nothing
  anyone wrote leaves the room. `--keep-text` keeps it as written.
- Attachments, tool results' output cards and fields kept in Matrix media
  are left out; the fixture's `source.notes` say what was.
- The fixture lands in `packages/host/tests/fixtures/ai-room-replay/local/`
  (`--out` to choose), which git ignores. A real session's fixture stays
  there. Commit one only filled in, after reading it (pr-privacy); never one
  made with `--keep-text`.

Then, with the host dev server and test services running, open
`https://localhost:4200/tests?filter=<fixture name>&replaySpeed=0.25&replayHold&replayTrace`
to watch it slowed down and log every frame the probe saw.

## Analysis procedure for a "this session is full of errors" report

1. `state` — confirm model, `act`/`ask` mode, which skills were enabled.
2. `usage` — check the cache line per turn; a `cached` reset mid-session means
   history was rewritten.
3. `timeline` — walk the tool requests and their results. For each
   `toolResult` with an error, pull the full payload with
   `raw <roomId> <substring>` and classify: model error (wrong API, bad
   import, hallucinated field), skill-text gap (the skill did not say it),
   or platform error (indexing, realm 4xx/5xx, host command failure).
4. For platform errors on staging, correlate with realm-server logs via the
   `tail-logs` / `aws-access` skills using the event timestamps.
5. Report per error: what the model tried, what failed, root cause class, and
   the fix location (skill text vs. model vs. platform).

## Reading the timeline

- Each bot answer is one original `m.room.message` (`fin=false`) plus `m.replace`
  edits; the last edit has `fin=true`. Edits of one answer share the original
  event id via `m.relates_to.event_id`.
- `data` in event content is a **JSON string on the wire** — parse it before
  reading `data.usage` / `data.context.agentId`. The script does this.
- Token usage (`data.usage`) rides the **final edit** of each answer (or a
  trailing usage-only edit when the provider reports late). `cachedTokens`
  climbing turn over turn = prompt caching works; a reset to ~0 or a flat
  low value = something rewrote conversation history and invalidated the cache.
  The bot records `data.usage` since the show-token-usage change landed;
  sessions older than that (and hosts without it) legitimately report
  `0 turns` — that is missing data, not a caching regression.
- Tool requests appear under `app.boxel.toolRequests` on the bot's message
  (`app.boxel.commandRequests` in rooms from before the command→tool rename);
  the host answers with an `app.boxel.toolResult` event (legacy:
  `app.boxel.commandResult`).

## Why didn't a tool auto-run?

Silence after a bot message carrying a tool request means the **host** (Ember
app in the browser tab) never executed it — the bot is just waiting. Two
gates decide auto-run:

1. `state` — mode must be `act`, unless the tool is declared
   `requiresApproval: false` in the declaring skill's frontmatter.
2. `timeline` — compare the message's `agent=` with earlier messages whose
   tools DID run. The host only auto-runs tools whose `data.context.agentId`
   matches its own (sessionStorage, per tab): a tool sent through another tab
   is by design never auto-run in this one.

If both gates pass and there is no `toolResult` at all (not even an
`invalid` one), the failure is host-side and only that tab's browser console
has it — Matrix records nothing. The green Apply pill still runs the tool
manually.

## Synapse DB (last resort)

The client API view is complete for room history. The DB adds only
completeness checks (undelivered to-device rows, redactions):

```sh
docker exec boxel-synapse python3 -c "
import sqlite3
db = sqlite3.connect('file:/data/db/homeserver.db?mode=ro', uri=True)
print(db.execute('SELECT count(*) FROM device_inbox').fetchone())
"
```

`sqlite3` CLI is not in the container; use python3. Open read-only (`mode=ro`)
— never write to synapse's DB.
