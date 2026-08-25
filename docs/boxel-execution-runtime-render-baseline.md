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

<!-- environment -->

## Numbers

<!-- numbers -->

## Reproducing this

Start the stack, then:

```sh
pnpm --dir packages/host exec node scripts/execution-runtime-render-baseline.mjs \
  --host https://localhost:4200 \
  --login <user>:<password> \
  --card 'base-index=/base/index' \
  --samples 3 --warm 3 --out baseline.json
```

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
