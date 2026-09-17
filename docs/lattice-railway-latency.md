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
- [ ] R3: Run `pnpm lint` in modified packages, checkpoint engine changes, deploy
      the pinned engine to the isolated demo, then repeat the same synthetic probe.
- [ ] R4: Verify publication receipt and visible count, retain exact timings and
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
