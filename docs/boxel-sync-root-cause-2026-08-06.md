# Root cause: how the anti-flash change broke cross-view correctness

2026-08-06. Status: the faulty code is **reverted** (it was never committed);
the branch is back to `03f9ef8516`, the last state verified by the 107/107
conformance battery and in-browser checks. The flash-on-save is back — it is
ugly but _correct_. This document explains what went wrong before any
re-implementation is attempted.

## Symptoms observed

On the sandbox-compatibility corpus (WordPuzzle edit + isolated, side by
side):

- Reordering / editing `guesses` in the edit form stopped propagating
  correctly; interactions felt broken.
- The two views of the same card **disagreed**: the edit form showed 2
  guesses while the isolated view showed 3.
- The card's data was **corrupted**: guess strings were spliced fragments of
  earlier values ("realmzs", "cranesd", "realmsd"), and previously-entered
  guesses were destroyed. This is real data loss in the corpus realm.

## The change that caused it

Two uncommitted edits, made to eliminate the flash-on-every-save:

1. `untrack()` around the renderer resource's async pipeline — so a store
   save no longer invalidates the resource (the flash fix; this half was
   correct in isolation).
2. `watchInstanceModel` — a `subscribeToChanges` subscriber that, on every
   instance-mutation batch, re-ran `projectHostBoxelSemantics(card, ...)`
   and merged the resulting field values into the mounted generation's
   `@model`.

## Root cause chain

### RC-1: the "reader" I installed is actually a writer

`projectHostBoxelSemantics` was designed for **one-shot materialization**,
and at materialization time its side effects are features:

- `presentRelationshipValues` reads each relationship field's getter — the
  sanctioned **lazy-load trigger** (RP-7.2), which bumps loading signals and
  starts fetches.
- With `ensureRelationshipLoaded` (which `watchInstanceModel` passed, copied
  from `requestFor`), a resolved reference is **written back onto the
  instance field**: `instance[fieldName] = resolved`.

Run once at materialize, fine. Run from inside a _change subscriber_, toxic:

```
user edit → subscribeToChanges fires → reprojection
  → relationship getter reads bump loading signals (mutations)
  → ensureRelationshipLoaded writes fields (mutations)
    → subscribeToChanges fires again → reprojection → ...
  → field writes mark the card dirty → AUTO-SAVE issues a PATCH
    → the save echo re-sets every field → subscribeToChanges fires → ...
```

Every card has `cardInfo.theme` (a nested `linksTo`), so this loop path
exists for **every card**, not just relationship-heavy ones. The user's
editor and this feedback machinery became **two concurrent writers** to the
same instance, interleaving index-based `containsMany` updates through
racing auto-saves — which is exactly the observed splicing corruption and
entry loss.

### RC-2: two unserialized delivery channels for one piece of state

The mounted `@model` was now written by two independent paths with no
ordering between them:

- the engine's settle-republish generations (`session.subscribe` →
  `state.model = renderRecord.instance.model`), and
- `watchInstanceModel`'s merges (`state.model = { ...state.model, ...fresh }`).

Whichever wrote last won. That is the 2-vs-3 disagreement between the two
panes: one surface's last write came from a stale channel.

### RC-3 (the real lesson): the update path was bolted on, not designed

The pre-existing behavior — resource teardown on every save — was _accidental_
(a tracking leak), but it was accidentally **safe**: one writer (the store),
one consumer (a full rebuild reading a consistent snapshot). I removed the
accident and replaced it with a mechanism that had neither of the properties
that made the accident safe:

- it was not **read-only** (RC-1), and
- it was not **serialized** with the existing publish pipeline (RC-2).

The synchronization of N views of one instance is a core Boxel feature and
deserves a first-class design, not a patch attached to whichever seam was
nearest.

## Why my verification missed it

- I verified with **single one-shot edits** and checked for the new value's
  presence — which passes even while a background storm corrupts data over
  the following seconds.
- I never asserted the invariants that actually define correctness here:
  _both views converge to equal state_, _the system is quiescent at rest_
  (no writes without user input), and _N rapid interactions leave exactly
  the expected final state_.
- An earlier "sync works" conclusion was drawn from a page served mid-rebuild
  (stale bundle), compounding the confusion.

The user's instrumentation directive — a systematic continuity/sync harness —
is precisely the guard that would have caught this, and it must exist and
pass _before_ the next attempt, with tests for: convergence of two mounted
views after a mutation burst, quiescence at rest (zero PATCHes without user
input over a window), idempotent reprojection (a pure read fires no
subscriber), and post-interaction data equality with the store.

## Current state after stabilization

- Reverted (uncommitted, discarded): `untrack()` + `watchInstanceModel` +
  renderer wiring.
- Kept (uncommitted, inert): the RP-20 spec text (the _target_ contract),
  the continuity test file (will only pass once the redesign lands), and the
  media-bridge blob cache (side-effect-free, unrelated to instances).
- All committed work (`5f386e9e44`…`03f9ef8516`: height lifecycle, instant
  placeholder, adorn restoration, close fixes, media bridge) was verified by
  the full battery and is **not** implicated.
- Known damage: the corpus WordPuzzle card's `guesses` were corrupted during
  the faulty window and cannot be restored from this side.
- Consequence of the revert: the flash-on-save is back (each save re-runs
  the renderer resource). Correct, ugly, temporary.

## The design the next attempt must implement

1. **One writer.** Nothing in any render/refresh path may mutate an
   instance. The refresh read is a new, deliberately pure projection —
   membership observed only via `getRelationshipMembershipState`, no getter
   lazy-load triggers, no `ensureRelationshipLoaded`, no `onSettle`
   registration. Purity is enforceable: a test wraps the reader in a
   `subscribeToChanges` listener and asserts zero notifications.
2. **One pipeline.** Instance-change delivery goes through the ENGINE's
   existing session-publish machinery (the same channel as settle
   republish), so model refreshes and generation swaps are strictly ordered
   per session — never a second channel racing the first.
3. **Batch and converge.** One reprojection per mutation batch; delivery
   carries a monotonic sequence per session; consumers drop stale
   deliveries.
4. **Sandbox leg** (afterwards): parent→child `updateInstance` carrying the
   serialized document with a revision counter; the child applies it to its
   copy without firing its own outbound update for that revision (the frozen
   branch's card-update revision pattern, reversed). Until then the
   documented v1 gap stands: a sandbox child re-renders its own mutations
   only.
5. **Harness first.** The convergence/quiescence/purity tests above (plus
   the existing RP-20 continuity tests) run green before the mechanism is
   wired into the renderer.
