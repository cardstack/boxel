# Lattice runtime contracts

Lattice remains opt-in per realm. Disabled realms retain the ordinary read,
indexing, caching and delivery paths. This document describes the boundaries
that the integration and its focused tests must preserve.

## Reads and query results

Materialized card GET and HEAD responses have validators for their complete
representation, including publication state. A pending transition must change
the validator even when the displayed values remain unchanged. Conditional
requests still authorize first. The Have protocol and revision-pinned worker
inputs remain separate, non-cacheable representations.

Ordinary cards in enabled realms use the existing document cache when the
realm is settled. Their validator includes the settled realm revision, because
a nested publication can change without reindexing the root. While indexing,
routing, code invalidation or dirty owners remain, these ordinary responses
have no reusable validator. This is conservative; it does not claim that every
queued source write affects every owner.

Realm-scoped freshness probes are shared within one response, never between
requests. The terminal source-job lookup has a matching partial index.
Per-owner provenance is still checked individually.

A query field publication covers the returned page. Relationship metadata
carries both the full match count (`total`) and the captured page size
(`returned`). Missing page members, unresolved searches and errors refuse
publication. A legacy receipt without `returned` still requires full membership.
Unsupported nested query fields decline materialization; ordinary indexing
retains responsibility. Browser input capture refuses cross-realm inputs until
an authorized adapter supports them.

## Indexing, propagation and publication

Source indexing and materialization use distinct concurrency groups. Only
short publication transactions share `lattice:index:<realm>`. File writes can
invalidate code independently, so commit guards also check and lock referenced
code artifacts. A source registration stub has no output revision until an
output actually exists.

PostgreSQL materialization uses attempt-scoped candidate rows. An aborted
attempt cannot donate output to another wave or to primary indexing merely
because their tentative generation numbers coincide. Equal output may retain
an existing revision only when its publication provenance still agrees.

Enabled source indexing requires a secondary queue identity before it reads
source files or creates a batch. There is no synchronous materialization
fallback. Queued waves select the ready dependency frontier, consider at most
24 candidates and by default admit at most eight owners within a one-second cooperative
budget, with a commit tick. Overflow remains dirty and a successor is coalesced
transactionally; this does not create one job per owner. Convergence is
not bounded by a quadratic realm-wide wave counter. Owner failures retain
bounded, obligation-specific retry budgets. Supersession instead applies a
250 ms–2 s cooldown, cleared by genuinely new source work, without consuming
an error retry. A continuous feed cannot have a fixed total job bound: its
workload is unbounded. Quiescent work must converge or expose a retained failure.

Source traversal stops at a deferred materialized owner. After its value
changes, the publication transaction queues ordinary data consumers on the
primary lane. That lane resumes their transitive data dependency walk. HTML
refresh is separate and cannot substitute for rebuilding their search data.
Instance dependencies accept both extensionless and `.json` identities in
readiness and invalidation.

Native and browser source discovery register materialized owners without
executing their query aggregations. Browser discovery loads the definition and
hydrates authored fields, then inspects field metadata to create a pending
stub. It skips computed getters, query expansion, search-document traversal
and card-icon rendering. Only the subsequent guarded materialization computes
and captures the output and its receipts. Unsupported nested query definitions
retain ordinary indexing behavior. This reduces duplicate computation; it does
not eliminate the browser startup or definition-loading cost.

## Worker capacity and notifications

When realms are enabled, the worker manager defaults to one dedicated
secondary worker. The pool's job-type filter permits materialization, clock
sweeps and explicitly configured native code linking; it excludes source and
HTML jobs. Its priority floor admits all those secondary tasks. Operators may
override counts when running separate worker services, but must supply capacity
for each enabled execution type. Disabled configurations retain a zero default.

Dispatchers claim under per-realm locks and indexed recipient leases. Network
I/O occurs outside those locks. A delivery has at most twenty attempts;
malformed envelopes become terminal immediately. Terminal failure is recorded
and logged, never acknowledged as successful. After one day terminal events
can be pruned. A disconnected client repairs from current card revisions on
reconnect or reload; delivery exhaustion is an operational failure, not proof
that a viewer is current.

## Migration and recovery

Large-table indexes build concurrently. Retrying their migration replaces
partial/invalid builds instead of treating name existence as success.
Generation-clock repair and conversion of the derived summary to UNLOGGED
belong to the post-deploy removal phase, after older workers drain. Table
rewrites have lock and statement timeouts and do not hold their locks across
the recovery scans.

Loss of the unlogged index and summary deliberately requires rebuilding every
affected realm. That can be a fleet-wide recovery workload after an unclean
shutdown or failover. The durable generation clock is not evidence that the
unlogged data survived. Rebuilds must use bounded worker capacity; this design
does not claim instant recovery or eliminate that operational cost.
