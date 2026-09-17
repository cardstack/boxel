# Railway latency: focused follow-up

Scope: the opt-in Lattice engine in the isolated Railway demo. Keep application
definitions and synthetic records outside Git. Preserve source/publication
ordering, complete outputs, existing client instances, and flag-off behavior.

## Acceptance and sequence

- [x] R1: Ignore maintenance jobs in source freshness barriers. Real queued or
      failed source indexing must still block reads, code linking and HTML admission.
      Regression command (retain full output):
      `TEST_FILES=lattice-render-authority-test,lattice-native-render-job-test,lattice-code-worker-test pnpm test`.
      Before: 6 passed / 1 failed in the authority file. After: 31 passed / 0 failed
      across the three files. Logs: `/tmp/lattice-r1-before.log`,
      `/tmp/lattice-r1-after.log`. The DB-only helper needs
      `MATRIX_REGISTRATION_SHARED_SECRET=unused-lattice-db-tests`.
- [x] R2: Attribute publication finalization using existing index-perf phase
      logs, change only the demonstrated expensive operation, and run its focused
      regression tests. Record the pass/fail command before that change.
      Selected operation: reuse unchanged realm type metadata for enabled source
      publication, using the existing bounded contribution comparison. Railway
      EXPLAIN ANALYZE measured 53.6 + 31.7 ms and about 180 MB of page reads for the
      current full catalogue queries. Pass/fail:
      `TEST_FILES=lattice-card-publication-test,lattice-opt-in-test pnpm test`.
      Before: 29 passed / 1 failed. After: 30 passed / 0 failed. Additional worker
      registration check: 3 passed / 0 failed. Full logs retained in
      `/tmp/lattice-r2-before.log`, `/tmp/lattice-r2-after.log`, and
      `/tmp/lattice-worker-registration.log`.
- [x] R3: Run `pnpm lint` in modified packages, checkpoint engine changes, deploy
      the pinned engine to the isolated demo, then repeat the same synthetic probe.
- [x] R4: Verify publication receipt and visible count, retain exact timings and
      failures, restore the measurement-owned record, and report the remaining gap.

Both modified packages ran `pnpm lint`: JavaScript lint passed. Package type
checking remains failed in untouched boxel-ui imports (missing ember-css-url and
ember-draggable-modifiers declarations, plus dropdown argument typing). No errors
were reported in changed files. Retained logs:
`/tmp/lattice-latency-runtime-lint.log`, `/tmp/lattice-latency-realm-lint.log`.
Do not describe the package checks as fully passing.

Baseline: first fresh HTTP data took 3.14–4.43 seconds. This is not browser DOM
latency. Source plus owner finalization took 674–1,973 ms. Native evaluator wall
time was 177 ms in a sampled day. Do not sum nested phases or matching-job waits
that overlap source execution. No hardware speedup or p95 claim from three runs.

Stop this slice after one measured deployment; additional hypotheses become
explicit follow-ups rather than an unbounded optimization loop.

## Deployment and observed outcome

Engine a7ff492a6e is deployed on the isolated Railway realm and worker. Four
post-recovery synthetic toggles observed fresh HTTP data at 3,528 / 2,858 /
2,869 / 3,117 ms. Two independent browser stores (same account) confirmed the
changes without reload. The last trial took 9,216 ms to both DOMs: Synapse
rejected the publication three times with 429 rc_messages, so delivery took
four attempts. A bounded allowance for the internal sender, configured in the
private infrastructure repository, removed retries in the following two trials:
first fresh HTTP 2,986 / 3,017 ms; both DOMs 3,332 / 3,234 ms. These timings are
PATCH-dispatch to observation, not UI Post-click measurements.

This is not a 500–800 ms success and not a controlled comparison with main or
the local Mac. Earlier warm HTTP samples were 4,351 / 4,203 / 3,988 / 3,401 ms,
but user edits and runtime/cache changes prevent attributing that whole difference
to this patch. New source finalization commonly measured 81–101 ms, versus
228–246 ms in two preceding logged trials; outliers remain. No new whole-output
parity or active-typing preservation claim is made by this follow-up.

Retained deployment failure: the first worker stopped because its operator review
still pinned the old runtime revision. Restoring the matching runtime policy was
not enough: the restarted realm's definition cache lacked 48 of 64 reviewed
modules, causing native admission refusal and a failing Chrome fallback. Normal
module lookups plus scoped invalidation repaired the queued sources and day.
Both existing dashboards then advanced from 7 to 10 of 17. No user data was
replaced. The measurement-owned record is restored to done. A pre-deployment
native-review check now prevents the revision mismatch. Cold-cache admission
recovery and startup database connection budgeting remain explicit follow-ups.

User-approved next direction is notification coalescing using the existing durable
outbox: collapse repeat notices for the same owner, union different changed owner
IDs per recipient/realm, and preserve fenced claims, idempotent delivery and
pending-versus-published semantics. A new client-demand registry is not required
for this first reduction. No coalescing implementation is claimed in this slice.

Detailed operational evidence is in the private infrastructure repository at
`docs/railway-record-count-latency.md`, with raw logs and samples in its ignored
`.cache/evidence` directory. The engine's 64 focused tests pass; the retained
package type-check failures above remain open.

## C1 — coalesce publication notifications (complete)

Pass/fail command before implementation:
`MATRIX_REGISTRATION_SHARED_SECRET=unused-lattice-db-tests TEST_FILES=lattice-publication-delivery-test,lattice-delivery-opt-in-test pnpm test`.

Use existing event/delivery rows and expiring claims. No new registry, schema,
client contract, or deliberate debounce. Collapse pending revisions of one owner;
combine distinct owners only when their latest generation and event kind agree,
so a batched notice never invents a revision for a card. Bound source rows and
wire bytes. Claim a recipient/realm/kind exclusively while it is in flight;
other recipients retain independent capacity. A deterministic ID derived from
covered immutable events makes retries of the same batch idempotent. Changed
membership gets a different ID (an ambiguous prior send may duplicate a harmless
invalidation hint, never lose an obligation). Mark covered rows delivered only
after Matrix acknowledgement. Recheck authorization and session before sending.

Acceptance: overlapping identities/revisions, distinct owner union, generation and
HTML/data separation, bounded spill, failure/restart, concurrent claim fencing,
changes while sending, off-flag no-op and revoked/rotated sessions. Retain counts
and failures. Then lint, checkpoint, deploy realm-only, exercise the real synthetic
dashboard and compare notification counts as well as fresh DOM latency.

C1 local evidence: old dispatcher 15 passed / 4 failed (new regressions), saved in
`/tmp/lattice-coalesce-before.log`. Implemented dispatcher plus generation/size,
retry/membership, in-flight accumulation, expiry and opt-in regressions and card
publication suite: 43 passed / 0 failed (`/tmp/lattice-coalesce-final.log`). The
original slow-recipient test expected seven individual sends; its assertion now
expects the other recipient's four pending notices in one send. Independent
recipient progress is still checked before releasing the held sender.

`pnpm lint` ran in realm-server: JavaScript passed; type checks still report four
errors in untouched Boxel UI drag/drop declarations and dropdown argument typing.
No changed-file diagnostics. Full log: `/tmp/lattice-coalesce-lint.log`.
Engine c9fcd82a3f is deployed on the Railway realm only; the worker remains on
a7ff492a6e with its matching native review. Host and client protocol are unchanged.
The controlled delivery-only burst replayed eight already-committed day notices
to two existing recipients. Sixteen delivery obligations became two Matrix events
(one per recipient), an 87.5% reduction. All sixteen rows were acknowledged on
attempt one. This is a burst-delivery experiment, not eight source writes or an
end-to-end throughput measurement.

Two subsequent real probe writes changed both existing browser stores from
10/17 to 9/17 and back to 10/17 without reload. PATCH dispatch to first fresh HTTP
was 2,810 / 3,086 ms. Both confirmed DOM values were observed around 3,172 /
3,262 ms; the first trial timestamps begin each browser read, the second ends it,
so these are approximate polling observations, not precise render timestamps.
Both stores used the same account. The owned probe is restored to done. These
samples do not establish an isolated-write latency improvement over the preceding
3,234–3,332 ms trials, nor new whole-output parity or active-editing coverage.

Retained deployment failure: the first write stayed pending for the entire
26,991 ms HTTP observation window. Realm startup cleared the module cache and
queued full reindexes, while an old 12,434-file HTML job occupied the general
worker. After the 64 normal reviewed-module lookups, the existing cancellation
helper removed only three verified unstarted startup jobs (536/538/540). The
existing claim-hold helper deferred bulk HTML for four hours; the verified HTML
child was interrupted for manager-owned reservation cleanup. User source jobs
were retained, and both stores recovered through normal publication. The timed
trials above followed recovery. This temporary HTML hold is not a permanent
capacity fix; startup admission, bulk-work scheduling and restart hygiene remain
follow-ups. No database output was manually marked ready.

Evidence: private infra `.cache/evidence/coalescing-burst-result.txt`,
`coalescing-record-draft.json` (retained blocked trial),
`coalescing-warm-{draft,done}.json`, `coalescing-browser-observations.json`,
and recovery/deployment logs. C1 stops here. A demand registry, suppression of
legacy source events, and changes to computation scheduling are outside this slice.
