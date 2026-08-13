---
name: inspect-ai-room
description: Inspect a local AI assistant room's Matrix events — token usage/cost per turn, decoded timeline (edits, tool requests/results, streaming flags), room state (LLM model, mode, skills). Use when analyzing benchmark sessions, diagnosing a stalled/stuck assistant response, or checking whether prompt caching is working.
---

# Inspect a local AI assistant room

All inspection goes through the Matrix client API on the local synapse
(`http://localhost:8008`), logged in as `aibot` (password `pass`), which is a
member of every assistant room. The consolidated script:

```sh
node scripts/inspect-room.mjs rooms [N]           # N most recent rooms, newest first
node scripts/inspect-room.mjs timeline <roomId>   # decoded event timeline
node scripts/inspect-room.mjs usage <roomId>      # per-turn tokens/cost + session total
node scripts/inspect-room.mjs state <roomId>      # LLM model, act/ask mode, skills
node scripts/inspect-room.mjs raw <roomId> [str]  # full event JSON, filtered by substring
```

(paths relative to this skill's base directory)

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
- Tool requests appear under `app.boxel.toolRequests` on the bot's message;
  the host answers with an `app.boxel.toolResult` event. Code patches get
  `app.boxel.codePatchResult` events plus a `codePatchCorrectness` follow-up.

## Diagnosing "the session stalled after a tool request"

Silence after a bot message carrying a tool request means the **host** (Ember
app in the browser tab) never executed it — the bot is just waiting. Check in
order:

1. `state` — mode must be `act` for auto-run, unless the tool is declared
   `requiresApproval: false` in the declaring skill's frontmatter.
2. `timeline` — compare the stalled message's `agent=` with earlier messages
   whose tools DID run. The host only auto-runs tools whose
   `data.context.agentId` matches its own (sessionStorage, per tab). A
   mismatch means another tab owns the session.
3. If the gates pass and there is still no `toolResult` (not even an
   `invalid` one), the host's tool-processing drain died silently — an
   exception mid-drain or the retry give-up path. Both log only to the
   browser console; nothing reaches Matrix. The green Apply pill in the UI
   still works as a manual fallback.

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
