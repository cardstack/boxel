# Lattice draft status

This is an opt-in engine draft, not a production-ready release. The public
review material is [architecture](lattice-architecture.md),
[authoring](lattice-authoring.md), and [testing](lattice-testing.md).
Application templates, example realm records, deployment runbooks, operational
logs, and unrelated design proposals are maintained separately.

## Remaining acceptance work

- Full host and realm-server CI, including the disabled-path equivalence checks.
- Integration with current main and migration/schema ordering review.
- Reliable native admission when source indexing and materialization advance
  the realm generation concurrently; existing publication guards must remain.
- One notification per second per viewer, demand-filtered delivery, and
  refreshes limited to active consumers. The existing dispatcher poll interval
  does not establish a send limit.
- Two-client freshness and editing-state checks against the same controlled
  workload. No end-to-end latency target is established by focused unit tests.
- Publication and routing recovery across definition changes, including events
  queued under an older definition.

The draft is not ready to merge. Focused regressions are useful evidence for
individual changes, not a replacement for these acceptance checks.
