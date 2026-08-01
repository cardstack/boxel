# Boxel realm policy mediation: recommended experiment

Status: design proposal, 2026-07-27

## Recommendation

Make policy mediation part of the Boxel Realm server's normal request path,
not a separate redaction service. Every request should produce the same trusted
subject and pass through the same active policy bundle, whether the caller is:

- a realm owner or administrator;
- an authenticated member with partial access;
- a member of another trusted realm;
- an anonymous public guest with no Boxel identity; or
- a service principal running projection or indexing work.

Use one policy model for reads, searches, writes, and commands. Reuse named
groups, grants, row predicates, and transforms across those operations, but do
not require one BXL expression to do every job. A policy bundle should contain
small expressions with distinct contracts:

- **grant**: may this subject attempt this operation?
- **where**: which records are visible to the subject?
- **view**: what does one visible record look like?
- **authorize**: may this write or command occur?
- **transition/normalize**: what trusted value is written or passed onward?

Prepare these programs once per active policy version and effective audience.
Run the same prepared view either on demand or while materializing a reusable
view. The execution strategy may change; the security semantics must not.

## Why this should live inside the Realm server

Today the Realm server decides whether a request needs `read`, `write`, or
`realm-owner` before it dispatches to card, source, search, or HTML handling.
Policy mediation should become the more expressive form of that decision.
Traditional realm permissions can remain as bootstrap and administration
permissions, and can generate compatibility groups, but should not be the
final content-authorization model.

Embedding mediation gives the server control of every potentially revealing
surface:

- card JSON and card-instance JSON source;
- search membership, ordering, counts, and facets;
- relationships and `included` resources;
- prerendered HTML, markdown, CSS, and render metadata;
- writes, patches, atomic operations, and commands;
- cache keys, ETags, invalidation, and audit events.

A proxy outside the Realm server would need to duplicate all of these rules
and would remain vulnerable whenever a new endpoint bypassed it.

Keep a small bootstrap management plane outside content policy: realm owners
must always be able to inspect, validate, activate, and recover policy bundles.
Content policy must not be able to grant realm ownership or remove the last
owner's ability to repair a broken policy.

For migration, synthesize system groups from existing permissions:

- `realm-owner` and `realm-writer` receive the canonical identity view and the
  corresponding mutation rules;
- `realm-reader` receives the canonical identity view for reads;
- `public` represents the existing `*` read permission.

A generated compatibility bundle can reproduce today's behavior exactly.
Realms can then replace its content rules incrementally while the underlying
owner permission remains the administrative recovery mechanism.

## One trusted subject for everyone

The Realm server should normalize authentication, realm membership, seats, and
groups into a bounded JSON value before BXL runs:

```ts
interface PolicySubject {
  kind: 'anonymous' | 'user' | 'service';
  userId: string | null;
  groups: string[];
  roles: string[];
  realmMemberships: Array<{
    realm: string;
    permissions: string[];
    seats: string[];
  }>;
  authentication: {
    level: 'none' | 'session' | 'service';
  };
}
```

An anonymous request receives `kind: anonymous`, `userId: null`, and system
groups such as `public` and `guest`. It runs through the same planner as an
authenticated request. Rate limiting, abuse detection, and any anonymous
privacy budget remain host responsibilities; they should not be presented to
BXL as trustworthy identity claims.

The subject resolver must never accept groups supplied by the client. A realm
policy names the realms and membership providers it trusts. A user-controlled
realm must not be able to manufacture an `administrator` or `registrar` seat.

### Group cards

Groups should be realm-owned policy data. A group can initially contain:

- explicit Boxel user IDs;
- holders of a permission in a named trusted realm;
- holders of a seat or role in a named trusted realm;
- the anonymous/public subject; or
- another group, once cycle detection and bounded expansion exist.

Resolve group membership outside BXL and pass the resulting group IDs into the
subject. BXL remains a pure decision and transformation language; it does not
perform network or realm lookups.

The first version should support explicit members, trusted realm permissions,
trusted realm seats, and the public group. Nested and computed groups can wait.

## Policy bundle shape

The following shape is illustrative. The important part is the separation of
named audiences, views, and operation attachments.

```yaml
kind: RealmPolicyBundle
version: 1
status: active

trustedEntitlementRealms:
  - https://example.edu/students/
  - https://example.edu/staff/

groups:
  public:
    anonymous: true

  student:
    realmSeat:
      realm: https://example.edu/students/
      seat: student

  faculty:
    realmSeat:
      realm: https://example.edu/staff/
      seat: faculty

  registrar:
    members:
      - '@registrar:example.edu'

audiences:
  public-directory:
    priority: 10
    grant: '.subject.groups | any(. == "public")'

  student-directory:
    priority: 20
    grant: '.subject.groups | any(. == "student")'

  faculty-directory:
    priority: 30
    grant: '.subject.groups | any(. == "faculty")'

  registrar-full:
    priority: 100
    grant: '.subject.groups | any(. == "registrar")'

views:
  directory-student:
    jq: |
      {
        type: .record.type,
        id: .record.id,
        attributes: {
          displayName: .record.attributes.fullName,
          program: .record.attributes.program,
          year: .record.attributes.year,
          completedCredits:
            ([.record.attributes.courses[].credits] | add // 0)
        }
      }

  full-student:
    jq: '.record'

operations:
  readCard:
    - audience: registrar-full
      where: 'true'
      view: full-student
    - audience: student-directory
      where: '.attributes.directoryOptIn == true'
      view: directory-student
    - audience: public-directory
      where: '.attributes.publicListing == true'
      view: directory-student

  search:
    - audience: student-directory
      where: '.attributes.directoryOptIn == true'
      view: directory-student
      aggregatePrivacy:
        minimumCohort: 5
        suppressSmallFacetCells: true
        complementarySuppression: true
        roundCountsTo: 5

  writeCard:
    - audience: registrar-full
      authorize: 'true'
    - audience: student-directory
      authorize: >
        .record.id == .proposed.id
        and (.changed | all(. == "directoryOptIn" or . == "preferredName"))

  command:
    update-directory-preferences:
      - audience: student-directory
        authorize: '.args.studentId == .subject.userId'
```

Executable policies should be stored canonically as raw jq. An authoring UI
may use readable BXL and compile it to canonical jq before activation.

## The policy request envelope

All operations should receive the same outer shape, with irrelevant members
omitted:

```ts
interface PolicyEnvelope {
  subject: PolicySubject;
  request: {
    operation: string;
    method: string;
    realm: string;
    resource?: string;
    receivedAt: string;
  };
  record?: unknown;
  proposed?: unknown;
  changed?: string[];
  command?: string;
  args?: unknown;
  query?: unknown;
}
```

Time, identity, group membership, resource generation, and command identity are
host-supplied facts. BXL cannot fetch or manufacture them.

## A unified compiled plan

For each operation, the Realm server resolves a plan:

```text
subject
  -> group resolution
  -> highest-priority matching audience/grant
  -> row predicate
  -> view or write/command rule
  -> response or mutation sink
```

The prepared-plan cache key should include:

```text
realm URL
+ policy bundle ID and active content hash
+ audience ID
+ operation
+ view ID
+ schema/index-layout version
+ BXL runtime version
```

Do not normally include a user ID. Membership selects a low-cardinality
audience, so thousands of users can reuse one prepared program and one
materialized view. If a transform truly depends on user-specific values, mark
it non-shareable and include a subject fingerprint in its private cache key.

Choose one audience per operation in the first version. If several grants
match, the highest explicit priority wins; equal-priority matches make policy
activation fail. Do not implicitly union fields from several views. Authors
can define a named composite audience when combined access is intentional.

Audience grants and view transforms receive the full policy envelope. A
query-time `where` predicate instead receives the candidate record as `.` plus
trusted context parameters. Keeping the row at the root matches query-engine
storage and makes SQL lowering straightforward.

The current BXL split is sufficient for an initial experiment:

- audience grants and write/command authorization use `policy`;
- search membership uses `predicate` and should lower to the query engine;
- audience-specific JSON views use raw-jq `derive` and do not inspect the
  current subject.

This avoids creating a new profile immediately. A future `disclosure` profile
is warranted only if real policies require one transformation to combine
request identity with record-local aggregation.

## Hybrid execution: proxy rarely, materialize commonly

The same compiled view should support three sinks.

### On-demand response sink

Use this for rare requests, new policies, low-traffic audiences, or views with
high cardinality:

```text
authorized index row
  -> prepared jq view
  -> schema validation
  -> response builder
```

This spends CPU only when requested. It should buffer one bounded search page
before sending it, so a transform failure cannot produce a partial security
response.

### Internal materialized-view sink

Use this for known roles and frequent card, search, or HTML reads:

```text
source change
  -> prepared jq view for each affected audience
  -> policy_views row
  -> policy_search row
  -> policy_prerender row
```

The view key should be:

```text
source URL
+ source generation
+ policy hash
+ audience
+ operation
+ render format/render type when applicable
```

This is not necessarily a user-visible realm. It can be an internal Realm
server index used to serve policy-mediated requests efficiently.

### Projection-realm sink

Use the same view to publish declassified cards into another realm:

```text
source change
  -> prepared jq view
  -> output schema validation
  -> deterministic destination identity
  -> target realm upsert or tombstone
```

This is a stronger release of information: the copied card adopts the target
realm's permissions. Policy tightening must therefore reconcile or hide stale
projection data, not merely invalidate an internal cache.

### Choosing automatically

Start each new audience/view on demand. Collect safe operational telemetry:
request frequency, transformation cost, output size, and cache hit rate. Move
a view to materialization after it crosses configurable thresholds. The policy
can override this with `always`, `never`, or `auto`, but the output must remain
identical in either mode.

A parity test should run every materialized plan through both paths and require
the same canonical JSON result.

## Search must be policy-native

Search leaks more than returned card fields. Membership, total counts, facet
counts, snippets, relevance, ordering, and the existence of linked resources
can all disclose sensitive information.

The secure order is:

```text
ordinary query
  -> policy row predicate
  -> safe search corpus
  -> ordering
  -> aggregate privacy
  -> pagination
  -> view transform
  -> response
```

The `where` predicate must run before counting and pagination. The view
transform must not suppress rows after pagination. Zero output from a view is
an error, not an alternative filtering mechanism.

For a common audience, full-text search, snippets, and facets should read from
the audience's materialized safe search document. Searching private markdown
and then redacting the returned card is not safe: match/no-match and ranking
would still reveal private text.

### Counts and facets

Anonymous or restricted audiences need aggregate privacy applied by the host,
even when BXL performs record-local rollups. Do not rely on each policy author
to remember the statistical rules.

The first host-enforced controls should be:

- **minimum cohort (`k`)**: suppress an exact count or facet cell below `k`;
- **complementary suppression**: suppress another cell when one hidden cell
  could be recovered by subtraction from the total;
- **count rounding**: optionally round exposed counts to a configured base;
- **bounded facets**: cap the number of facet dimensions and returned buckets;
- **safe totals**: mark a total as suppressed instead of returning a misleading
  zero;
- **query-rate controls**: prevent an anonymous caller from differencing many
  nearly identical queries quickly.

Example response metadata:

```json
{
  "meta": {
    "page": {
      "total": null,
      "totalStatus": "suppressed",
      "minimumCohort": 5
    },
    "facets": {
      "program": [
        { "value": "Physics", "count": 25 },
        { "value": "History", "count": null, "status": "suppressed" }
      ]
    }
  }
}
```

Rounding and small-cell suppression are a starting point, not a complete
privacy proof. Repeated-query differencing, overlapping cohorts, and correlated
facets may require privacy budgets or differential privacy later. Keep that
logic in a host-owned aggregate-privacy layer so it can improve without
rewriting every policy.

## Reads, relationships, source, and HTML

### Card JSON

Transform a canonical indexed resource, validate the output, and let the Realm
server reconstruct reserved JSON:API metadata. A policy view should not be
allowed to rewrite realm identity, source generation, cache controls, or audit
fields.

### Relationships and `included`

Never retain the source document's `included` array after transforming only
the primary card. Policies must explicitly disclose relationships. The server
should rebuild `included` from mediated linked resources, initially with a
maximum depth of one and strict size limits.

### Source

JSON card-instance source can be parsed, mediated as JSON, and serialized.
GTS/JavaScript module source cannot be securely field-redacted by a JSON
transform. Treat module source as whole-file allow or deny in the first model.

### Prerendered HTML

Never reuse HTML rendered from the unrestricted card. Render from the mediated
JSON view and ensure the render environment cannot fetch the original card or
follow undisclosed links under stronger authority. Cache the result by source
generation, policy hash, audience, format, and render type.

Public/anonymous view artifacts may use public caching when the policy allows
it. Authenticated group views remain private even when many members share the
same internal artifact.

## Writes and commands use the same policy bundle

Mediated users should not receive a general realm `write` token. The normal
write and command paths should assemble the policy envelope and authorize the
specific operation.

A write pipeline is:

```text
authenticate/normalize subject
  -> resolve groups and audience
  -> load current canonical record
  -> calculate changed fields
  -> evaluate authorize rule
  -> optional normalization/transition
  -> schema and invariant validation
  -> optimistic concurrency check
  -> atomic persistence
  -> audit decision
```

A command pipeline is similar:

```text
authorize named command and arguments
  -> invoke host-owned command implementation
  -> apply the same write policy to resulting mutations
```

BXL authorizes and transforms values; it does not call commands, perform I/O,
or make persistence atomic. The host remains responsible for command lookup,
idempotency, transactionality, clocks, and side effects.

Named audiences and reusable conditions keep read and write semantics aligned.
For example, the `student-directory` audience may read the directory view and
write only `preferredName` and `directoryOptIn`, while `registrar-full` reads
and writes the canonical record.

## Streaming and memory model

Treat one card/search row as the streaming unit:

```text
database cursor
  -> one materialized row
  -> one prepared jq evaluation
  -> bounded output
  -> page builder, cache writer, or projection batch
```

This provides constant-memory projection across a realm and bounded-memory
request processing. It does not require jq token-stream programs. Standard
JSON:API search responses can buffer one policy-bounded page so `included`,
metadata, and failure behavior remain atomic. A future bulk endpoint can use
NDJSON for true HTTP streaming and backpressure.

## Activation, invalidation, and failure semantics

Policy changes are security changes and need a stricter lifecycle than normal
content:

```text
draft
  -> parse/profile/schema validation
  -> fixture and noninterference tests
  -> compile all plans
  -> atomically activate content hash
  -> deny stale hashes immediately
  -> rebuild materialized views and prerenders
```

Do not silently retain the last-known-good permissive policy after an invalid
attempted tightening. Keep the old policy active only until an explicit atomic
activation; once a new version activates, stale policy artifacts must stop
serving immediately.

Runtime rules:

- no matching policy means deny;
- grant errors mean deny;
- predicate compilation errors prevent activation;
- a view must emit exactly one bounded object per visible row;
- any row transformation failure fails the whole mediated HTTP response;
- projection batches checkpoint and retry, but must not publish partial
  restrictive-policy activation as complete;
- logs contain decision metadata, never unrestricted bodies.

## BXL requirements for the experiment

Use canonical raw jq with readable syntax disabled. Restricting storage to jq
keeps policies portable to a future native, WASM, `jaq`, or statically compiled
runtime while preserving the current prepared evaluator.

Add a security-facing preparation API or adapter that:

- validates the expected profile for each policy slot;
- pins an audited jq builtin manifest;
- rejects `def`, recursion, assignment, `try/catch`, debug/runtime metadata,
  and unbounded output where the slot does not permit them;
- enforces steps, time, output count, and output byte limits;
- exposes root dependencies for sparse index retrieval;
- supports cancellation and an `AsyncIterable` row adapter;
- returns structured activation and runtime diagnostics.

Before treating `runtime-bare` as the security runtime, verify its jq-core
builtin inventory. The current build does not expose every expected jq helper
when formula libraries are disabled, so the allowed dialect needs an explicit
tested manifest rather than an assumption that “bare” means complete jq.

## What to try first

Build one feature-flagged vertical slice in the Realm server around a student
records realm. Do not begin with every endpoint.

### Subjects and groups

Create four subjects:

- anonymous public guest;
- student realm member;
- faculty realm member;
- registrar administrator.

Resolve their groups from one trusted membership realm plus explicit policy
members. Include membership removal and policy revocation in the fixtures.

### Policy operations

Implement these operations through one bundle:

1. `readCard` for one student record;
2. `search` with directory membership, one facet, and protected totals;
3. `writeCard` for a student updating directory preferences;
4. one `update-directory-preferences` command;
5. one projection of the same directory view into a directory realm.

Start all reads on demand. Once correctness is established, materialize the
student and public directory views and require byte-equivalent canonical JSON
between the on-demand and materialized paths.

### Delay deliberately

Do not include these in the first experiment:

- arbitrary per-user view transforms;
- nested groups;
- multi-hop relationship disclosure;
- redacted GTS/module source;
- differential privacy noise;
- every HTML render format;
- cross-server policy federation.

### Success criteria

The experiment succeeds when:

- anonymous and authenticated callers traverse the same policy planner;
- no caller needs ordinary realm `read` or `write` to use mediated operations;
- filtering happens before totals, facets, sorting, and pagination;
- small cohorts and complementary facet cells are suppressed;
- the same named groups and rules govern reads, writes, and the command;
- on-demand and materialized results are canonically identical;
- policy activation and membership revocation prevent stale cache hits;
- no original `included`, source HTML, markdown, or search text leaks through;
- a failed transform yields no partial HTTP response;
- projection memory stays bounded across a realm-sized cursor;
- audit events explain the policy version, audience, operation, and outcome
  without recording sensitive values.

## Expected architecture after the experiment

If the vertical slice works, the lasting Realm server components are likely:

```text
SubjectResolver
GroupResolver
RealmPolicyLoader
PolicyCompiler
PreparedPlanCache
PolicyQueryPlanner
PolicyViewEvaluator
AggregatePrivacyGuard
MaterializedViewStore
PolicyPrerenderStore
PolicyAuditSink
```

The central abstraction is a policy-selected JSON view. Reads return it,
search indexes it, HTML renders it, projections copy it, and writes/commands
use the same subject and group vocabulary to decide which mutations are
allowed. That is the consistency worth testing first.

## Interactive policy lab

The repository includes a browser harness for this proposal:

```sh
npm run demo:policy
```

It uses synthetic student records and prepared raw-jq programs to exercise
anonymous and group-mediated card reads, protected search counts and facets,
student and faculty writes, named command authorization, materialized audience
views, and projection into a directory realm. The UI exposes the trusted
subject, selected audience, execution strategy, decision trace, canonical
input, mediated output, removed fields, aggregate privacy decisions, and the
compiled jq for every program that ran.
