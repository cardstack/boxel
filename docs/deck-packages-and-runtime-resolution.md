# Deck packages and dynamic RRI resolution

Boxel treats a mutable realm as a package. The realm owns two conventional
documents with deliberately different jobs:

- `package.json` names the package, declares its entry point, and records
  dependency intent as semver ranges.
- `importmap.json` is the reproducible lock. Its values are exact, URL-free
  Realm Resource Identifiers (RRIs), such as
  `@northstar/operations-ui@3.4.2/components.gts`.

The range is what a person or dependency tool edits. The exact RRI is what a
Checkpoint, Review, Version, and running card can reproduce.

## Cold runtime discovery

Mappings are not compiled into the Host and a realm does not need a global
monorepo import map. Discovery happens at the network boundary:

1. A card document or module response identifies its mutable realm with
   `X-Boxel-Realm-Url`.
2. The Host reads `package.json` and `importmap.json` from that package root.
3. It installs the mutable package mapping, for example
   `@acme/relay/` to the Relay realm URL.
4. The package's top-level lock entries become a scope owned by that package
   root. They do not become global imports.
5. Exact dependency RRIs are projected to the realm server's canonical
   `/<scope>/<name>@<version>/<path>` transport only when fetched.
6. A dependency response repeats discovery for its own package and lock.

Card-document discovery happens before deserialization. This is important: a
cold card can contain `id: "@acme/relay/incident"` and an RRI-form
`meta.adoptsFrom` before its defining module has ever been requested.

Module discovery happens after a successful response and before the Loader
transpiles or evaluates it. Multiple exact Versions can therefore remain
resident at once when different importing packages carry different scopes.
Adding a newly discovered mapping preserves already evaluated modules;
replacing a lock or mapping invalidates the affected Loader baseline.

The realm-server query path applies the same identity rule. A root resource
stored as an RRI establishes its package-to-realm mapping before link
normalization, so server-produced card documents and the browser agree about
identity.

## Exact source and executable delivery

An exact Version is immutable, but callers still need two representations of
the same stored source:

- Module requests for `.gts`, `.gjs`, and `.ts` receive executable JavaScript.
- Requests with `Accept: application/vnd.card+source` receive the original
  bytes for inspection and editing tools.

Both are derived from the same realm-local CAS Version. Public Versions are
served with public immutable caching; private Versions retain realm read
authorization and private caching.

## Relay acceptance fixture

Relay is the A4 acceptance fixture: one visible incident application composed
from nine realms controlled by different parties. It covers a shared base card,
a UI component library, a theme, country/industry/carrier lookup data, a route
component, and a versioned agent skill. Relay's `package.json` uses semver
ranges while its `importmap.json` locks the exact runtime composition.

Replay it against an environment-mode realm server:

```sh
export BOXEL_DECK_COLLABORATION_ENABLED=true
export BOXEL_DECK_COLLABORATION_REALM_RRIS='@reliability/service-levels/,@northstar/operations-theme/,@northstar/operations-ui/,@global-standards/country-codes/,@industry-data/industry-codes/,@transit/carrier-codes/,@atlas/route-map/,@ops-skills/incident-triage/,@acme/relay/'

env PGPORT=5435 \
  PGDATABASE=boxel_deck_a4 \
  BOXEL_ENVIRONMENT=deck-a4 \
  pnpm --dir packages/realm-server fixture:relay
```

Use the same two exported pilot variables when starting Realm Server and Host.
The long allowlist is intentionally explicit and test-only; no client or
fixture can enable an unlisted realm.

Then open `https://host.deck-a4.localhost/`, choose
**Relay · Global Disruption Desk**, filter to **Relay Incident**, and open
**RLY-4821 · KUL → NRT**. The card shows the exact package versions at the
bottom; those labels are also an immediately visible assertion that the locked
composition loaded.

Focused checks:

```sh
cd packages/host
pnpm exec ember test --path dist --filter 'dynamic RRI resolution'
pnpm exec ember test --path dist --filter 'canonical RRI import map'

cd ../realm-server
MATRIX_REGISTRATION_SHARED_SECRET=xxxx \
  TEST_FILES=deck-version-serving-test pnpm test
```

## Current transport boundary

A4 assumes dependencies named by an exact RRI live on the same realm-server
origin under the canonical `/<scope>/<name>/` route. The canonical lock itself
contains no origin. A future cross-server package directory can change that
projection without changing package metadata, Checkpoints, Reviews, or the
Loader's scoped-lock model.
