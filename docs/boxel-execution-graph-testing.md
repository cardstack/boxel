# Boxel execution graph testing

This is the cheap correctness gate between implementation work and the real
workspace smoke corpus. It treats Boxel rendering as an alternating-owner
graph, not as three unrelated renderers.

## One fast command

From `packages/host`, with the ordinary Host build and test services available:

```sh
pnpm exec ember test --path dist --filter "Boxel execution graph" \
  2>&1 | tee /tmp/host-test-execution-graph.log
```

The filter runs both the small deterministic graph checks and the authoritative
realm-mirror integration module. It checks the routing truth table, all
required boundary-edge types, the structural authority/lifecycle axioms, and
exact Capsule composition for nested FieldDefs, linked cards, independent
formats, and Rich Markdown card embeds.
Every minimum-gate path now names its executable evidence. The historical
labels remain available for new scenarios while they are being developed:

- `exact`: an integration or acceptance test already exercises the behavior;
- `protocol-only`: the contracts and route are tested, but not the whole UI;
- `browser-gated`: a real child document, interaction, or prerender handoff is
  still required before we can claim end-to-end proof.

That label is part of the fixture. A protocol test cannot silently turn a
missing browser proof green.

## The axioms

1. Every independently loaded nested Boxel re-enters Host routing policy.
2. A runtime-local FieldDef/component stays in its parent Capsule or Sandbox.
3. A trusted Base portal is Direct but receives projected data and bounded
   callbacks; it cannot transfer its owner or Store to authored code.
4. Every Surface or mutation capability terminates in the Host, where grants
   and writes are revalidated.
5. A relationship is a graph edge, not authority. The child keeps the viewer
   principal unless the Host issues a separate explicit grant.
6. Sandbox identity is the stable mounted surface, not the card URL or Realm.
7. Compact formats never allocate inline iframes. Browser-heavy renderers use
   Sandbox for isolated/embedded/authored-edit and must provide a safe compact
   module or fail closed in Capsule.
8. Prerendered HTML is inert and can only hand off through Host policy to an
   interactive runtime.
9. Teardown is local: releasing a child cannot invalidate a surviving parent,
   sibling, shared Capsule, or trusted Direct runtime.
10. Unknown protocol features retain last-known-good output instead of
    partially rendering an unrecognized record.

## The thirteen-path gauntlet

The executable declarations live in
`tests/helpers/boxel-execution-graph.ts`. They cover ordinary Capsule, trusted
Base FieldDef portals, recursive fields, linked cards, Rich Markdown embeds,
Capsule-to-Sandbox delegation, Sandbox-local composition, writes and
reconciliation, prerender handoff, warm formats, split compact/browser modules,
Surface capabilities through both boundary tiers, and the full alternating
Capsule → Direct → Capsule → Host → Sandbox → Host → Capsule reconciliation
path.

The minimum gate admits no `protocol-only` or `browser-gated` rows. Each row's
`evidence` list points at its browser-QUnit or signed-in product smoke proof;
the graph suite fails if a row loses that evidence or is demoted. New rows may
start at a weaker label, but cannot enter the minimum gate until their exact
proof lands in the same change.

## Performance baselines

Performance has two layers and should not be reduced to one flaky CI timeout:

1. The deterministic suite records the median warm routing/retention cost for
   Direct, Capsule, and Sandbox over five 10,000-route samples. Expand the
   passing performance assertion in QUnit or search the captured log for
   `BOXEL_EXECUTION_ROUTING_BASELINE` to see the values. This deliberately
   excludes runtime construction, module evaluation, DOM, and iframe startup.
2. The persistent in-app-browser smoke runner records cold total time, warm
   total time, and Sandbox prerender-to-interactive handoff for the six-card
   cohort in `boxel-realm-mirror-compatibility-strategy.md`.

Pass `performanceRepeats: 1` (or more) to the browser runner when collecting a
baseline. Its `performanceBaseline` result separates three non-equivalent but
user-meaningful timings:

- Direct: the trusted Base click-to-edit-ready transition;
- Capsule: semantic page readiness on cold and warm navigation; and
- Sandbox: semantic page readiness plus the distinct iframe-interactive
  handoff, on cold and warm navigation.

The labels are intentional. A Direct in-document transition must not be
presented as though it were a cold document navigation, and prerender text must
not be presented as Sandbox interactivity.

When localhost authentication is scoped to an existing in-app-browser tab,
pass that handle as `candidateTab`. The runner reuses it instead of opening an
unauthenticated scratch tab; this keeps authentication setup outside the
timing window.

**Staging-auth invariant:** no **Continue with Google** option means the Host is
not staging-backed. Stop; do not enter staging credentials or record results.

The local Host must still be built against the same services as the reference.
For the staging differential, use `packages/host/config/staging.env` (staging
Matrix plus staging realm, Base, Catalog, Skills, and OpenRouter URLs). The
sign-in screen is the human-visible preflight: it must offer the same staging
providers, including **Continue with Google**. If that option is absent, the
Host is pointed at local Matrix and the browser gate must stop before accepting
credentials or measuring a card. An HTTP 200 from localhost is not proof that
the candidate is staging-backed.

Run focused QUnit builds **before** starting the staging-backed browser Host.
`vite build --mode development` regenerates Embroider's environment entry with
local Matrix/Base URLs; a dev build performed while a staging Vite server is
open can therefore reload that server into local mode. The reliable order is:

1. finish the focused build and QUnit runs;
2. start (or restart) the Host with `scripts/start-host.sh staging`;
3. inspect the environment meta or, more visibly, require **Continue with
   Google** before signing in;
4. run the in-app-browser smoke without another Host build in parallel.

Use environment mode for collision-free tests that need a complete local
service stack, isolated Postgres database, and isolated realm root. It is not
a substitute for the staging differential: this gate intentionally uses the
staging launcher and the staging identity provider.

For review, compare medians and retained-runtime counts to the previous local
record. Correctness still blocks immediately; a performance regression is
reported separately so it cannot be “fixed” by weakening a semantic assertion.

### Initial record — 2026-08-09

Chrome 151, local development build, focused graph suite:

| Warm routing decision | Median ms/op |
| --------------------- | -----------: |
| Direct                |      0.00002 |
| Capsule               |      0.00048 |
| Sandbox               |      0.00055 |

These figures show that policy routing and retained-runtime lookup are not a
material source of UI latency. They do not measure evaluation or rendering.

The same browser runner produced this reference-only readiness record against
the current staging Host (one warm repeat):

| Cohort/transition                | Cold median | Warm median |
| -------------------------------- | ----------: | ----------: |
| Trusted default-edit transition  |     3211 ms |           — |
| Capsule-designated cards         |     2418 ms |     2249 ms |
| Sandbox-designated cards on main |     2486 ms |     2217 ms |

The final row is a semantic control cohort: main does not run those cards in
the branch's iframe runtime, so it has no iframe handoff measurement. The
branch-side browser record is intentionally still blank because the local
preview session returned to the sign-in screen on hard navigation. It must be
collected from a signed-in, reload-persistent localhost session; an
authentication screen is not a renderer performance result.

The broad reference lane is also established: main rendered
`FormatPreviewBatchOne` (35 delegated format boundaries) in 4131 ms with 89
headings, 41 controls, and 15 loaded image elements. The staging-backed
candidate initially remained human-auth gated; the runner correctly stopped at
the Google-enabled sign-in screen instead of recording that screen as a
renderer failure or timing sample.

### Signed-in staging differential — 2026-08-09

After the human completed Google sign-in, the same persistent tabs passed the
full six-card differential. This run includes three trusted Direct edit
transitions, four Capsule cards, two real Sandbox children, media playback,
default nested editing, Rich Markdown delegation, computed fields, image
delivery, and Sandbox teardown.

| Cohort/transition                            | Staging/main | Branch candidate |
| -------------------------------------------- | -----------: | ---------------: |
| Trusted default-edit transition              |      3111 ms |          3081 ms |
| Capsule cold median                          |      2524 ms |          2711 ms |
| Capsule warm median                          |      2474 ms |          2935 ms |
| Sandbox-designated cold/main vs real Sandbox |      2160 ms |          4485 ms |
| Sandbox-designated warm/main vs real Sandbox |      2176 ms |          4349 ms |
| Real Sandbox cold interactive handoff        |          n/a |          1476 ms |
| Real Sandbox warm interactive handoff        |          n/a |          1208 ms |

All semantic, interaction, execution-tier, lifecycle, and teardown assertions
passed. The Sandbox timing is expected to be slower than main's in-document
semantic control, but the current roughly two-second additional cost remains a
concrete optimization target.

The 35-boundary broad card also passed in both tabs: 2567 ms on main and 5090
ms on the candidate. The candidate exposes additional trusted default Head
preview structure, so raw heading totals are diagnostic rather than an exact
visual-parity assertion. The required authored content, controls, images, and
delegated formats were present.

### Same-document lifecycle soak — 2026-08-09

`runExecutionRuntimeNavigationSoak()` opens and closes six representative
cards through the compatibility workspace's real buttons. It intentionally
does not use `page.goto()` between samples, because a hard document navigation
would hide app-lifetime retention. The cohort covers nested Capsule fields,
Rich Markdown, computed values, and two Sandbox children.

After three complete cycles on both main and the candidate:

- all 18 opens settled and all 18 closes returned to the workspace;
- the candidate used the expected Capsule/Sandbox tier on every open;
- no Sandbox iframe or loading indicator survived any close;
- candidate style count was unchanged across the last two cycles;
- candidate DOM and style counts were identical across the last two cycles;
- main style count was unchanged across the last two cycles and its residual
  DOM varied by one node.

The cold pass legitimately materializes templates and styles. Report it
separately from the last-cycle delta; treating cold cache population as a leak
would create a misleading failure. These DOM/style/iframe counts are a cheap
lifecycle gate. Exact retained-heap and Core Web Vitals analysis still requires
the Chrome DevTools MCP server.
