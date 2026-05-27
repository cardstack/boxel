---
name: evergreen-comments
description: Write code comments, PR descriptions, PR review replies, and other reader-facing prose so they describe the code as it is now — never the journey of how it got there, and never a private ticket/PR reference. Use whenever writing or editing a code comment, a PR title/description/comment, a commit's reader-facing prose, or restating a tracker ticket. Triggers on adding/editing comments, opening or updating a PR, or replying to review feedback.
---

# Evergreen Comments & Prose

Reader-facing prose describes the **current contract**, stated as timeless fact. It does not narrate how the author arrived, and it does not reference private trackers or sibling changes. Delivery state and iteration history rot the moment PRs renumber, tickets close, branches reland, or the work gets restructured — and the reader years later cares about the invariant the code upholds, not the path to it. Archaeology is `git log` / `git blame` territory.

This codebase is **open source**; the issue tracker is **private**. A ticket ID in a comment is opaque to almost everyone who will ever read it.

## The two rules

### 1. Present the code as it is — not the journey

Strip anything about *how the author got here*. Within a single PR especially, the journey is worthless to a future reader.

Always cut:
- "An earlier revision / earlier attempt did X", "First I tried A, then B, then C"
- "Originally we did X but switched to Y", "the first cut was X, redesigned to Y" — this describes a path **not** taken
- "I reproduced locally, narrowed to Y, reverted Z", "confirmed by reverting…", "diagnostic logs pinpointed…"
- Iteration timelines, SHA-by-SHA reports, "earlier this broke six tests"
- **Temporal / relative-time language**: "until now", "used to", "previously", "the old behavior was", "now we", "recently", "as of today". A reader has no anchor for *when* "now" is — the comment reads as if something just changed even when it changed years ago. State the contract timelessly.

### 2. No private-tracker or sibling-change references

Never put any of these in code comments, skill files, PR descriptions, or review replies:
- **Ticket IDs** (e.g. `CS-12345`, `CS-12345 PR 3`) — private tracker, meaningless and opaque to outside readers
- **PR numbers / PR-letter labels** — `#4863`, "PR A", "PR B", "stacked PR N", "in this PR we…"
- **Sibling-change references** — "same pattern PR 2 added", "see also PR 6's comments"

Name the **mechanism**, not the change:
- ❌ "PR A's PagePool fix makes the on-demand path safe."
- ✅ "The PagePool's tab-materialization for module/command callers makes the on-demand path safe."

## Example: same content, evergreen vs. rotty

Rotty (don't write) — encodes delivery state, references a private ticket and a sibling PR, and uses "no longer":

```
// CS-XXXXX PR 3: the /_atomic endpoint no longer awaits indexing.
// We KEEP /_atomic (rather than switching to parallel +source POSTs)
// ...same pattern PR 2 added for the +source surface.
```

Evergreen (write this) — same technical content, survives the next refactor:

```
// /_atomic returns once writes are durable, not once they are indexed.
// Callers needing indexed state must drain via realm.incrementalIndexing()
// (server-side) or wait on the matrix 'index' incremental event (client-side).
// Mixed module+instance batches are serialized: the intermediate flush in
// _batchWrite is always awaited, so an instance's serialization sees its
// module already indexed.
```

## PR descriptions and review replies

A PR description carries the **current shape only**: what the code does now, why this shape is right (constraints/trade-offs as live invariants, not "we tried X and it failed"), what's in scope vs. deferred, and the test plan. When a PR pivots, the description gets rewritten to the new shape — not a changelog of the pivot.

A status comment after a re-push is a single sentence pointing at the description — nothing else. The iteration history goes in the private tracker or commit messages, or nowhere.

## Restating a tracker ticket

When a ticket's original framing predates data you now have, rewrite it as a clean statement of the current problem → live measurements → path forward. Not "originally we thought X, but now we know Y", not "PRs landed since last update". No chronology.

## Where the journey legitimately goes

- **Commit messages** — one substantive change each; the "why now" lives here.
- **The private tracker** — staff-only, full detail welcome.
- **`git blame` / `git log`** — the canonical history. Nothing in a comment competes with it.

## Self-check before publishing

Read it back. If a sentence starts with "Earlier", "Before", "Originally", "First I", "I tried", "I reproduced", "Confirmed by", "After reverting", "until now", "used to", "previously", or "now we" — that's journey or temporal rot. Cut it. If it names a ticket ID, PR number, or PR letter — cut that too. If what remains explains *what the code does now and why*, ship. If it explains *how you arrived*, cut more.

Pre-existing rotty references in code you're editing can stay (they're historical context) — the rule governs prose you write.
