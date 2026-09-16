# Testing and operating Lattice

Lattice is opt-in materialized card data. Start with a disposable realm and the
synthetic tests below. The browser keeps the existing card templates and editors;
the server publishes computed data at the owning card's identity.

This draft includes the Node/BXL path, but enabling a realm does not authorize
Node execution. An operator review is a separate, optional step. See the
[architecture](lattice-architecture.md) and [author guide](lattice-authoring.md).

## Prerequisites and the executable example

Follow the repository [setup](../README.md#setup), with Docker running. From the
repository root:

```sh
mise install
mise exec -- pnpm install
mise exec -- pnpm --dir packages/host build
mise run test-services:realm-server
```

Leave the services running. They provide the host assets, base realm, indexed
`node-test` realm, PostgreSQL, Matrix, icons and SMTP. The ordinary fixed-port
configuration uses HTTPS on ports 4201 and 4202; environment mode derives its
URLs from `BOXEL_ENVIRONMENT`. Use the same environment in the test terminal.
Do not start a second service stack on ports already in use.

In another terminal, from the repository root:

```sh
mise exec -- env -u LATTICE_ENABLED_REALMS -u LATTICE_NATIVE_REVIEW_FILE \
  TEST_FILES=lattice-opt-in-test,lattice-read-opt-in-test,lattice-two-store-publication-test \
  pnpm --dir packages/realm-server test > /tmp/lattice-acceptance.log 2>&1
```

The tests enable their own synthetic realms explicitly; they do not enable your
development realms. Read the final pass/fail counts in the retained log. A test
startup failure or timeout is not a passing result.

The [two-store fixture](../packages/realm-server/tests/lattice-two-store-publication-test.ts)
creates an Observation feeder and Day summary, installs a test-owned review of
their real definitions, and opens two headless browser contexts using the normal
CLI login and Store. It checks:

- Both contexts initially display count **1** and total **5**.
- Posting the second observation changes both to count **2**, total **13**,
  and two complete observation rows.
- The existing card and DOM identities survive. The first client's delegated
  editor retains its unsaved text, focus and selection.
- Subsequent updates, retained-link behaviour and guarded delivery remain
  correct; a count changing by itself is insufficient.

This is an executable correctness example, not a persistent demo realm or a
performance comparison. Its review helper is test infrastructure, not an
operator tool for approving arbitrary applications.

## Enable a realm

Set the same exact-root allow-list on the realm server and its worker processes:

```sh
export LATTICE_ENABLED_REALMS='["https://localhost:4201/experiments/"]'
```

Replace that example with the canonical URL of your disposable realm. The value
is a JSON array, not comma-separated text. Include the trailing slash; no wildcard,
query, fragment or URL credentials are accepted. A missing value, empty string or
`[]` disables Lattice. Request headers and authored cards cannot enable it.

Restart your owned server and worker processes to apply configuration. Use the
normal indexing operation for the realm after installing an owner definition.
Allow the initial index and publication to finish before evaluating the example;
opening before initial indexing completes is outside this draft's acceptance.

Declare `static materialized = true` on the owner. The [author guide's example](lattice-authoring.md#query-and-computation-declarations)
shows `static queryInputs` and the equivalent direct-link `static linkInputs`
contract. Unsupported JavaScript or projections do not acquire native permission
from those declarations. Preserve the original templates and delegated editors.

Read a card through the normal endpoint with `Accept: application/vnd.card+json`.
For a ready publication, inspect `data.meta.publication`: `state`,
`validatedThrough`, `outputRevision` and `definitionRevision`. Do not copy that
server receipt into source JSON. Edit a feeder through the ordinary save path and
observe the same owner in two browser sessions.

## Pending, failure and diagnosis

`publicationState` distinguishes pending and ready on the card model. A pending
owner may retain its previous published value while the next revision is computed.
Pending is not confirmation that the current source is reflected in the display.
There is no deadline-based local-assembly fallback in this draft.

The current UI does not expose every withholding reason. An operator can inspect
the existing failure record in the realm's database without reading card bodies:

```sql
SELECT o.owner_url, o.dirty_generation, o.published_generation,
       f.attempts, f.reason
FROM lattice_owners o
LEFT JOIN lattice_work_failures f
  ON f.realm_url = o.realm_url AND f.owner_url = o.owner_url
WHERE o.realm_url = 'https://localhost:4201/experiments/'
  AND o.retired = FALSE;
```

A pending owner without a failure row may simply be queued or processing. A
failure row records an attempted obligation; compare it with the current owner
generation before attributing a later pending update to that failure. Inspect
the corresponding worker log and job result. Do not clear dirty state or edit
publication receipts to make the display appear ready.

Enabled source indexing refuses a batch that would exceed **100,000 pending
index events per realm**. It rolls back that source promotion rather than
dropping invalidations. Restore processing of pending materializations, then
retry indexing. This is a row bound, not a byte limit or a guarantee that one
import of more than 100,000 changes can be admitted.

## Optional Node/BXL execution

The operator supplies an absolute `LATTICE_NATIVE_REVIEW_FILE` path and a matching
`LATTICE_NATIVE_RUNTIME_REVISION` to the indexing workers, alongside the realm
allow-list. The file is a JSON array of 1–32 policies, at most 1 MiB. Every policy's
runtime revision must equal the configured revision. The
[policy type](../packages/realm-server/lib/lattice-postgres-admission.ts) defines:

| Review entry                       | Required evidence                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `realmURL`, `actorUserId`, `roots` | Exact realm, authorized input reader and explicitly reviewed exported definitions.                                         |
| `runtimeRevision`                  | The operator's identity for the deployed computation runtime.                                                              |
| `modules`                          | Module URL, resolved realm, public or actor-scoped cache identity, source path and MD5 matching the stored source receipt. |
| `definitions`                      | Exported code reference, module URL, exact cached definition key and SHA-256 from `latticeDefinitionDigest`.               |
| `noScreenshotThumbnail: true`      | Acceptance that this data producer supplies no screenshot-derived thumbnail.                                               |

Review the complete data computation/constructor/default closure, including the
trusted field implementations. Use the indexed, authorized `modules` entries and
the corresponding `realm_file_meta` receipts; do not invent hashes or repair
missing receipts with SQL. The digest function hashes the complete canonical
definition, not an arbitrary JSON serialization. `codeLinking` and
`fileExtractors` are additional explicit capabilities, not required defaults.

Automatic review generation and renewal after module edits are not included.
Absent or stale definition/source evidence cannot authorize Node work. The
worker either declines native admission or rejects obsolete work; inspect the
reported reason before re-reviewing. A missing review does not make a native-only
application safe for the Chrome path.

Declare `static linkInputs` for every link read by a native computation, including
nested reads. If an ordinary source card's native attempt rejects an undeclared
input or unsupported computed output, indexing falls back to the existing Chrome
producer. No partial native result is published. Materialized owners retain their
input-snapshot guards; cancellation, obsolete work and admission failures are not
converted into this fallback.

The in-repo admission and parity checks are runnable separately:

```sh
mise exec -- env -u LATTICE_ENABLED_REALMS -u LATTICE_NATIVE_REVIEW_FILE \
  TEST_FILES=lattice-postgres-admission-test,lattice-native-browser-parity-test \
  pnpm --dir packages/realm-server test > /tmp/lattice-native-checks.log 2>&1
```

These exercise captured/reviewed synthetic definitions. They do not prove that a
hand-written policy for another realm is complete. A fresh-realm operator review
walkthrough and its production-worker proof remain a release gate; do not use
this section as evidence that gate has passed.

## Disable and report

Remove the realm from `LATTICE_ENABLED_REALMS` on both server and workers, remove
its optional native review, then restart those owned processes. Ordinary reads
and indexing resume. Disabling does not delete authored data or Lattice tables,
nor does it mark outstanding obligations complete. Keep definitions valid on the
ordinary path when planning a flag rollback; a native-only port needs its
compatible definition restored too. No schema downgrade is required to disable.

Report a finding with commit, enabled realm, save/card URL, expected and actual
value, publication revisions, pending/failure reason, related job ID and worker
log excerpts. Include full test log paths and counts. Redact authentication
material and use synthetic record contents. Record whether it blocks testing the
draft; optional optimizations belong in the deferred ledger.
