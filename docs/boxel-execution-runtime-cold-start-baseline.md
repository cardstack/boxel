# Boxel execution runtime cold-start baseline

Status: measurement baseline, 2026-08-09. No runtime caching changes were made
as part of this measurement.

## Purpose

This baseline separates three costs that are easy to conflate when evaluating
Direct, Capsule, and Sandbox execution:

1. common Host, authentication, Store, and application startup;
2. module retrieval, transformation, and evaluation;
3. Sandbox child-document startup and interactive handoff.

The distinction matters because the Deck backport into Realm Server may change
module addressing, cache headers, and transpilation behavior. We should measure
that backport before adding another Host-owned artifact cache.

These numbers are diagnostic, not service-level objectives. They were captured
against the local Vite development Host at `https://localhost:4219`, using the
staging compatibility corpus and an already-warm browser asset cache. Local
Vite serves a large unbundled module graph, so raw Sandbox child startup is not
representative of a deployed production bundle.

## Page-level observations

Three fresh Host-document samples were collected for each execution tier.

| Tier    | Representative card            | Observed result                                                                             |
| ------- | ------------------------------ | ------------------------------------------------------------------------------------------- |
| Direct  | Base Skill card                | 5,730 ms, 4,753 ms, 5,041 ms; median **5,041 ms**                                           |
| Capsule | compatibility-corpus workspace | 5,453 ms, 4,767 ms, 5,011 ms; median **5,011 ms**                                           |
| Sandbox | Browser Canvas                 | 6,252 ms and 7,159 ms successful; one run had not reached interactive readiness at 8,789 ms |

Direct and Capsule cold-document time is effectively identical at this level.
The common Host startup dominates, so these samples do not support adding a
Capsule-specific cache merely to improve initial page navigation.

## Sandbox critical path

One Browser Canvas startup was decomposed using the runtime's lifecycle logs:

| Segment                                    | Approximate duration |
| ------------------------------------------ | -------------------: |
| Sandbox process creation to rendered child |               5.31 s |
| Child Vite/Ember application boot          |               4.46 s |
| First module materialization request       |               440 ms |
| First Glimmer render                       |                28 ms |

The dominant local cost is starting the child application, not rendering the
card. Immutable module delivery can improve the materialization segment and
remove repeated network validation, but it cannot eliminate the approximately
4.5-second development iframe boot. If that cost remains material in a
production build, the appropriate levers are prebooted or retained Sandbox
processes and a smaller child runtime.

## Current Base module delivery

`https://realms-staging.stack.cards/base/card-api` currently returns a 146,859
byte compiled module with 54 unique direct import specifiers.

Five requests of each kind produced:

| Request            | Median TTFB | Median total | Response               |
| ------------------ | ----------: | -----------: | ---------------------- |
| Full module        |       71 ms |       113 ms | `200`, 146,859 bytes   |
| Conditional module |       61 ms |        61 ms | `304`, zero body bytes |

Relevant response headers were:

```text
cache-control: public, max-age=0
etag: 1786136959:module
x-boxel-cache: hit
x-boxel-canonical-path: https://cardstack.com/base/card-api.gts
```

Realm Server is already serving a transpilation-cache hit, but the browser must
revalidate the module. A roughly 60 ms conditional round trip can compound over
module-graph depth and across independently owned Capsule and Sandbox loaders.

## Deck interaction and cache correctness

Deck's immutable-address work is likely to improve repeated Base and published
module retrieval, but its cache classes must remain precise:

- raw bytes at an exact published Version may use a one-year immutable cache;
- live or movable addresses remain non-immutable;
- compiled GTS/TS output depends on the compiler and must carry a build key or
  equivalent compiler identity, plus a short TTL/conditional response rather
  than inheriting raw-source immutability.

Only inert bytes and pure compilation artifacts may be shared across execution
principals. Evaluated exports, Store/CardDef instances, SES values, grants,
services, DOM nodes, and MessagePorts remain runtime-local.

## Decision before implementation

Do not add a Host AMD/module-artifact cache until the Realm Server Deck
backport lands and this baseline is repeated. After the backport, measure:

1. full and conditional Base module fetch latency and cache headers;
2. Sandbox process creation to child-ready;
3. child-ready to module materialized;
4. module materialized to first render;
5. a second Sandbox surface using the same immutable Base graph;
6. a second principal using the same bytes, verifying that only inert artifacts
   are shared;
7. local development and production-preview builds separately.

If module materialization falls from roughly 440 ms toward 100 ms and repeat
requests disappear, Realm Server delivery is doing the useful caching and a
second Host cache would add complexity without enough benefit. If the module
segment remains large, a Host cache should be content/build-key addressed and
store only inert transformed artifacts. If child boot remains dominant, work
on Sandbox process lifecycle instead of module caching.

## Compatibility context for the measurement

Performance numbers are useful only when the same runtime is still producing
correct cards. Three real-browser checks were run against staging/main and the
local branch after recording the cold-start samples:

- the 35-boundary format gauntlet passed (`FormatPreviewBatchOne/sample`), at
  3,693 ms on staging and 7,604 ms locally;
- a two-cycle, same-document navigation soak passed across Primitive Profile,
  Nested Field Host, Rich Markdown, Browser Canvas, Computed Flight Plan, and
  Poster Board; every close left zero Sandbox iframes and zero loading
  affordances, while the second cycle had zero net DOM or style growth;
- an additional ten-card mechanism cohort passed on both origins, including
  linked and recursive graphs, cardInfo projection, editable/tracked UI,
  native video, Leaflet, Three.js/3MF, and native popovers.

For the extended cohort, the local Capsule median was 2,842 ms across six
cards. The local Sandbox median was 4,608 ms across four cards, with a 1,613 ms
median from prerender readiness to interactive child handoff. The matching
staging buckets were 2,162 ms and 2,129 ms. These are navigation observations,
not isolated compiler benchmarks, but they preserve an important constraint:
future cache work must improve these timings without weakening the same
semantic, DOM-primitive, execution-tier, lifecycle, and teardown assertions.

## Focused Capsule parser optimization — 2026-08-11

This is a focused, correctness-qualified comparison for performance-plan item #1,
not completion of the full Phase 0 corpus. Chrome DevTools MCP drove five pre-change
and five post-change document loads of
`Release/opening-night` against the authenticated staging-backed development Host at
`https://host.codex-execution-runtime.localhost`. Every admitted sample rendered all
five declared semantic signatures, selected only Capsule, retained zero iframes, and
reported zero dropped instrumentation records.

| Metric                         | Before median / p95 | After median / p95 | Interpretation                                            |
| ------------------------------ | ------------------: | -----------------: | --------------------------------------------------------- |
| Full document navigation       |    6,119 / 7,849 ms |   6,314 / 8,306 ms | +3.2% median; inside the 5% guardrail                     |
| Host request construction      |        235 / 379 ms |       356 / 520 ms | +51%; direct evidence of non-comparable Host/staging load |
| Root Capsule render record     |        587 / 687 ms |       656 / 725 ms | +11.7%; inconclusive under the common variance above      |
| DOM nodes at readiness         |             893–902 |            893–902 | no growth                                                 |
| Live iframes / dropped records |               0 / 0 |              0 / 0 | unchanged                                                 |

The matching DevTools traces reinforce the variance diagnosis rather than a
page-level regression claim: the pre-change trace observed 204 ms TTFB and 11.35 s
LCP, while the post-change trace hit 6.42 s TTFB and 35.30 s LCP. Render-blocking
insights estimated 0 ms savings in the pre-change trace. These development-load LCP
values are not used to assess the local parser change.

The focused benchmark compares the removed implementation with the captured parser
in one process, alternating order across nine rounds of 250 clones. The payload is
2,412 bytes and includes HTML-comment tokens, Mermaid arrows, and JavaScript line
separators.

| Boundary clone                    | Median per clone | p95 batch (250) |
| --------------------------------- | ---------------: | --------------: |
| Per-read `Compartment.evaluate`   |         55.81 µs |        19.99 ms |
| Captured compartment `JSON.parse` |         14.38 µs |         3.85 ms |

The captured parser is **3.88× faster**, a **74.2% reduction**. Two further
independent runs measured 3.99–4.22× and 74.9–76.3%, supporting the same result.
Reproduce with
`pnpm --dir packages/host bench:execution-runtime-clone`.

Raw root-operation samples, in milliseconds:

```text
before render-record: 541.2, 678.4, 587.3, 511.0, 686.8
before navigation:    5076.3, 7528.3, 7848.5, 6119.0, 6021.3
after render-record:  534.0, 689.2, 572.3, 655.9, 724.5
after navigation:     6045.0, 5515.7, 7935.2, 8305.9, 6313.5
```

The new JSON-text boundary test passes in the clean prebuilt Host runner. The broader
render-record parity filter could not run because its required local Base realm at
`https://localhost:4201` was not started; the authenticated real Release card
nevertheless preserved the parity signatures exercised by this focused comparison.

## Runtime simplification batch — 2026-08-11

This follow-up retains three small, ownership-preserving changes: the Capsule render
projection is cloned only by the shared render-record assembler; browser globals and
DOM-method signals are collected in one Babel pass; and Capsule CSS confinement
reuses the stylesheet parsed by validation. No tier, authority, occurrence, protocol,
or lifecycle rule changed.

Focused alternating-order benchmarks compared the removed implementations with the
new paths and asserted output equality before timing:

| Operation                                       |      Legacy |    Retained |            Result |
| ----------------------------------------------- | ----------: | ----------: | ----------------: |
| Classifier Babel traversal                      | 3,389.96 µs | 1,556.67 µs | **2.18×; −54.1%** |
| Render-record projection assembly               |   216.86 µs |   151.42 µs | **1.43×; −30.2%** |
| ContentTag preprocessor construction            |    55.59 µs |    56.63 µs |    median-neutral |
| CSS validation + confinement (Chrome, 80 rules) |    1,320 µs |      902 µs | **1.46×; −31.7%** |

Reproduce the Node cases with
`pnpm --dir packages/host bench:execution-runtime-simplifications`. The stylesheet
case used Chrome's native `CSSStyleSheet`, 50 operations per round, and nine
alternating rounds.

Five warmed authenticated loads of `Release/opening-night` produced:

```text
render-record: 623.4, 570.3, 581.0, 586.2, 1113.7 ms
root request:  413.8, 528.0, 408.8, 376.7, 580.0 ms
navigation:    22081.8, 20261.5, 19803.3, 21477.5, 20898.0 ms
```

| Metric                                  | Previous retained run | Simplification batch | Interpretation                                |
| --------------------------------------- | --------------------: | -------------------: | --------------------------------------------- |
| Root Capsule render-record median / p95 |      655.9 / 724.5 ms |   586.2 / 1,113.7 ms | **−10.6% median**; p95 has one outlier        |
| Root request median / p95               |          356 / 520 ms |       413.8 / 580 ms | +16.2% median; Host/staging variance worsened |
| Full navigation median / p95            |  6,313.5 / 8,305.9 ms | 20,898 / 22,081.8 ms | non-comparable current environment delay      |

All five samples rendered the five declared semantic signatures, selected Capsule
only, retained zero Sandbox iframes, and dropped zero instrumentation records. DOM
size was stable at 957 nodes throughout the batch. A navigation trace was attempted,
but the DevTools navigation timeout expired under the same Host/staging delay, so no
trace-level LCP claim is admitted.

## Safe lifecycle batch — 2026-08-11

The next retained batch bounded the remaining fetch and Surface request tables,
made Surface observation subscriber-driven, acknowledged and stopped ordinary
post-paint diagnostics, and stabilized unchanged Capsule context projection.

Chrome-native focused measurements found:

| Work item                             |                   Before |                 After |
| ------------------------------------- | -----------------------: | --------------------: |
| 100,000 unchanged context projections | 3.1 ms / 100,000 facades |     0.2 ms / 1 facade |
| 1,000 accepted post-paint diagnostics | 1,000 measurements/posts |                     0 |
| idle attached Surface                 | 2 observers + 1 box read |   0 observers / reads |
| silent fetch or Surface request       |                unbounded | bounded to 10 seconds |

Three warmed authenticated `Release/opening-night` samples were semantic-parity
green, Capsule-only, with nine headings, zero iframes, zero dropped records, and
946–957 DOM nodes. Median readiness/root request/root render-record were
26.18 s / 241.2 ms / 612.9 ms. Their mixed movement versus the preceding run is
classified as Host/staging variance; the retained performance claim is the direct
work elimination above, not a page-level speedup.
