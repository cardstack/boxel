# PretUI syndication into the Boxel workspace

PretUI's realm is canonical, but the Boxel Host also needs a normal build-time
package. The A6 syndication step projects one exact canonical PretUI Version
into `packages/pretui` without making the monorepo a second source of truth.

This is intentionally asymmetric:

```text
@cardstack/pretui@0.4.0/             packages/pretui
exact canonical Version  ─────────▶  generated workspace representation
 Checkpoint + Version     syndicate  source files + DECK_SOURCE.json
```

Daily authoring, History, branching, Reviews, and merges belong to the realm.
Syndication happens only after the team accepts an exact Version that another
Boxel package must import at build time.

## Reproduce the workspace package

First create the canonical package described in
[the Known Date fixture](./deck-pretui-known-date-fixture.md). Then run:

```sh
export BOXEL_DECK_COLLABORATION_ENABLED=true
export BOXEL_DECK_COLLABORATION_REALM_RRIS=@cardstack/pretui/

cd packages/realm-server
mise exec -- pnpm syndicate:pretui -- \
  "$REALM_DIR" 0.4.0 ../../packages/pretui

mise exec -- pnpm syndicate:pretui -- \
  "$REALM_DIR" 0.4.0 ../../packages/pretui --check
```

The first command refuses to overwrite a directory containing files outside
the declared generated set. The second command independently reconstructs the
expected paths and bytes, then fails on a changed file, an extra file, a
different source tree/index/lock, or a mapping change.

`packages/pretui/DECK_SOURCE.json` records:

- the exact source Version RRI;
- its exact canonical source Checkpoint;
- the canonical tree, card-index, and import-map lock hashes;
- the syndication mapping version; and
- one hash over the generated workspace source.

The B0 realm adapter verifies the complete
Version → Checkpoint → Repository → package tree and lock chain before the
generator writes anything. A missing object, mismatched PretUI RRI root, or
Version whose tree/index differs from its recorded Checkpoint fails
syndication rather than producing source with partial provenance.

## Verify the downstream consumer

```sh
mise exec -- pnpm --filter @cardstack/pretui lint:types

cd packages/host
mise exec -- pnpm lint
mise exec -- pnpm build
mise exec -- pnpm exec ember test --path dist \
  --filter 'generated PretUI Known Date consumer'
```

The Host imports `@cardstack/pretui/known-date` as an ordinary workspace
dependency. Its focused test parses `15 April 90` against a fixed pivot and
checks a deterministic relative phrase. No source file under
`packages/pretui` should be edited by hand.

## Returning future accepted work

The generic boundary is "exact canonical Version to declared external
representation." PretUI currently targets one Boxel workspace subtree. A
future Realm Runner command can use the same boundary for GitHub syndication,
Google Drive, Dropbox, Salesforce, or another configured destination without
turning any of them into the canonical branch/history store.
