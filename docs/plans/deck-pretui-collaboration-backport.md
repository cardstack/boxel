# PretUI-first Deck collaboration backport

**Status:** A0–A6 are implemented as a local, unpushed stack on 2026-08-23.
B0–B8 remain the execution plan for PretUI team collaboration. No pull request
or remote branch has been created from this stack.

## Target outcome

PretUI becomes the first production-shaped realm to use Deck collaboration.
Several teammates and coding agents can work against branches of the same
canonical PretUI realm, see live branch-specific catalog previews, recover
every accepted save, open an exact Review, and merge through the realm without
using GitHub as the collaboration authority.

The primary authoring tool is `@cardstack/boxel-cli`, normally driven by Claude
Code against a local materialization of one realm branch. GitHub may receive a
syndicated representation later; it is not the source of branch or Review
truth.

PretUI must also return approved work to the Boxel monorepo because Host code
outside a realm needs compile-time imports. That path is a deterministic
syndication of one exact PretUI Version into a generated Boxel workspace
package. It is not the daily branch loop and it is not `git push` masquerading
as protocol.

This is an internal PretUI pilot, not a general Boxel capability. Deck code may
land in the monorepo, but every externally observable Deck behavior is disabled
by default and is activated only when Realm Server both enables the pilot and
allowlists the canonical `@cardstack/pretui/` RRI. The existing behavior of all
other realms remains unchanged.

```text
Claude Code + boxel-cli
          │
          │ content-addressed sync against an exact branch head
          ▼
 @cardstack/pretui/:feature/date-picker
   source + exact lock + index + deckd History
          │
          ├── live catalog preview
          ├── exact Checkpoint → Review → merge to main
          │
          ▼
 @cardstack/pretui@<accepted-version>/
          │
          │ deterministic syndication
          ▼
 Boxel monorepo packages/pretui
   generated tree + provenance + Host consumer tests
```

## Why PretUI is the architecture fixture

The current PretUI checkout is already a serious Boxel realm: 788 tracked
files, about 370 top-level GTS modules, 142 GTS tests, 310 catalog cards, media
assets, composition studies, and several vendored browser runtimes. It is large
enough to expose false assumptions about copying, indexing, invalidation,
previewing, and merging.

The first fixture does not import that entire corpus. It extracts one real
vertical feature and its dependency closure: PretUI **Known Date**. That slice
is small enough to replay constantly but crosses component implementation,
shared controls, design tokens/theme, catalog metadata, interactive examples,
accessibility and parsing tests, and a downstream Host consumer. Full-PretUI
migration follows only after this slice proves the protocol.

Today it still has a Git-first transport shape:

- `realm.json` exists, but there is no root `package.json` or `importmap.json`;
- card modules still contain `https://cardstack.com/base/...` imports;
- `README.md` teaches `clone`, `push`, `pull`, and mtime-assisted `sync`;
- its GitHub repository is treated as the practical collaboration center.

The backport succeeds when the realm is canonical and Git becomes optional
syndication rather than required coordination.

## Product laws

1. **The realm is canonical.** PretUI branches, History, Checkpoints, Reviews,
   and merge live in the PretUI realm's `.deck/` state.
2. **A branch is a real view.** It has its own source head, exact composed lock,
   index generation, and deckd History. Browse, Run, catalog search, and tests
   select that view.
3. **Every accepted save is recoverable.** A CLI/watch write appends a History
   Step without asking the author to commit.
4. **Time is never causality.** File or server mtimes may optimize a local scan,
   but they never decide identity, freshness, conflict, or overwrite safety.
5. **Merge is server-side collaboration.** Local sync reconciles a materialized
   workspace with its selected branch. Review merge reconciles an exact source
   branch with an exact target branch.
6. **Branch preview is immediate.** It does not require exporting PretUI to the
   monorepo or deploying a Host build.
7. **Monorepo output is derived.** Host consumers receive a generated package
   from one exact accepted PretUI Version, with enough provenance to reproduce
   and verify it.
8. **No compatibility fork.** Once the new sync protocol lands, Boxel CLI uses
   the current content-addressed manifest and server contract only for an
   enabled realm. It does not fall back to mtime/Git-history inside the Deck
   path. Realms outside the pilot continue using Boxel's existing commands;
   that is product isolation, not a second implementation of this protocol.
9. **Activation is server-authoritative and deny-by-default.** A client flag,
   URL parameter, or locally edited workspace record cannot make a realm
   Deck-enabled. The feature gate grants no permissions: normal PretUI realm
   read, write, Review, and merge ACLs still apply.

## PretUI-only feature boundary

Use one generic pilot capability with a narrow allowlist so the architecture
can expand later without pretending it is generally available now. The
operator configuration is conceptually:

```text
BOXEL_DECK_COLLABORATION_ENABLED=true
BOXEL_DECK_COLLABORATION_REALM_RRIS=@cardstack/pretui/
```

The exact configuration parser and authenticated capability landed in A4. They
normalize and compare canonical RRIs, not transport URLs or substrings.
Production starts with the kill switch off everywhere except the internal
environment that serves PretUI.
Test environments may explicitly allowlist fixture RRIs such as Relay; fixtures
must never widen the production allowlist.

Realm Server is the authority and advertises an authenticated per-realm
`deckCollaboration` capability only when both configuration checks pass. Host's
existing `featureFlags` configuration can keep the pilot UI code off at build
or boot time, but the Host must also receive the server capability for the
selected realm before it renders or calls anything. Boxel CLI discovers the
server capability; it has no local environment variable that bypasses the
server.

| Surface                   | Disabled or wrong realm                                                                                                   | Enabled PretUI realm                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Realm Server              | Deck Version, branch, History, Checkpoint, Review, merge, and syndication endpoints are absent/404; no Deck writer starts | Advertises capability and mounts the authenticated Deck routes and services                      |
| Boxel CLI                 | Existing non-Deck realm workflow remains available; Deck branch commands fail closed with a precise unavailable message   | Uses only the current content-addressed branch protocol; never falls back to mtime or hidden Git |
| Host                      | No Deck discovery, adoption, branch, History, or Review affordances and no speculative Deck requests                      | Enables the relevant runtime path and renders only actions allowed by the realm ACL              |
| deckd / jobs / S3 writers | Not started or scheduled for the realm; no `.deck` collaboration state is mutated                                         | Scoped to the PretUI realm and its branches, with the same ACL and conditional-write rules       |
| Monorepo syndication      | Cannot export a realm merely because an operator has credentials                                                          | Accepts only an exact Version from an enabled, allowlisted PretUI realm                          |

Pure libraries and schemas may be present while the pilot is off. Presence is
not activation. For the A stack, A0's pure Core package and reusable RRI
primitives can remain inert, while A2 exact-Version routes, A3 adoption actions,
A4 runtime discovery, A5 Version queries, A6 syndication, and all B-series
collaboration surfaces obey the server capability. A3 supplies real adoption
services but deliberately adds no pilot UI. This gives the whole observable
system one kill switch without scattering PretUI-specific conditionals through
Deck Core.

## Hosted substrate: S3 Files plus direct S3

The hosted pilot uses S3 Files as a first-class durable distributed filesystem,
not merely as a deployment adapter. Realm Server, the indexer, agent jobs, and
deckd share the selected PretUI branch workspace through its POSIX/NFS surface.
Active filesystem writes have multi-AZ durability, and the bucket remains the
long-term persistence plane.

S3 Files is not the collaboration transaction manager. Filesystem exports to
the bucket are asynchronous, and AWS resolves a same-key filesystem/direct-S3
collision in favor of the bucket. Therefore each realm-contained prefix has
exactly one mutation path:

| Realm-contained state                                             | Writer                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------ |
| authored branch source                                            | the coordinated branch writer through S3 Files         |
| `.deck/history/repo`                                              | deckd through S3 Files, one writer per branch          |
| index staging                                                     | the selected index worker through S3 Files             |
| immutable CAS, completed indexes, Checkpoints, and Review objects | Realm Server through direct S3 create-if-absent writes |
| branch heads, publication refs, counters, and transaction records | Realm Server through direct S3 conditional writes      |

Agents can inspect the latter objects through the mounted realm, but their
POSIX principal cannot write those prefixes. A settled save uploads its exact
immutable objects and completed index through direct S3 before moving the
branch head with compare-and-swap, so correctness never waits for filesystem
export. S3 Versioning is enabled for recovery, but it is not Deck History.
Directory rename is not a protocol primitive, and S3 Files lost-and-found is
an operational alarm, not conflict resolution.

The Desktop backend implements the same object/ref/workspace contracts on an
ordinary filesystem. The Known Date replay must produce identical canonical
hashes locally and on the S3-backed pilot.

### Infrastructure is a required slice

The AWS proof includes reviewed infrastructure in `cardstack/infra`; it is not
complete when application tests pass against manually created resources. Keep
the existing Realm Server EFS mount for non-pilot realms. Add a second,
feature-gated S3 Files volume and route only the allowlisted PretUI realm to it.
The initial staging/internal environment enables this infrastructure;
production remains disabled until the pilot is approved.

Required infrastructure work:

1. Add `modules/aws/s3-files/` using a pinned AWS provider version that supports
   `aws_s3files_file_system`, mount targets, access points, filesystem policy,
   and synchronization configuration.
2. Provision a dedicated encrypted, private S3 bucket with Bucket Owner
   Enforced ownership, S3 Versioning, lifecycle/retention rules, and a KMS key.
   Protect the retained bucket from accidental Terraform destruction.
3. Scope the S3 file system to the internal PretUI realm prefix. Create one
   mount target in every Availability Zone used by Realm Server and an access
   point with the intended POSIX identity and realm root.
4. Extend `modules/aws/ecs/service` and `modules/aws/ecs/complete` to emit ECS's
   dedicated `s3files_volume_configuration`; do not pass an S3 Files ID through
   the existing EFS volume field.
5. Wire the optional volume into
   `configs/boxel-realm-server/base/main.tf`, mounted beside `/persistent`, and
   keep the existing EFS volume untouched. Realm Server selects the mount only
   after the server-authoritative PretUI feature gate passes.
6. Split IAM deliberately: S3 Files' synchronization role, Realm Server's
   access-point mount/write grant, Realm Server's direct-S3 protocol writer,
   and any agent/read-only inspection role. Enforce `If-None-Match` or
   `If-Match` on protocol prefixes with bucket policy.
7. Add SSM parameters for the default-off pilot flag, exact PretUI RRI
   allowlist, bucket, prefix, file-system/access-point identifiers, and mount
   path. A task deployment is required after changing activation parameters.
8. Add NFS/2049 security-group rules only between the S3 Files mount targets
   and the selected Fargate services. Transit encryption and a task IAM role
   are mandatory.
9. Add CloudWatch alarms and Boxel observability panels for client/mount health,
   `PendingExports`, import/export failures, synchronization lag,
   lost-and-found violations, conditional-write failures, and storage/request
   cost.
10. Add a staging apply, Known Date replay, writer failover, export-window
    restart, conditional-write race, restore, kill-switch, and retained-data
    rollback drill. Teardown may remove pilot compute/filesystem resources but
    must retain the bucket and Version history unless destruction is explicitly
    approved.

Terraform gates are `fmt`, `validate`, and a reviewed plan that shows no
replacement of the existing EFS or unrelated ECS resources. The application
stack cannot call B1 complete until the staged infrastructure smoke and
recovery drills pass.

## Replace the current Boxel CLI sync model

Current Boxel CLI behavior is not safe enough for team branches:

- `.boxel-sync.json` records local content hashes but uses remote mtimes to
  detect remote changes;
- `--prefer-newest` treats clock order as conflict resolution;
- `push` can warn about remote drift and then overwrite it;
- local checkpoints are commits in a hidden `.boxel-history/.git` repository;
- the manifest identifies only a realm URL, not a branch view and exact base.

Replace that model rather than wrapping it.

### Local workspace record

The local record is client state, not canonical realm state. Its minimum shape
is conceptually:

```ts
interface RealmWorkspaceState {
  realmRRI: string;
  realmURL: string;
  branchId: string;
  branchName: string;
  baseRepositoryHash: string;
  baseTreeHash: string;
  baseLockHash: string;
  observedRefGeneration: number;
  files: Record<string, string>; // path -> sha256
}
```

It may remain a single protected sidecar such as `.boxel-sync.json`, but its
schema is replaced in one step. Remove `remoteMtimes`. Replace MD5 file hashes
with Deck's SHA-256/tree-hash rules. Remove `.boxel-history`; canonical History
is the selected branch's server-side deckd History.

### Command semantics

Keep the familiar local transport verbs, but give them exact semantics:

| Command        | New contract                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `realm pull`   | Materialize the selected remote branch head and record its exact Repository/tree/lock/ref generation as the local base. A dirty local tree requires three-way reconciliation or an explicit discard.    |
| `realm push`   | Compare local content to the recorded base and conditionally apply that change set only if the selected remote branch still has the expected head. Remote movement fails; it never silently overwrites. |
| `realm sync`   | Three-way reconcile recorded base, current local tree, and current remote branch. Publish one remote write batch on success; write nothing remotely on conflict.                                        |
| `realm watch`  | Repeatedly run the same conditional content-addressed write protocol, coalescing local saves into small batches and recording server History Steps.                                                     |
| `realm status` | Report local/base/remote divergence by hashes and branch head, never by newest timestamp.                                                                                                               |

`--prefer-newest` is removed. Explicit `--prefer-local` or `--prefer-remote`
may exist only as deliberate conflict-resolution inputs after showing the
three-way conflict; neither bypasses branch protection or head compare-and-swap.

The same merge engine should classify local/remote changes and later Review
tree changes. Do not implement one file-conflict algorithm in Boxel CLI and a
different one in Realm Server.

## Prepare the Known Date vertical slice

The fixture is replayable, not a checked-in post-migration realm dump or an
invented protocol demo. Its roots come from the real PretUI checkout:

- `controls-known-date.gts` — implementation and deterministic parsing;
- `controls-known-date.test.gts` — locale, calendar, keyboard, and a11y proof;
- `demo-controls-known-date.gts` — interactive catalog usage;
- `PretuiComponent/knowndate.json` — searchable design-system metadata;
- its actual imported shared-control, Freestyle, theme/token, card-definition,
  and asset closure; and
- one small Boxel Host form that consumes Known Date through the generated
  PretUI package.

An explicit seed manifest names the feature roots. The replay script computes
and records their dependency closure, fails on unresolved dependencies, and
fails if an accidental broad import expands the fixture past its reviewed
boundary. It should:

1. Create or select the canonical `@cardstack/pretui/` realm.
2. Add conventional `package.json` with the PretUI package name, exports, and
   semver dependency intent.
3. Add `importmap.json` with exact RRI locks.
4. Rewrite legacy Base URLs to `@cardstack/base/...`.
5. Extract Known Date and its reviewed closure from an exact PretUI source
   revision while preserving real paths and contents.
6. Classify any dependency that crosses the boundary: include genuinely
   authored shared PretUI support; express reusable external packages as exact
   locked dependencies; reject unexplained vendored trees.
7. Publish the exact `@cardstack/pretui@0.4.0/` Version and immutable card-index
   snapshot. B0–B2 replay the same exact input into the initial Repository,
   branch, Checkpoint, and History ancestry once those adapters exist.
8. Build the Known Date catalog entry, preserve its focused tests as source
   provenance, and prove the generated downstream Host consumer.

Replaying this script against an empty local realm and an empty hosted/S3 realm
must produce the same canonical package and tree hashes.

This is a vertical-slice fixture, not a claim that PretUI is permanently split
into a miniature package. The package boundary and RRI are the real PretUI
boundary. After the collaboration path is accepted, the same replay machinery
can widen the reviewed seed manifest until the full realm is canonical.

## Two consumption planes

PretUI must serve two legitimate consumers without confusing their mechanics.

### Realm/card runtime

Realm cards import `@cardstack/pretui/...`. A4 discovers the package and its
exact lock at runtime. Branch previews select a `RealmViewContext`; stable apps
may lock an exact `@cardstack/pretui@<version>/...`.

### Boxel Host build

Host-side modules cannot assume that dynamic realm loading satisfies their
compile-time Ember package graph. A narrow syndication mapping exports an
accepted exact PretUI Version into a Boxel workspace package, initially
`packages/pretui` unless implementation evidence requires a different name.

The generated package carries:

- source Version RRI and, after B0, its Checkpoint hash;
- source tree and composed lock hashes;
- syndication mapping/configuration version;
- generated tree hash;
- conventional monorepo `package.json` and dependency projection;
- a verification command that fails if generated files drift from provenance.

PretUI source is not edited in the generated subtree. Host-specific adapters
belong outside it. A PretUI fix starts on a realm branch, is reviewed and
merged there, then a new exact Version is syndicated to the monorepo.

This is one configured use of the generic Realm Runner/command syndication
architecture. The mapping may produce a monorepo commit or PR later, but the
protocol input is an exact canonical PretUI Version—not a Git branch.

A6 lands before the B0 Checkpoint adapter. Its first provenance record therefore
uses the exact Version RRI plus tree, immutable index, and lock hashes as the
authoritative input and records `checkpointHash: null` explicitly. B0 replaces
that transitional absence with the exact Checkpoint; it must not invent a hash
retroactively.

## Revised execution stack

A0–A6 are the locally verified foundation. Remaining work is ordered around
PretUI collaboration:

| Slice   | Deliverable                                                                                                                             | PretUI proof                                                                                                            |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **A5**  | Version-aware immutable index snapshots and semver range queries; Known Date vertical-slice migration/replay                            | The catalog can open exact PretUI Versions and a range selects the correct indexed Known Date slice without copying it. |
| **A6**  | Deterministic exact-Version syndication into the Boxel monorepo workspace package                                                       | A Host module imports generated PretUI, its consumer tests pass, and provenance verification reproduces the same tree.  |
| **B0**  | Repository, branch-head, Checkpoint, Review, and merge protocol adapters                                                                | Canonical objects round-trip with PretUI RRI roots.                                                                     |
| **B1a** | Realm-contained Desktop FS and hosted S3 Files/direct-S3 adapters, conditional refs, writer ownership, prepared recovery                | The same state-machine suite passes against local adapters and an AWS test harness.                                     |
| **B1b** | `cardstack/infra` S3 Files module, bucket/KMS/versioning, access points/mounts, ECS/IAM/SSM wiring, alarms, rollout and recovery drills | The Known Date staging pilot survives races/restarts and the kill switch without replacing Realm Server's existing EFS. |
| **B2a** | Content-addressed Boxel CLI pull/push/sync/status/watch against an exact branch base                                                    | Two local PretUI workspaces detect divergence without mtimes; stale push writes nothing.                                |
| **B2b** | Branch-keyed deckd History on implicit `main`; accepted CLI writes append Steps; save/restore                                           | Claude edits a PretUI component through watch, sees every save in History, and restores without local Git.              |
| **B3a** | Immutable index-generation manifests and RRI-bearing `RealmViewContext` through writer/query                                            | Two hidden PretUI views answer differently for the same component RRI.                                                  |
| **B3b** | View-qualified caches, jobs, events, activity, prerender, Loader, and test selection                                                    | A hidden branch write cannot invalidate or leak into PretUI `main`.                                                     |
| **B4**  | Atomic branch/fork creation: clone source, exact lock, completed index, and History ancestry                                            | Three named PretUI branches become visible only after their catalog previews are ready.                                 |
| **B5a** | Checkpoint creation and immutable source/index/lock views; CLI command                                                                  | A teammate checkpoints an exact date-picker change while later saves continue.                                          |
| **B5b** | Review opening, candidate generation, exact diff, Browse/Run/catalog preview; CLI command                                               | Review remains fixed when source or target branch moves.                                                                |
| **B6**  | Three-way merge, target-head recheck, one target write/index/History batch; CLI command                                                 | Disjoint component work merges; competing token edits conflict with no partial main mutation.                           |
| **B7**  | Complete Boxel CLI and Claude Code skill/workflow, including branch/fork/switch/checkpoint/review/merge and structured JSON output      | The full collaboration replay runs headlessly through public CLI commands.                                              |
| **B8**  | Polish the additive collaboration affordances in Workspace Chooser, Interact/Code, stack backgrounds, and Review                        | The team can perform the same proven workflow visually in the existing Host, without a parallel Deck application.       |

CLI support is not deferred until B7. Each B slice lands its corresponding
public command and integration test. B7 consolidates the full agent workflow,
stable JSON output, documentation, and end-to-end replay.

Every slice that adds observable behavior also wires that behavior through the
same `deckCollaboration` capability. A layer is incomplete if it works only
when directly invoked while its endpoint, worker, CLI command, or Host surface
escapes the gate.

## Progressive PretUI acceptance story

The fixture script creates meaningful design-system work rather than recursive
protocol demos:

1. Seed `@cardstack/pretui/` main from the PretUI `0.4.0` source with the exact
   Known Date roots and reviewed dependency closure, then publish the exact
   `@cardstack/pretui@0.4.0/` Version.
2. Create `known-date/locale-entry`, `known-date/a11y-errors`, and
   `known-date/night-shift-density` for three team members/agents.
3. Materialize each branch with Boxel CLI and run `realm watch` while Claude
   Code edits it.
4. Show branch-specific catalog search, interactive Known Date preview, fixed
   reference-date behavior, theme variants, and focused parsing/a11y tests.
5. Prove every accepted save appears only in that branch's History.
6. Set identical or reversed filesystem mtimes on different bytes and prove
   sync decisions remain unchanged.
7. Advance one remote branch from a second local workspace; prove a stale push
   fails and three-way sync either merges or reports exact conflicts.
8. Checkpoint and open Reviews for all three branches, each with the rendered
   component, catalog metadata diff, focused test result, and exact package
   diff.
9. Merge the independent locale-entry and accessibility Reviews.
10. Create an overlapping main theme/density edit, then prove the Night Shift
    Review conflicts and leaves main source, index, ref, and History unchanged.
11. Resolve and merge it; main advances once and records one merge Step.
12. Cut `@cardstack/pretui@0.5.0/`, syndicate it into the Boxel monorepo, and
    run the real Known Date Host consumer canary against its semver range and
    exact import-map lock.

The whole story runs from an empty realm by replaying public CLI/Realm Server
operations. It runs once locally and once against S3-backed hosted storage.

## Visible product surfaces arrive with real state

Do not wait until B8 to show all value, and do not ship controls backed by fake
state:

- A5 exposes exact Version/range query data; visible catalog controls wait for
  a real branch-aware Host view rather than simulating collaboration state.
- B2b exposes a narrow real History view for the selected branch.
- B4 exposes a quiet branch selector and shareable branch catalog URL.
- B5b exposes the exact Review and candidate preview.
- B6 exposes merge/conflict actions.
- B8 unifies and polishes these surfaces.

## UX integration into the existing Host

This is an additive change to the current Boxel Host, not a redesign and not a
parallel "repository protocol" application. Collaboration affordances use the
existing Workspace Chooser, `SubmodeLayout`, realm backgrounds, card stacks,
and Review surfaces. Outside the `deckCollaboration` capability boundary, the
Host must render the existing UI, preserve its keyboard behavior, and make no
Deck-specific requests.

The gate is conjunctive: the build/boot flag is enabled, the Realm Server
advertises the capability, the realm is in the PretUI pilot allowlist, and the
user has the necessary realm permission. Missing any condition restores the
existing UI rather than showing a disabled or speculative collaboration shell.

### Workspace Chooser

Keep the current filters, sections, tile layout, favorite control, overflow
menu, visibility indicators, and click-to-open behavior. Add branch identity to
the tile without turning the dashboard into a source-control screen:

- Put a low-contrast, diagonal, step-and-repeat branch name in the existing
  tile artwork layer, behind all tile content. `main` keeps the normal clean
  artwork; a Review candidate uses an amber `REVIEW #N` pattern and separately
  names its source branch.
- Add one compact branch pill near the lower-left of the tile, for example
  `PretUI / ana/known-date-fields`. It is a positioned sibling of the existing
  open-workspace button, like the star and overflow controls, never an
  interactive element nested inside that button.
- Opening a tile still opens the same realm index in Interact, but with the
  selected `RealmViewContext`. If the prior path is absent in that view, open
  the realm index and explain why; never silently fall back to `main`.
- Add `Switch branch`, `New branch`, `History`, and `Reviews` to the existing
  tile menu as those capabilities land. A read-only imported realm offers
  `Branch here` when the user may create an owned branch; it does not pretend
  the imported package is mutable.

The whole tile remains keyboard reachable and understandable without relying
on the diagonal treatment. Text, focus, and menu state are the authoritative
branch indicators; the repeated pattern is ambient orientation only.

### Interact and Code

Keep the existing Boxel control, submode switcher, `New` action, profile,
search, AI assistant, and card-stack model. Add one compact realm-view control
to the available top-bar track after `New`:

```text
[ Interact ⌄ ] [ New ]  [ PretUI / ana/known-date-fields ⌄  ● saved just now ]
```

The popover switches branches and opens History, branch creation, or a Review.
It reports durable save state from the same accepted write/History result used
by the CLI; do not add a separate bottom status bar or a client-only notion of
"saved". Code uses the same control through the shared submode layout so an
agent and a person see the same selected view.

Apply the branch step-and-repeat treatment only to the existing realm
background and stack gutters, never over card content. When every open stack
has the same exact `RealmViewContext`, the top-bar control and one common realm
background are truthful. When stacks contain different realms or branches,
reuse the existing per-stack background split and label each stack with its
own compact realm/branch identity; do not claim there is one global branch.
Expanded cards remain visually clean.

Switching branches should preserve the current stacks, card IDs, and focused
path where those resources exist in the destination view. Missing resources
receive an explicit unavailable-in-this-branch state with actions to return or
open the realm index. Imported cards pinned to an exact Version show their lock
and Version; mutation controls appear only after an authorized `Branch here`.

### Reviews and merge feedback

A Review is an immutable candidate view, not another branch. Identify it as
`Review #3 · ana/known-date-fields → main`, pin Browse/Run/catalog preview to
its exact candidate Checkpoint, and keep moving source or target branches from
changing what the reviewer sees. Merge and conflict actions appear only in the
Review surface and only with target-realm permission.

After a successful merge, the target branch advances once, its source tree and
index become visible together, one merge Step appears in History, and every
open target view refreshes from that new exact head. A conflict or failed
conditional write changes none of those surfaces and keeps the candidate
available for inspection.

### Progressive delivery under the feature flag

- **B2b:** add the real branch-scoped History entry point and durable save
  indicator.
- **B4:** add branch identity, switching, branch URLs, and `Branch here` to the
  Workspace Chooser and shared submode layout.
- **B5b:** add fixed Review candidate labels and exact Browse/Run/catalog
  previews.
- **B6:** add permission-aware merge/conflict feedback and atomic target-view
  refresh.
- **B8:** finish accessibility, responsive layout, visual hierarchy, and
  cross-surface consistency; it does not introduce a second state model.

Host integration tests cover both sides of the boundary: disabled mode makes
no collaboration requests and preserves the existing DOM/keyboard workflow;
enabled PretUI mode covers keyboard branch switching, clean `main` tiles,
branched and mixed-stack backgrounds, path preservation, explicit missing
resources, read-only imports, exact Review labels, atomic post-merge refresh,
and the runtime kill switch. Visual regression proof uses the real Workspace
Chooser and Interact shell with the Known Date PretUI fixture, not a standalone
HTML mock.

## Merge and release gates

Every slice is independently reviewable and green. In addition to package
lint/type checks:

- Boxel CLI tests use two or more real local materializations and the real
  Realm Server endpoints; no mocked branch state.
- Tests assert SHA-256/tree/Repository/lock/ref values, not mtimes.
- A failed sync or merge proves remote bytes, index generation, branch ref, and
  History are all unchanged.
- Branch tests run against both local and S3 adapters after B1a; B1b repeats
  them through the real staging mount, IAM policies, ECS task role, and bucket.
- PretUI visual proof uses the actual Known Date implementation, catalog card,
  theme, and affected tests—not protocol-themed demo cards.
- Monorepo syndication is accepted only when a clean regeneration is byte
  identical and a Host compile-time consumer imports the generated package.
- The feature matrix is exercised end to end: flag off + PretUI is inert; flag
  on + a non-allowlisted realm is inert; flag on + PretUI runs the full replay.
- Client-side spoofing cannot activate a server route, writer, or merge, and
  disabling the flag after use leaves existing PretUI Deck data durable but
  inert and unmodified.
- Pilot tests opt in explicitly. The ordinary Host, Realm Server, and Boxel CLI
  suites prove their non-PretUI behavior is unchanged with the default flag off.

## Outside the critical path

- GitHub PR generation for the syndicated monorepo representation.
- Reconciliation of edits made directly inside the generated monorepo package;
  the first version rejects such drift and directs authors to a PretUI realm
  branch.
- General Matrix collaboration transport.
- Full/incremental hosted application publishing unrelated to exporting the
  PretUI package for Host consumption.
- Porting the complete Atlas/CRM/Greeter POC UI. Small datasets or interactions
  may be reused when they strengthen a PretUI acceptance case.

## Replacement threshold

PretUI can stop using GitHub for daily collaboration after B7 when:

- Boxel CLI + Claude Code can create/switch branches and synchronize without
  mtime arbitration or hidden Git History;
- each branch has truthful catalog preview, tests, and every-save History;
- exact Reviews and merge are safe under contention;
- an approved PretUI Version can reproducibly reach the Boxel monorepo and pass
  Host consumer tests.
- the same release passes the complete off/wrong-realm/PretUI feature-gate
  matrix, including an immediate operator kill-switch test.
- the Terraform-managed staging substrate has passed its failover,
  export-window, recovery, observability, and retained-data rollback drills.

B8 is the broader team-adoption gate: the same workflow becomes visually clear
inside Boxel, but it does not redefine the protocol already proven by CLI.
