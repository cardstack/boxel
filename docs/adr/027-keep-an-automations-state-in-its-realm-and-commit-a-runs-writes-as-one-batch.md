---
status: proposed
date: 2026-11-10
scope:
  - packages/runtime-common/**/*run-overlay*
  - packages/runtime-common/**/run-overlay/**
  - packages/realm-server/**/*run-overlay*
  - packages/realm-server/**/run-overlay/**
  - packages/postgres/migrations/*run-overlay*
  - packages/runtime-common/card-operations/coordinator.ts
  - packages/runtime-common/card-operations/executors.ts
  - packages/host/app/tools/*automation*
---

# 027. Keep an automation's state in its realm, and commit a run's writes as one batch

An automation keeps no state outside its realm. Each run compares the
upstream data with the realm's current files and writes only what differs.
The run's writes are staged on the realm server, where the run reads them
back, and they land together as one all-or-nothing batch when the script
finishes. So a run that fails changes nothing, and the next run starts from
the same files and catches up. In this ADR, a run is one run of an
automation. The assistant's interactive runs follow ADR 022 §1.3.

## 1. Decision

### 1.1. The realm is the state

An automation MUST NOT keep state between runs outside its realm. The
platform MUST NOT give a script a store for cursors, last-seen values or
copies of upstream data. A script SHOULD keep such state in files in its
realm, such as a cursor file or a JSONL log. A run MUST NOT get state from
an earlier run from anywhere but its realm and `realm.current.automation`.

A script SHOULD compare upstream data with the realm's current files and
write only what differs. It SHOULD build each card's path from a stable key
in the data, so that a rerun can't make a duplicate.

### 1.2. Stage every write in a per-run overlay

Every write a run makes MUST be staged in the run's overlay on the realm
server. A write MUST NOT reach the realm while the run is going, and MUST NOT
be staged in the tab. A write operation, such as `appendLine`, MUST be
applied to the overlay, so that the overlay holds its result. The overlay
MUST be readable from every realm-server instance. A request without the
run's token MUST NOT see it.

### 1.3. A run reads its own writes

Every read with the run's token MUST read through the overlay, so that it
returns the staged version of a file or card. `cards.search` MUST run on the
index, and the overlay MUST NOT change the index. A search MUST return the
staged version of each card it finds, and MUST omit a card the run has
staged for deletion. Which cards match, and their order, MUST follow the
indexed values, so a returned card's staged version MAY no longer match the
query. Staged files MUST NOT be indexed.

### 1.4. One batch at the end, or nothing

When the script finishes, the overlay MUST be committed as one `/_operations`
batch, all or none. A run that fails, is canceled or times out, and every
Preview, MUST discard its overlay. The batch MUST NOT contain a `callApi`
entry. A run MUST commit at most once, also when its job is retried.

## 2. Rationale

State outside the realm would be a second source of truth with no history,
no permissions and no view for the people who own the data. With the realm
as the state, a failed or missed run needs no repair: the next run compares,
finds the gap, and writes it. A run in which nothing changed upstream writes
nothing and causes no indexing. The realm already skips a write identical to
the stored file, so a script that does not compare costs a comparison, not an
index pass.

A script that writes as it goes leaves the realm half-updated when it fails
partway, and people and other runs read that half. Staging all writes and
committing them as one batch makes a run all or nothing, with one write lock
and one index pass. It also gives Preview its result for free: it is the
staged batch, discarded. ADR 022 §1.3 makes an interactive run's card updates
wait for the script to finish. The automation surface holds back every write
in the same way.

A script that stages writes must still see them, or it can't append to its
own log or update a card it created. The overlay is on the realm server,
because the server must check each staged write and the tab is
untrusted. It is readable from every instance because a run's requests
can land on any of them. Search pages in SQL over the index. Indexing staged
cards would mean rendering them, which costs a prerender pass per card, and
the index would hold cards that may never commit. So search finds what the
index holds and swaps in the staged version. A script that needs a card it
created in this run keeps it in memory.

## 3. Considered options

- **The realm as the state, a per-run overlay on the realm server, one
  batch at the end (chosen).**
- **Write as the script goes.** A failure leaves the realm half-updated, and
  Preview would need a separate dry-run path.
- **A separate state store per automation.** It is a second source of truth
  that people can't see or edit, and it can drift from the realm.
- **Stage writes in the tab.** The server could check them only at commit,
  from a place it doesn't trust, and the stage would be lost with the tab.
- **Index staged cards so that search sees them.** Each staged card costs a
  render, and the index would hold cards that may never commit.

## 4. Remediation

Known gaps are listed in [remediation/027.md](remediation/027.md).
