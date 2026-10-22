# Deck collaboration in a realm

`docs/deck-packages-and-runtime-resolution.md` covers how a realm becomes a
package and how its lock resolves. This document covers the other half: how a
realm's mutable source is versioned, shared and recovered without a commit, a
clone or an mtime.

All Deck collaboration state lives inside the realm, under `.deck/`, beside the
authored files. Nothing is stored in a parallel bucket or database.

## The gate

Collaboration is off unless the operator turns it on for exact realms:

```sh
BOXEL_DECK_COLLABORATION_ENABLED=true
BOXEL_DECK_COLLABORATION_REALM_RRIS=@cardstack/pretui/,@acme/relay/
```

`packages/realm-server/lib/deck-collaboration-policy.ts` reads both. The gate
is conjunctive: a realm outside the allowlist cannot reach Version serving,
the protocol adapter, content sync or History, whatever the flag says.

## Verified collaboration objects

The vendored Deck core owns the canonical objects: Repository, branch head,
Checkpoint, Review, and three-way merge. Boxel does not reimplement them.
`packages/realm-server/lib/deck-repository-protocol.ts` decides when Boxel may
trust them:

- An RRI is identity. A Repository is accepted only when its roots and members
  contain the realm's RRI; URL topology is irrelevant.
- Reads are referentially complete. A missing or mismatched content-addressed
  object raises `DeckProtocolIntegrityError`; a caller never receives a partial
  branch or Review.
- A Review stays pinned to its immutable base, target and source Checkpoints,
  so a merge preview is reproducible while the target branch keeps moving.
- `.deck/versions/<version>.json` records, write-once, the exact Checkpoint a
  published Version came from. It is accepted only when the Version's tree,
  index, Repository and lock all agree.
