# Boxel execution runtime: render baseline

## What this is for

Every performance claim the execution runtime makes — "no regression", "the
cage costs nothing here", "this cache paid for itself" — needs something to be
measured against. This document is that reference point: the method, the
environment, and the numbers a run of that method produces.

The instrument is
[`execution-runtime-render-baseline.mts`](../packages/host/scripts/execution-runtime-render-baseline.mts).
It is a script rather than a described procedure because a baseline nobody can
re-run is not a baseline: whoever disputes a number has to be able to produce
their own.

## Read the numbers as diagnostic, not as objectives

**A local development Host is not a deployed build.** The dev server ships a
large unbundled module graph — hundreds of separate module requests that a
production bundle never issues. Absolute values from it belong in a comparison
against another run of the same method in the same environment, and nowhere
else. They are not service-level objectives, they do not predict production,
and a deployed measurement will not resemble them.

What does survive comparison across environments is the **shape**: how the cost
divides between document delivery, application startup, and card rendering; how
much a warm navigation saves; and how one card compares with another inside a
single run.

## What is measured

A sample is one navigation, timed in three parts.

| Part            | From                  | To                                                            |
| --------------- | --------------------- | ------------------------------------------------------------- |
| **Document**    | navigation start      | `DOMContentLoaded`, read from the page's own navigation entry |
| **Application** | navigation start      | the Host app is mounted and authentication has resolved       |
| **Execution**   | application readiness | a card surface is present with no loading affordance          |

Document delivery overlaps the application part rather than preceding it: it is
read separately because it is the one segment the Host does not own. Total is
application plus execution.

Readiness is defined by the selectors the browser smoke runner exports, so the
baseline and the smoke lane measure the same two moments. A second, slightly
different definition would make two numbers look comparable when they are not.

**The execution part has a floor.** Readiness is detected by polling the page,
so the shortest interval the instrument can resolve is one `evaluate` round
trip — measured at roughly 7 ms median and up to ~31 ms on the machine below.
An execution figure near or under that is reporting the instrument, not the
card, and per-card execution values in that range are not comparable with each
other.

**Cold** means a fresh browser context per sample: no HTTP cache, no storage,
no service worker carried over. It is client-cold only — the dev server's
transpile cache, the realm index, and the OS page cache stay warm across every
sample, so only the first sample of a run is ever server-cold. **Warm** repeats
the same full document navigation in the same context, so it measures a reload
with a warm client cache. It is deliberately _not_ the client-side route
transition a user makes moving between cards in the Host; that is a different
measurement and this instrument does not make it.

Sign-in happens once before any sample and the captured session is replayed
into each context, so the login round trip is never inside a measured number
while every sample still arrives authenticated.

Each reported figure is a median. A sample that never reached a rendered card
is excluded from the medians and counted separately, and so is one that landed
on an error card — an error occupies the same surface as a card, so "a surface
appeared" is not on its own evidence that anything rendered.

## Environment

| Field           | Value                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Host            | `https://localhost:4200`, the Vite development server                                                                                |
| Realms measured | base, skills, experiments — all fully indexed before the run                                                                         |
| Commit          | `b35a9017`                                                                                                                           |
| Browser         | Chromium 141.0.7390.37                                                                                                               |
| Node            | v24.17.0                                                                                                                             |
| Machine         | 4 vCPU Intel Xeon @ 2.10 GHz, 15 GiB RAM, Linux 6.18                                                                                 |
| Concurrent load | the stack (realm server, worker, prerender, Vite) idle at rest; nothing else running, load average under 0.5 at the start of the run |

The last row is part of the measurement. The browser and the whole stack share
four cores, so a run started while a realm is still indexing measures the
contention, not the Host — an earlier run under load produced totals about a
third higher with roughly double the spread. Compare against a re-run in this
same shape.

## Numbers

Seven cards spanning trusted Base content, a workspace card over a large
authored realm, a `linksTo`/`linksToMany` graph, rich markdown with a theme,
and query-backed nested fields. Three cold samples each, three warm
navigations per cold sample: 21 cold and 63 warm samples. Every sample
rendered a real card — no errors, no unready samples.

| Card              | Cold doc | Cold app | Cold exec | Cold total | Warm doc | Warm app | Warm exec | Warm total |
| ----------------- | -------- | -------- | --------- | ---------- | -------- | -------- | --------- | ---------- |
| base-index        | 4,390 ms | 5,586 ms | 18 ms     | 5,604 ms   | 3,788 ms | 4,713 ms | 15 ms     | 4,720 ms   |
| base-community    | 4,220 ms | 5,195 ms | 9 ms      | 5,203 ms   | 3,859 ms | 4,816 ms | 19 ms     | 4,837 ms   |
| skills-index      | 4,550 ms | 5,534 ms | 9 ms      | 5,545 ms   | 3,885 ms | 4,733 ms | 13 ms     | 4,748 ms   |
| experiments-index | 4,485 ms | 5,885 ms | 17 ms     | 5,889 ms   | 3,794 ms | 4,814 ms | 26 ms     | 4,840 ms   |
| linked-blog-post  | 4,676 ms | 6,089 ms | 37 ms     | 6,116 ms   | 3,616 ms | 5,156 ms | 19 ms     | 5,175 ms   |
| rich-markdown     | 4,438 ms | 6,432 ms | 15 ms     | 6,446 ms   | 4,463 ms | 5,864 ms | 106 ms    | 5,961 ms   |
| query-field       | 4,285 ms | 5,398 ms | 15 ms     | 5,406 ms   | 3,578 ms | 4,670 ms | 15 ms     | 4,682 ms   |

**Document delivery is most of the cost.** Around 4.1 s of a 5.6 s cold
navigation is spent before `DOMContentLoaded` — roughly three quarters of it.
That is the unbundled module graph the dev server ships, and it is exactly the
part a production build replaces, which is why these absolute numbers do not
transfer.

**Card rendering is not measurably separate on these routes.** Execution
readiness runs 3–118 ms with a median of 17 ms, at or under the polling floor
described above, so these per-card figures report the instrument and cannot be
compared with one another. The window is empty because the Host's first paint
already carries the card: the app shell, the host chrome, and the card surface
were observed appearing on the same polling tick. There is no interval in which
a mounted app sits waiting for a card, so the split has nothing to divide here.
It divides something wherever a Host paints a loading state first.

**Warm saves about an eighth.** Cold total medians run 5.2–6.4 s and warm
4.7–6.0 s; across all samples the cold median is 5,604 ms against 4,880 ms
warm. A warm client cache helps this much and no more, because the dev server
revalidates and a warm sample is still a full document navigation, so the
application reboots every time.

**Spread.** Cold totals span 5,029–6,697 ms — tight enough that the per-card
ordering above is meaningful. Warm totals span 3,796–8,889 ms: the upper end is
a single outlier, and warm samples are the noisier measurement because three of
them share each browser context. The medians are the claim; a comparison drawn
from fewer than three samples per card is not one.

## Reproducing this

Start the stack, then:

```sh
pnpm --dir packages/host exec node scripts/execution-runtime-render-baseline.mts \
  --host https://localhost:4200 \
  --login <user>:<password> \
  --card 'base-index=/base/index' \
  --card 'base-community=/base/join-the-community' \
  --card 'skills-index=/skills/index' \
  --card 'experiments-index=/experiments/index' \
  --card 'linked-blog-post=/experiments/BlogPost/mad-as-a-hatter' \
  --card 'rich-markdown=/experiments/rich-markdown-playground-1' \
  --card 'query-field=/experiments/nested-query-field-playground' \
  --samples 3 --warm 3 --out baseline.json
```

That is the exact card set behind the table above. Wait for every realm it
touches to report ready before starting: a realm still indexing competes for
the same cores and inflates every number in the run.

`--out` writes the full per-sample record, not just the medians — every
individual timing, so a suspicious median can be checked against its samples.
`--chromium <path>` selects the browser binary when the environment's Chromium
is not the build Playwright would fetch; whichever binary was used is recorded
in the report, because a baseline compared against a different browser is not a
comparison.

## Re-recording it

Re-record whenever a claim needs a current reference point — before and after a
change whose performance effect is the argument for making it, and on any move
that changes how modules are delivered, since delivery is most of what these
numbers contain.

A re-run in a different environment is a new baseline, not an update to this
one: comparing a number from one machine against a number from another says
nothing. Record the environment block alongside the numbers every time.
