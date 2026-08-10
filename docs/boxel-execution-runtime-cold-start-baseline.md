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
