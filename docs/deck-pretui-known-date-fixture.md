# PretUI Known Date canonical fixture

This fixture proves the Deck package and Version layers against a real,
bounded slice of PretUI. It starts with an empty realm directory, derives a
reviewed dependency closure from a pinned PretUI commit, publishes one
immutable Version, and builds a content-addressed card index for that Version.

The canonical package identity is `@cardstack/pretui/`. Semver ranges express
dependency intent; the selected Version, tree, and index are exact identities.

## Activation boundary

All observable Deck behavior remains deny-by-default:

```sh
export BOXEL_DECK_COLLABORATION_ENABLED=true
export BOXEL_DECK_COLLABORATION_REALM_RRIS=@cardstack/pretui/
```

The Host flag only boots the client path. Realm Server checks the exact package
RRI and advertises an authenticated capability. A browser, realm, or fixture
cannot opt an unlisted package into the pilot.

## Replay the canonical slice

The manifest pins PretUI commit
`cc76dac479c1fc6e2fbfb07db7187eb38e00b378`. From the Boxel checkout:

```sh
cd packages/realm-server
REALM_DIR="$(mktemp -d /tmp/boxel-pretui-known-date.XXXXXX)"
export BOXEL_DECK_COLLABORATION_ENABLED=true
export BOXEL_DECK_COLLABORATION_REALM_RRIS=@cardstack/pretui/
mise exec -- pnpm fixture:pretui-known-date -- \
  "$REALM_DIR" /Users/chris/Projects/pretui
```

The replay takes the real Known Date implementation, focused test, catalog
metadata, theme, original demo, and component definition. Every reviewed source
root is preserved under `_source/`, while the runtime package remains a narrow
vertical slice instead of vendoring PretUI's full catalog.

Three transformations are explicit in the generated provenance:

1. adapt the implementation's shared `Input` seam to a narrow local input;
2. generate a deterministic, visible Known Date demo; and
3. generate a narrow catalog card definition.

Unresolved imports fail the replay. Closure growth beyond the manifest's
reviewed file cap also fails, so upstream changes cannot silently enlarge the
vendored boundary.

For the pinned input, the stable outputs are:

```text
Version     @cardstack/pretui@0.4.0/
tree        6a0355389fc297f052c16f42a9bb2820ca0974c8b659443b18bb448cb06b5f8c
index       cd2b56bda725f91e6543a399508f3e170381cda5a65183aad63e0628ef4ad2d4
Checkpoint  ad36bca9ebff6547b37266f9273f7ba796d363de8f390c09db84ecf9d5b5d22c
catalog     @cardstack/pretui@0.4.0/PretuiComponent/knowndate
```

## Resolve intent, retain exact identity

Once the generated directory is mounted as the mutable PretUI realm, a catalog
can select an exact Version from semver intent:

```text
GET <pretui-realm>/.deck/versions?spec=%5E0.4.0&q=known%20date
```

The response includes the requested range, selected exact Version, tree hash,
index hash, and matching cards addressed by exact RRI. The range response is
private `no-store`, because a later publish can change its selection.

The selected snapshot is immutable:

```text
GET <realm-server>/cardstack/pretui@0.4.0/.deck/index?q=known%20date
```

That response uses immutable caching subject to the realm's read policy. Its
snapshot is stored once at
`.deck/indexes/versions/<tree-hash>.json`; the index references the CAS Version
and never copies the package tree.

Focused verification:

```sh
cd packages/realm-server
mise exec -- pnpm lint
MATRIX_REGISTRATION_SHARED_SECRET=xxxx \
  TEST_FILES=deck-version-serving-test,deck-version-index-test \
  mise exec -- pnpm test
```
