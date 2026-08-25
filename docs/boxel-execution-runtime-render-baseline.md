# Boxel execution runtime: render baseline

## What this is for

Every performance claim the execution runtime makes — "no regression", "the
cage costs nothing here", "this cache paid for itself" — needs something to be
measured against. This document is that reference point: the method, the
environment, and the numbers a run of that method produces.

The instrument is
[`execution-runtime-render-baseline.mjs`](../packages/host/scripts/execution-runtime-render-baseline.mjs).
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

**Cold** means a fresh browser context per sample: no HTTP cache, no storage,
no service worker carried over. **Warm** repeats the navigation in the same
context, which is what a user moving between cards experiences. Sign-in happens
once before any sample and the captured session is replayed into each context,
so the login round trip is never inside a measured number while every sample
still arrives authenticated.

Each reported figure is a median. Samples that never reached a rendered card
are excluded from the medians and counted separately, so a card that failed to
settle cannot quietly lower an average.

## Environment

| Field           | Value                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| Host            | `https://localhost:4200`, the Vite development server                                                       |
| Realms measured | base, skills, experiments — all fully indexed before the run                                                |
| Commit          | `c7860f18`                                                                                                  |
| Browser         | Chromium 141.0.7390.37                                                                                      |
| Node            | v24.17.0                                                                                                    |
| Machine         | 4 vCPU Intel Xeon @ 2.10 GHz, 15 GiB RAM, Linux 6.18                                                        |
| Concurrent load | the full stack (realm server, worker, prerender, Vite) on the same 4 cores as the browser under measurement |

The last row matters as much as the others. A 4-core machine running the whole
stack and the browser is contended by construction, and the spread below is
mostly that contention. Compare against a re-run in this same shape, not
against a number from a quiet workstation.

## Numbers

Seven cards spanning trusted Base content, a workspace card over a large
authored realm, a `linksTo`/`linksToMany` graph, rich markdown with a theme,
and query-backed nested fields. Three cold samples each, three warm
navigations per cold sample: 21 cold and 63 warm samples in total. Every
sample rendered a real card — no errors, no unready samples.

| Card              | Cold doc | Cold app | Cold exec | Cold total | Warm doc | Warm app | Warm exec | Warm total |
| ----------------- | -------- | -------- | --------- | ---------- | -------- | -------- | --------- | ---------- |
| base-index        | 5,738 ms | 7,551 ms | 40 ms     | 7,594 ms   | 4,712 ms | 6,944 ms | 14 ms     | 6,958 ms   |
| base-community    | 5,545 ms | 6,747 ms | 26 ms     | 6,777 ms   | 4,365 ms | 5,622 ms | 18 ms     | 5,641 ms   |
| skills-index      | 6,295 ms | 7,618 ms | 8 ms      | 7,635 ms   | 4,822 ms | 5,897 ms | 23 ms     | 5,956 ms   |
| experiments-index | 5,540 ms | 7,413 ms | 21 ms     | 7,419 ms   | 5,775 ms | 7,178 ms | 9 ms      | 7,193 ms   |
| linked-blog-post  | 5,875 ms | 7,905 ms | 23 ms     | 7,936 ms   | 5,315 ms | 7,512 ms | 20 ms     | 7,531 ms   |
| rich-markdown     | 6,043 ms | 8,424 ms | 20 ms     | 8,449 ms   | 5,436 ms | 7,575 ms | 154 ms    | 7,712 ms   |
| query-field       | 5,654 ms | 7,128 ms | 30 ms     | 7,192 ms   | 4,711 ms | 6,212 ms | 20 ms     | 6,216 ms   |

**Document delivery is most of the cost.** Around 5.5 s of a ~7.5 s cold
navigation is spent before `DOMContentLoaded`. That is the unbundled module
graph the dev server ships, and it is exactly the part a production build
replaces — which is why these absolute numbers do not transfer.

**Card rendering is not measurably separate here.** Execution readiness runs
3–355 ms with a median of 20 ms, because the Host's first paint already carries
the card: the route resolves the card before the app shell renders, so there is
no window in which a mounted app is waiting for a card. The split still earns
its place — it separates the two the moment a Host paints a loading state
first, which is what a Sandbox handoff or a slow authenticated load does — but
on this build essentially all the cost is in the application part.

**Warm saves about a tenth.** Cold total medians run 6.8–8.4 s and warm 5.6–7.7 s.
An HTTP cache helps less than it might, because the dev server revalidates and
the application still reboots on every document navigation.

**The spread is wide.** Cold totals span 6,597–9,236 ms and warm totals
4,683–9,701 ms across all cards. On a contended machine a single sample says
little; the medians are the claim, and a comparison drawn from fewer than three
samples per card is not one.

## Reproducing this

Start the stack, then:

```sh
pnpm --dir packages/host exec node scripts/execution-runtime-render-baseline.mjs \
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
