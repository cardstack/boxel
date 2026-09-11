# Tessar performance report — in progress, DO NOT MERGE

This is an implementation checkpoint, not a completed performance comparison.
The smoke and 1× candidate runs pass the tested browser and mutation cases.
The first 10× attempt exhausted the test database's temporary filesystem; it is
being rerun on a separate disk-backed database. Controlled comparisons,
concurrency trials and full dashboard adaptation remain outstanding. No speedup
or additional AI-generation capacity has been established.

## Contract

Only correct, complete snapshots qualify. An acknowledged relevant write must
be reflected in the already-open and newly connected client within 10,000 ms.
Pending or failed work must not be presented as current output. Report write
acknowledgement latency separately from acknowledgement-to-display delay.

All fixtures are fabricated with seed 1729. The fixed sizes are smoke (34),
1× (1,255) and 10× (12,550). No production records are benchmark inputs.

## Connected smoke checkpoint

The candidate used the current uncommitted Tessar lifecycle implementation on
top of `fead7a13ab`. The harness records source, host-build and dataset hashes
in its raw result files. The latest smoke run includes queued-write checks and
an explicit pending state in the browser; sanitized observations are saved in
`tessar-benchmark-results.json`.

Five headless Chromium loads compared all six displayed statistics and every
displayed row with the independent raw-document oracle. All passed. No input-card
fetches or query searches were observed. The displayed-readiness observations
were 539, 429, 468, 444 and 495 ms; the first used a new browser context and the
rest reloaded that context. These five samples are too few to characterize tails.

| Synthetic mutation              | Write acknowledgement | Acknowledgement to observed display | Result                   |
| ------------------------------- | --------------------: | ----------------------------------: | ------------------------ |
| Matching observation score      |                826 ms |                               16 ms | Correct                  |
| Transitive reference label      |              1,247 ms |                              121 ms | Correct                  |
| Observation leaves selected day |              1,553 ms |                              119 ms | Correct                  |
| Observation enters selected day |                893 ms |                              115 ms | Correct                  |
| Asynchronous source edit        |                 15 ms |                              887 ms | Correct; pending shown   |
| Unrelated reference edit        |                950 ms |                              123 ms | Owner revision unchanged |
| Matching insertion              |                 15 ms |                            1,289 ms | Correct; pending shown   |
| Matching deletion               |                471 ms |                              137 ms | Correct                  |

The browser remained open through all eight writes. Each new total/row matched
its oracle without a reload or input-graph request. PATCH operations waited for
indexing before acknowledgement. Source POSTs acknowledged the queued write and
completed materialization later. The pending notification reached the open client
about 124–125 ms after those asynchronous acknowledgements; the raw results retain
that interval explicitly. This test proves bounded convergence and a pending UI,
not instantaneous notification delivery or linearizable reads of an already-open
screen. Cross-replica and reconnect cases remain to be validated.

A separate Chrome DevTools trace measured LCP 1,878 ms, TTFB 31 ms and CLS 0,
with no CPU/network throttling. This traced headed-browser navigation is a
different measurement from the headless displayed-readiness samples. It does not
establish a base/candidate improvement.

Focused checks: five Tessar browser tests / 68 assertions; four Postgres tests;
56 existing index-writer tests / 153 assertions; 15 existing computed tests / 41
assertions; three generator/oracle tests. Package lint and Glint checks passed.

## Failed cases retained

- Ordinary query-field HTTP reads returned live membership with zero-valued
  indexed statistics. They failed correctness and cannot be a speedup baseline.
- The first connected candidate response omitted the relationship's required
  `links.self`, causing browser validation to fail despite correct numeric HTTP
  results. The serializer was corrected and a wire-validation test was added.
- The first write trial deadlocked because index publication acquired the same
  advisory lock held by the source write awaiting indexing. Publication now uses
  a separate namespace, covered by a real Postgres lock regression test.
- The first 10× source-indexing pass failed at approximately 10,037 of 12,551
  files with PostgreSQL SQLSTATE 53100: its 3.9 GiB tmpfs was full. This is a
  failed run, not a completed indexing-time or throughput observation. A separate
  localhost-only PostgreSQL 16.3 container now uses a Docker disk-backed volume.
  The synthetic schema and reusable 1× template were preserved before stopping
  the disposable tmpfs container. Earlier tmpfs measurements are exploratory;
  base/candidate comparisons must use the same database storage configuration.

## Exploratory 1× checkpoint (tmpfs database)

The 1,255-record run used the same source version as the smoke checkpoint.
All 20 HTTP responses and 20 real Chromium displays matched their raw-document
oracle. HTTP responses were 29,698 bytes: median 9.33 ms, p95 11.88 ms, range
6.77–28.61 ms. Browser display readiness was median 482.96 ms, p95 538.86 ms,
range 434.56–582.69 ms. There were zero observed input-card/search requests and
zero page errors. The first browser sample used a new context, followed by
19 warm reloads; these are a mixed exploratory distribution.

All eight mutation cases passed in the already-open browser. Acknowledgement
to display ranged from 38 to 2,002 ms. The asynchronous edit acknowledged in
16 ms and appeared 2,002 ms later; insertion acknowledged in 15 ms and appeared
1,092 ms later. The unrelated reference edit left the selected owner revision
unchanged. These observations do not cover reconnect, restart or concurrent
write races.

Harness startup took 334,014 ms, including base indexing and HTML prerendering.
The source indexing job reported 53,862 ms total, with 1,828 ms of Tessar
materialization for four owners in one wave. A separate HTML phase accounts for
much of the remaining startup time. Source and working index/HTML tables totalled
about 929 MiB (243 + 238 + 228 + 220 MiB); duplicated working rows are included.
This is a material storage and indexing cost, even though the dashboard read is
small. Do not interpret startup latency as Tessar computation alone.

## Evidence still required

1. Additional lifecycle tests: definition changes, feeder chains, races,
   reconnects and worker restart recovery.
2. Valid getCards baseline and materialized display adaptation, with equivalent
   output and freshness semantics.
3. Controlled 1× and 10× runs, including larger matching sets and unrelated
   growth, repeated cold/warm browser reads and concurrent readers/writes.
4. CPU/memory, SQL/reverse-match work, source capture latency, backlog and
   indexing amplification. Source indexing and Tessar recomputation now have
   distinct timing fields in indexing job results.
5. Sanitized reproducible results, latency distributions and exportable charts.

Run commands and fixture details are in `scripts/tessar/README.md`. Large raw
logs, traces and generated datasets stay outside Git. The draft PR remains
DO NOT MERGE throughout these experiments.

## Latest lifecycle checkpoint (disk-backed database)

The latest implementation serializes overlapping snapshot deserialization,
rejects backward owner revisions, and revalidates after offline/reconnect or
tab resumption. A failed indexing job returns an explicit failure rather than
serving the previous snapshot as current. Realm-wide definition epoch changes
schedule affected old stamps for recomputation, including owners outside the
changed module's concrete dependency closure.

Five browser loads and nine mutations passed with no input-card/search requests.
The ninth mutation occurred while the browser was offline: it became visible
5,159 ms after acknowledgement, without a reload. A separate five-stage feeder
chain converged in 3,908 ms, with six successive published owner revisions.
The unrelated-module epoch case returned to ready in 868 ms.

Correctness smoke checks passed for 1, 10 and 50 concurrent HTTP readers plus
one open browser. These are not 50 simultaneous browser processes, and other
regression checks overlapped part of the smoke run; throughput from this run is
not a controlled benchmark. The focused browser suite now passes 71 assertions.
The existing computed and sliding-sync regressions also pass.

The first getCards reference failed the explicit-pending gate for asynchronous
writes. The corrected reference listens for realm publication/reconnect,
re-queries complete pages, and releases superseded resources. It passes one
browser read and the same nine mutation cases. Its first implementation used
an unavailable realm loader shim for `getOwner`; that attempt failed all five
loads and is excluded. The corrected reference uses the owner already supplied
by the host's getCards context. It must be identified as a corrected reference,
not the unmodified incumbent dashboard.

The second 10× setup attempt exceeded the harness's 600,000 ms startup limit
at approximately 11,278 of 12,551 files. Storage was available and indexing
was still progressing. The next cold-build setup limit is 3,600,000 ms; the
acknowledged-write freshness gate remains 10,000 ms.
