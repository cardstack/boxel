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

For a worker-manager deployment, include `--userIndexCount 1 --latticeCount 1
--allPriorityCount 1` alongside its existing connection and URL-mapping options.
These existing pool settings reserve separate source-index and materialization
workers while background HTML continues on the all-priority worker. A single
shared worker can still be occupied by a realm-wide HTML job. Enabled background
renders stay below owner computation in Chrome admission even if a source edit
arrives after the HTML job starts; an active render finishes before a queued
owner can take its slot. Renders explicitly awaited by a realm publish retain
their existing priority. This is not a latency guarantee.

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

### Prepare and verify a review

1. Index the disposable realm normally, with its Lattice flag enabled and no
   native review installed. Read the owner until `meta.publication.state` is
   `ready`. Both the application and its reviewed base modules need actual
   indexed source receipts and cached definitions in the worker's database.
2. Review the source of each data implementation in the closure. For the
   [Day/Observation example](../packages/realm-server/tests/helpers/lattice-parity-fixture.ts),
   this includes `cards.gts`, base `card-api.gts`, base `number.gts` and base
   `string.ts`. The string module is a re-export; its cached module URL can end
   in `.gts` even though the source receipt names `string.ts`. Use the stored
   identities, rather than guessing a source path from a module URL.
3. With the worker's ordinary `PGHOST`, `PGPORT`, `PGUSER` and `PGDATABASE`
   configuration, inspect each reviewed module using the read-only command
   below. Set the three review variables to that module's exact identities.
   Passing the connection variables after `mise exec` preserves your selected
   database if mise also configures development defaults. The output is
   inventory for review, not permission to execute code.

```sh
cd packages/realm-server
export LATTICE_REVIEW_MODULE_URL='https://example.test/demo/cards.gts'
export LATTICE_REVIEW_SOURCE_REALM='https://example.test/demo/'
export LATTICE_REVIEW_SOURCE_PATH='cards.gts'
mise exec -- env PGHOST="$PGHOST" PGPORT="$PGPORT" PGUSER="$PGUSER" \
  PGDATABASE="$PGDATABASE" pnpm exec node --input-type=module <<'JS'
import { PgAdapter } from '@cardstack/postgres';
import { latticeDefinitionDigest } from './lib/lattice-postgres-admission.ts';
const db = new PgAdapter({ autoMigrate: false });
const url = process.env.LATTICE_REVIEW_MODULE_URL;
const realm = process.env.LATTICE_REVIEW_SOURCE_REALM;
const path = process.env.LATTICE_REVIEW_SOURCE_PATH;
try {
  const modules = await db.execute(
    `SELECT cache_scope,auth_user_id,definitions FROM modules
     WHERE url=$1 AND resolved_realm_url=$2 AND error_doc IS NULL`,
    { bind: [url, realm] },
  );
  const files = await db.execute(
    `SELECT file_path,content_hash,content_size FROM realm_file_meta
     WHERE realm_url=$1 AND file_path=$2`, { bind: [realm, path] },
  );
  const grants = await db.execute(
    'SELECT username,read FROM realm_user_permissions WHERE realm_url=$1',
    { bind: [realm] },
  );
  const registry = await db.execute(
    'SELECT kind FROM realm_registry WHERE url=$1', { bind: [realm] },
  );
  const metadata = await db.execute(
    'SELECT archived_at FROM realm_metadata WHERE url=$1', { bind: [realm] },
  );
  console.log(JSON.stringify({ url, realm, files, grants, registry, metadata,
    scopes: modules.map(({ definitions, ...scope }) => ({ ...scope,
      definitions: Object.entries(definitions ?? {})
        .filter(([, entry]) => entry.type === 'definition')
        .map(([cacheKey, entry]) => ({ cacheKey, codeRef: entry.definition.codeRef,
          definitionSHA256: latticeDefinitionDigest(entry.definition) })),
    })),
  }, null, 2));
} finally { await db.close(); }
JS
```

4. Write the JSON array of policies from the reviewed inventory. A module entry
   uses `url`, `realmURL`, `cacheScope`, `authUserId`, `sourcePath` and
   `sourceMD5` (the stored `content_hash`). A definition entry uses `codeRef`,
   `moduleURL`, `cacheKey` and `definitionSHA256`. Select the authorized public
   scope (`authUserId: ""` and a public read grant) or the policy actor's own
   private scope. Do not copy another actor's cache identity. Include the
   reviewed exported roots, `actorUserId`, `runtimeRevision` and
   `noScreenshotThumbnail: true` as shown by the policy type above.
5. Set `LATTICE_NATIVE_REVIEW_FILE` to that absolute file path and
   `LATTICE_NATIVE_RUNTIME_REVISION` to the same deployed-runtime identity.
   Set `LATTICE_NATIVE_ADMISSION_DEBUG=1` during verification. Restart the owned
   indexing workers with this configuration and the same realm allow-list;
   the review file is read at worker startup. Updating the file alone does not
   renew a running worker's authority.
6. Post an ordinary feeder edit. In the example, changing Observation/two to
   `status: "done"` and one rating with `points: 8` changes Day/blue from count
   **1**, total **5** to count **2**, total **13**. Require a ready publication
   and complete selected IDs. Verify execution using the worker PID in its log
   and the stored data diagnostics, not just the displayed value:

```sql
SELECT url, diagnostics->>'latticeNative' AS native
FROM boxel_index
WHERE type='instance' AND url IN (
  'https://example.test/demo/Observation/two.json',
  'https://example.test/demo/Day/blue.json'
);
```

Both rows must say `true`. HTML may still render in Chrome; this identifies the
data producer. Bootstrap realms such as base need their existing registry row
and read grant, but do not need fabricated archive metadata. Source realms still
require active archive metadata. Publication locks and rechecks the relevant
authority, source bytes and definitions.

Finally, change the reviewed example's score expression to multiply its sum by
two without renewing the review. Require a native admission refusal. This
Chrome-compatible example then reaches total **26** through Chrome, with no
native data diagnostic on the new owner row. A correct-looking value alone does
not prove native execution. Re-review changed definitions before installing a
new policy; never update pinned hashes merely to silence a refusal.

During Chrome materialization, a computed JSON value that still contains live
card instances refuses with `Lattice output contains a live card` and its field
path. The owner stays pending; no empty-object output is published. Project the
needed data explicitly, for example `{ rows: [.entries[] | { amount: .amount }] }`
instead of `{ rows: .entries }`. Valid projections work without native review.
The focused regression is `TEST_FILES=lattice-native-port-refusal-test`.

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

These exercise captured/reviewed synthetic definitions. The fresh-realm operator
walkthrough also passed using real indexed base/application receipts and the
production worker: native feeder/owner total **13**, then stale-review refusal
and Chrome total **26** after a code change. It did not fabricate admission
receipts or activate automatic renewal. This does not prove that a hand-written
policy for another realm is complete, or establish a latency target.

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
