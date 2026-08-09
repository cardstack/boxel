# Realm-mirror compatibility strategy for the Boxel execution runtime

Status: working strategy, 2026-08-09. This document deliberately precedes a
new browser-comparison pass. It records what the current source and automated
tests prove, what they do not prove, and how existing workspace mirrors should
be converted into repeatable compatibility evidence.

## Executive assessment

The execution runtime is now a coherent architecture, not merely the earlier
Realm Sandbox proof of concept. It has:

- a cloneable semantic protocol shared by Direct, Capsule, and Sandbox;
- one Host-owned projection path for card data and presentation metadata;
- Direct as the compatibility oracle, Capsule as authored JavaScript in SES
  with Host Glimmer rendering, and Sandbox as child execution and DOM in an
  iframe;
- stable runtime handles, generations, last-known-good state, and volatile
  module promotion;
- scoped CSS policy, Sandbox fetch/media mediation, write proposals, live
  model synchronization, permissions, intrinsic/allocated layout, and three
  shipped Surface capabilities;
- a protocol-statement-to-test ratchet and substantial focused unit,
  integration, and acceptance coverage.

That is strong architectural progress. It is not yet evidence that the runtime
is a drop-in replacement for every existing card. Three different claims must
remain separate:

1. **Protocol conformance** — an individual record or operation behaves as
   specified in a focused test.
2. **Graph compatibility** — a real card graph retains the same semantics,
   rendering, interactions, and persistence when its nodes cross multiple
   execution boundaries.
3. **Product integration** — every Host surface that can display authored code
   actually routes it through the execution policy.

The current branch has good evidence for the first claim, partial evidence for
the second, and only three opted-in surfaces for the third. That is the central
finding of this audit.

## Evidence rules

Every scenario in the compatibility matrix must use exactly one of these
states:

| State        | Meaning                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Proven**   | A deterministic test asserts the relevant semantics, rendered result, interaction, persistence, and execution route at the required graph depth. |
| **Failed**   | A deterministic test or recorded comparison demonstrates a mismatch.                                                                             |
| **Unproven** | The code path or fixture exists, but no adequate assertion proves the behavior. Rendering without an exception is still unproven.                |
| **Deferred** | The protocol explicitly postpones the behavior and names the current replacement or refusal.                                                     |
| **N/A**      | The behavior cannot apply to this runtime, format, or fixture, with a reason recorded.                                                           |

Manual staging-versus-local observations are useful evidence, but they are not
`Proven` until distilled into deterministic assertions. A screenshot alone
cannot prove computed values, relationship states, mutation persistence,
execution route, or authority confinement.

## What is working, based on automated evidence

These are defensible claims about the branch before further browser testing.

### One semantic family across all three tiers

Direct, Capsule, and Sandbox implement the cloneable `BoxelRuntime` semantic
operations: load a type, create an instance from serialized data, describe the
type, inspect fields, build a render record, serialize, and dispose. Record
parity tests compare the tiers rather than maintaining three unrelated models.

### Direct and Capsule share Host rendering semantics

The Capsule evaluates authored semantics in SES and returns validated template
dependencies and data to Host Glimmer. Trusted Base identities remain
Host-owned. Tests cover ordinary fields, authored FieldDefs, computed values,
relationships, format selection, themes and presentation statics, stable
render slots, and multiple HMR/continuity paths.

### Sandbox has a real process and transport contract

The Sandbox is no longer selected by a URL flag. Static source and dependency
classification select it for code that needs browser/document authority. Its
tests cover bootstrap/origin checks, private MessageChannel setup, module
fetching, persistent rendering, generation ordering, media transport, height
semantics, write proposals, permission changes, errors, and teardown.

### Canonical data remains Store-owned

Canonical identity and relationship state do not cross as live Store or
CardDef objects. Runtime handles refer to runtime-local values. The Host
projects data into each execution purpose and validates writes on return.
Recent work also preserves live read-through and reconciles server echoes with
the generation that initiated a change.

### CSS and Surface semantics have explicit owners

Authored CSS is classified and scoped rather than being inserted into the Host
document indiscriminately. The Host-owned `SurfaceService` brokers presentation,
layout, and observation through opaque handles. The same three intents have
Direct/Capsule event adapters and Sandbox transport adapters.

### Format-dependent execution is possible

Sandbox is currently available for authored isolated and embedded renderers
(and an authored edit renderer). Compact formats such as fitted, atom, head,
and markdown stay Capsule. A card can therefore keep lightweight formats out
of iframes when browser-heavy dependencies are isolated into another module.
Source-policy tests prove this decision machinery; real split-module card
proof remains a test gap.

## Confirmed implementation or contract gaps

These findings come from the current source, not from a speculative visual
review.

### Product surfaces can still bypass execution policy

There are 23 literal `CardRenderer` call sites, but only three currently pass
`@execution='auto'`:

- interact-mode stack items;
- the code-mode card JSON preview panel;
- Host mode.

Search results, AI room cards, and markdown card embeds still have important
Direct paths. Search is the largest exposure because it can render results
from every subscribed workspace. Code playground rendering is deliberately
Direct in the current phase, but nested foreign cards in that surface need an
explicit policy decision.

This cannot be solved by declaring the runtime compatible. Each display
surface needs an explicit execution intent and a regression test that proves
which policy owns nested rendering.

### The normative operation list and implementation disagree

RP-14.2 still lists `getRenderSlot(instance, format)` and `invokeAction` as
cloneable `BoxelRuntime` operations. The actual `BoxelRuntime` and transport
operation union contain neither. Rendering is now correctly described in code
as a process-local effect, and mutation is a Host capability. The spec should
therefore distinguish:

1. the cloneable **semantic plane** (`BoxelRuntime`);
2. the process-local **rendering plane** (render slots and template programs);
3. the Host-granted **capability plane** (Surface intents, mutation, and future
   bounded actions).

The implementation direction is better than the stale operation list. The
document and conformance map need to adopt it explicitly.

### The protocol-to-test bijection is a ratchet, not proof of compatibility

`pnpm lint:rp-bijection` passes at the current ceiling, but 26 protocol
statements remain intentionally uncovered. They include relationship states,
identity/document behavior, mutation, CSS, prerendering, tier obligations, and
capability behavior. Some behaviors have tests without RP citations; others
are genuinely incomplete. The ratchet prevents silent coverage loss, but a
green ratchet does not make these semantics green.

### Several important behaviors are explicitly deferred

The current protocol and capability matrix still defer or partially cover:

- Sandbox `viewCard` and query-field delivery;
- full unloaded/loading/value/broken/refused relationship behavior;
- linked-card lazy loading in some nested paths;
- Sandbox card/realm URL context updates;
- broader mutation and refusal UI beyond the current write proposal;
- prerender-to-interactive Sandbox handoff;
- most of the proposed `surface*` family;
- BXL authorization projections, Guides/Annotations, Realm Scripts, and AI
  capabilities.

Deferred behavior is acceptable during development only when the UI refuses or
degrades explicitly. Partial JSON-looking output must not be mistaken for a
compatible render.

### Formats are still represented as a mostly closed vocabulary

The runtime knows the standard formats and applies hard-coded execution rules
to them. Boxel can grow custom formats, so the long-term description must be
open-ended: a type advertises available format names and each selected
renderer has a classified module graph and execution requirement. Standard
formats remain examples and defaults, not an exhaustive enum.

### Package compatibility needs an authoritative ledger

The Host loader can resolve a broad set of Boxel, Ember, Glimmer, and ecosystem
packages. The Capsule exposes a deliberately narrower set of trusted facades,
while other safe authored dependencies may be evaluated inside SES. Existing
mirrors use `ember-concurrency`, `tracked-built-ins`, helpers, resources,
destroyables, commands, and several UI packages. We need a generated import
ledger that records, for each specifier:

- trusted by-reference identity;
- evaluated inside Capsule;
- child-local trusted dependency in Sandbox;
- Host capability replacement;
- deliberately refused.

Without that ledger, package support is discovered one blank preview at a
time.

## Unproven high-risk graph behavior

These are not confirmed regressions. They are places where pairwise tests are
not enough.

- Rich Markdown rendering an authored embed that itself delegates a Base
  field or Sandbox child.
- Capsule parent to Sandbox child, including readiness, intrinsic height,
  parent stability, and teardown.
- A Sandbox card using child-local trusted Base plus an authored nested
  FieldDef in the same document.
- One Sandbox write observed by Direct, Capsule, and Sandbox consumers while
  permissions can be revoked.
- Prerendered embedded/isolated HTML handing off to an iframe without the
  wrong format, layout jump, or lost card header state.
- One CardDef whose atom/fitted renderer remains Capsule while isolated uses a
  separately imported browser-heavy Sandbox module.
- Surface presentation, layout, and observation at multiple alternating
  Host/Capsule/Sandbox depths.
- Default edit templates, nested FieldDefs, validation, and persistence when
  the authored isolated renderer has a different tier.
- Query and BXL-derived fields whose indexed value is projected into Sandbox
  without granting Store search authority.

## Mirror inventory snapshot

The local workspace mirrors provide much better compatibility breadth than a
small hand-written test realm.

### Purpose-built cohorts

- `/Users/chris/boxel-workspaces/sandbox-compatibility-corpus-20260803`
  contains 43 active GTS modules and representative instances. A source-level
  classifier pass selects 33 Capsule and 10 Sandbox definitions.
- `/Users/chris/boxel-workspaces/stack.cards/ctse/execution-runtime-suite`
  contains the cumulative composition suite currently implemented through use
  case 5. Its 13 definition modules classify as 11 Capsule and 2 Sandbox at
  the owning-source level.

### Real-workspace breadth

A current scan of the mirrored definition modules found approximately 401
CardDef/FieldDef/FileDef-derived visual definitions: 319 Capsule candidates
(79.6%) and 82 Sandbox candidates (20.4%) when considering each file's own
source. The largest useful mirrors include:

| Mirror                                   | Why it matters                                                                                        |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `software-periodic-workspace`            | Large graph; deep computed values, cardInfo, images, default/edit formats, trusted workspace shell.   |
| `realm-collaboration`                    | Relationships, queries, commands, cross-card coordination.                                            |
| `bid-room`                               | Dense computed and relationship-derived presentation.                                                 |
| `persistent-possum` and `blind-barnacle` | Surface composition, nested editing, presentation state.                                              |
| `tier-maker`                             | Modifiers, dynamic styling, navigator/browser behavior, media, iframe sizing, edit/return continuity. |
| `scrabble-stream`                        | Browser lifecycle and window-dependent interaction.                                                   |
| `signet`                                 | Canvas, pointer input, generated media/data URLs.                                                     |
| `img-to-3d`                              | Split browser-heavy modules, 3D/media libraries, commands, and expensive dependency graphs.           |
| `forge-gym-shift-board`                  | Top-layer UI, Host tools/commands, forms and authored edit behavior.                                  |
| `color-tree-playground`                  | Root module appears Capsule-safe but a renderer dependency promotes the selected format to Sandbox.   |
| BSL/Rich Markdown mirrors                | Trusted portals, Guide and Annotation, markdown, Mermaid, nested card embeds.                         |

Across representative mirrors the source scan found more than one hundred
`computeVia` uses, dozens of `linksTo`/`linksToMany`/`containsMany` fields,
query and command use, many format statics and cardInfo records, and browser
features including window/document/navigator, fetch, canvas, audio/video,
View Transitions, popovers, Three.js, and Leaflet.

### Important limitation of the source census

The percentages above are **not authoritative execution decisions**. A
Capsule-safe root can be promoted to Sandbox by the selected renderer's strong
dependency graph. This happens in real mirrors such as Color Tree, Playlist,
and image-to-3D flows.

An experimental filesystem resolver reproduced those promotions, but also
produced false Sandbox decisions when it could not reproduce Boxel's virtual
network, URL aliases, TypeScript resolution, or package shims. Therefore the
test harness must reuse the real `VirtualNetwork` and Host classifier. We
should not build a second approximate module resolver for tests.

## The mirror-driven testing strategy

The strategy has five layers. Browser differential testing starts only after
the first four produce a truthful matrix.

### Layer 0 — authoritative mirror manifest

Build a test-only mirror importer around the same `VirtualNetwork`, loader,
and classifier used by the Host. For each selected workspace it produces a
versioned manifest containing:

```ts
interface MirrorScenario {
  workspace: string;
  cardId: string;
  typeRef: CodeRef;
  sourceHash: string;
  moduleGraphHash: string;
  formats: string[];
  expectedRouteByFormat: Record<string, 'direct' | 'capsule' | 'sandbox'>;
  classificationReasons: string[];
  semanticAxes: string[];
  interactionAxes: string[];
  requiresAuthentication: boolean;
  expectedRefusals: string[];
}
```

The manifest is an inventory and review surface, not a hard-coded substitute
for policy. A changed route must update the manifest with a classifier reason;
an unexplained change fails the test. Source and graph hashes make mirror
drift visible.

The manifest builder should also emit the import compatibility ledger and
report unknown formats, unresolved modules, and unsupported capability
requests before a renderer is mounted.

### Layer 1 — semantic replay without a browser

Load mirrored source and card JSON through a test realm and the real virtual
network. For each scenario:

1. materialize the same document through every applicable runtime;
2. compare `BoxelDescription`, field descriptions, presentation metadata, and
   `BoxelRenderRecord` against Direct;
3. assert computed values and relationship state explicitly, including
   `undefined`, `null`, loading, broken, and refused cases;
4. serialize after permitted mutations and compare the canonical JSON-API
   result;
5. assert that denied reads and writes fail with named protocol diagnostics;
6. repeat after one module generation change and one canonical Store update.

This is where the airline computation, missing CurrencyField symbol, cardInfo,
image URL, query result, and nested relationship regressions belong. They do
not require screenshots to diagnose.

### Layer 2 — runtime DOM and interaction conformance

Mount the real `BoxelExecutionRenderer` in focused Host integration tests. Use
the manifest to select fixtures, not to mock their runtime. Assertions include:

- execution mode and classifier reason;
- requested and actual format;
- card header/title/theme/presentation metadata;
- meaningful DOM markers and text, not complete fragile HTML snapshots;
- computed style tokens, containment, dimensions, intrinsic/allocated height,
  and absence of Host chrome leakage;
- focus, pointer, keyboard, forms, drag/drop, media, canvas, and delegated
  render behavior where applicable;
- mutation proposal, optimistic/local state, server acknowledgement, error
  rollback, and a second consumer observing the same canonical update;
- HMR generation order, last-known-good preservation, and explicit reload;
- teardown of component, observers, Surface handles, ports, and iframe.

For Sandbox scenarios, at least one test must run the real child document and
assert its local Base/authored composition. Testing parent-side messages alone
is insufficient.

### Layer 3 — Host product-surface integration

Exercise the same card through every Host entry point that can render authored
code:

- interact stack;
- code-mode JSON preview and standard/default view;
- Host mode;
- search result and hydrated search card;
- AI room attachment/tool result;
- Rich Markdown embed and embed chooser;
- fitted gallery and inspector metadata;
- code playground, with a deliberate policy for nested foreign cards.

Each call site must declare an execution intent. Add a static test or lint rule
that inventories all `CardRenderer` call sites and fails when a new call site
does not choose `auto`, `direct-with-reason`, or an explicit trusted field
portal. This prevents future product UI from silently bypassing the runtime.

### Layer 4 — workspace workflow acceptance

Use a smaller set of user workflows rather than mounting isolated cards only:

- navigate a workspace and open/edit/save a nested card;
- switch formats repeatedly and confirm warm identity reuse;
- open search results from multiple workspaces;
- embed a card in Rich Markdown, including an alternating boundary graph;
- run a query/BXL-derived view without widening Store authority;
- edit one card while another mounted consumer observes it;
- trigger an out-of-band source update and an invalid source generation;
- revoke a write/read grant while a Sandbox is mounted;
- navigate across many workspaces and verify runtime/cache teardown.

### Layer 5 — browser differential and performance

Browser comparison has two cadences. A small commit-group smoke gate runs
after every coherent group of runtime changes. It catches broad product
regressions before we spend more time inside isolated protocol tests. The
larger differential and performance pass runs after Layers 0–4 have classified
failures. Both use the same staging/main reference and candidate branch.

The browser runner records both semantic probes and visuals:

- main/staging URL, branch URL, card and source hashes;
- selected/actual mode and classifier reasons;
- description/render-record diff;
- screenshot and computed-style diff;
- interaction and persistence result;
- cold render, warm render, format switch, and iframe-ready timings;
- console/protocol diagnostics and resource counts.

Use a deterministic seed to select ten additional mirrored cards. Run three
successive ten-card rounds with no new unexplained red cells before expanding
the rollout. A visual mismatch accompanied by semantic parity is a CSS/layout
bug; a record mismatch is a semantic boundary bug; a route mismatch is a
classifier or integration bug. This classification keeps browser debugging
focused.

#### Commit-group browser smoke gate

The executable cohort lives in
`packages/host/scripts/execution-runtime-browser-smoke.mjs`. It is imported by
the Codex in-app-browser runtime and receives the real in-app browser handle;
it does not launch a separate headless browser. The reference origin defaults
to `https://realms-staging.stack.cards`, and the candidate is the locally
running or deployed branch Host pointed at the same staging cards.

The six cases are deliberately graph-heavy rather than numerous:

| Case                        | Why it earns a place in every commit-group run                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| `Release/opening-night`     | Deep Capsule composition, Guide, theme, trusted Base portals, relationships, and computed values.   |
| `NestedFieldHost/sample`    | Capsule isolated output followed by the Direct default edit template and nested editable FieldDefs. |
| `MarkdownArticle/sample`    | Rich Markdown, linked images, and authored cards at atom, embedded, fitted, and isolated formats.   |
| `ComputedFlightPlan/sample` | Deep computed/BXL-shaped projection, delegated FieldDefs, theme, and scoped CSS.                    |
| `Track/corridor-take-one`   | Real Sandbox media lifecycle, cover image, iframe controls, and a user-triggered play transition.   |
| `PosterBoard/sample`        | Surface layout coordinates, image projection, visual composition, and hostile-CSS risk.             |

Before comparing output, the runner requires both origins to be authenticated.
A sign-in page aborts the run and is never recorded as a renderer result. The
browser profile only needs this one-time local sign-in; later commit groups
reuse it.

Each case asserts stable user-visible meaning rather than complete DOM HTML:

- specific text and computed values that would expose a lost boundary field;
- heading structure, healthy images, controls, and a non-zero card slot;
- the candidate's `data-boxel-execution` tier;
- default-edit field values or the media play-to-pause transition;
- absence of blank, loading-only, syntax-error, and runtime-error states;
- Host chrome colors plus screenshots for the Release and Sandbox media
  canaries when visual review is requested.

Sandbox cases have two independent readiness barriers. First, the Host must
show the prerendered semantic placeholder. Second, that placeholder must leave
the DOM and the cross-origin iframe must expose the same semantics and usable
controls. The runner reads the child through an in-app-browser frame locator
and performs the media action inside that frame. It never treats a correct
placeholder, a transport acknowledgement, or a same-looking placeholder
button as proof that the Sandbox became interactive.

The result also reports candidate/reference elapsed time and the Sandbox
handoff time. A candidate taking at least 2.5 times the reference duration (or
at least eight seconds total) produces a `performanceWarnings` entry. A warning
does not weaken correctness or block protocol work by itself, but it stays in
the commit-group record and must not trend upward across successive groups.
Failure to complete the Sandbox handoff within the case timeout remains a hard
correctness failure.

Staging is an oracle, not an automatically accepted golden file. If staging no
longer satisfies the checked-in invariants, the run reports
`reference-drift` and stops. We inspect the changed staging behavior before
updating expectations. This prevents a broken deployment from teaching the
branch a new broken baseline.

The decision rule is intentionally severe:

1. authentication failure or reference drift aborts without judging runtime
   correctness;
2. blank output, fatal UI, wrong execution tier, missing computed values,
   broken required images, or failed edit/media interaction blocks the current
   commit group;
3. any failure of the Release composition canary, or two failures anywhere in
   the six-card cohort, pauses architectural work for root-cause analysis;
4. a visual-only mismatch with semantic parity is fixed as CSS/layout work and
   does not justify weakening the protocol;
5. when all hard checks are green and the two visual canaries remain
   recognizably equivalent, graph-analysis and protocol work may continue.

For the routine gate, import the runner in the persistent in-app-browser Node
runtime and pass its signed-in browser handle, the candidate origin, and a
20–30 second per-case timeout. Call `closeExecutionRuntimeSmokeTabs(result)`
after every completed run. Keep a failed tab open only long enough to inspect
it, then close it too. Sandbox tabs own persistent iframes, loaders, media
elements, and message channels; accumulating completed runs can exhaust the
browser and manufacture false startup failures. This cleanup keeps the gate
cheap: one reference tab and one candidate tab are reused across all six
cases, while still exercising the actual application, iframe origin, cookies,
CSS, images, and interactions.

After a green structured run, inspect one fixed-viewport screenshot pair for
`Release/opening-night` and one for `Track/corridor-take-one`. The purpose is
not pixel equality. It is to catch host-chrome leakage, double framing,
incorrect intrinsic height, missing themes, and obviously remounted or blank
content that semantic text alone cannot expose.

#### First observed baseline — 2026-08-09

The first clean comparison established a useful split instead of a blanket
green result:

- Release, Nested Field Host, Rich Markdown, and Computed Flight Plan pass on
  both staging/main and the local candidate. The Nested Field interaction also
  proves that Edit routes to Direct and retains all four nested values.
- One warm six-case run completed, but repeated clean runs exposed a hard
  Sandbox lifecycle failure in both Track and Poster Board. The child logs
  `listening`, accepts `connect`, posts `ready`, and can finish rendering;
  nevertheless the parent later replaces the card with `Timed out connecting
to the Sandbox child` after about fifteen seconds.
- The successful warm run was already materially slower for Sandbox: Track
  took about 10.7 seconds versus 3.3 seconds on staging; Poster Board took
  about 11.1 seconds versus 3.1 seconds. These remain performance baselines,
  not correctness allowances.

The commit-group gate is therefore **red for Sandbox repeatability**. This is
not a fixture-content or classifier failure because two unrelated Sandbox
graphs reproduce it while the Capsule/Direct cohort remains green. The next
runtime repair should instrument and correct ownership of the bootstrap
control channel/process identity; expectations must not be relaxed and the
timeout must not merely be increased. Protocol analysis can continue, but no
commit group that claims Sandbox compatibility should advance until Track and
Poster Board each pass twice with tab cleanup between runs.

#### Sandbox lifecycle revalidation — 2026-08-09

Five consecutive clean-browser rounds of the two Sandbox cases now complete:

- Track crosses the prerender-to-interactive handoff and its real iframe Play
  control becomes Pause;
- Poster Board crosses the same handoff, enters the Direct default edit
  template, and accepts a real wheel scroll through its long form;
- each round closes both app tabs before the next one, so persistent iframe
  processes, loaders, media elements, and MessageChannels from earlier rounds
  cannot manufacture resource exhaustion.

Candidate handoff time was approximately 0.9–1.8 seconds for Poster Board and
1.6–1.9 seconds for Track. Total case time remains slower than staging and is
still a performance concern, but the earlier fifteen-second connection timeout
is not reproducible in this clean cohort.

The revalidation did expose a protocol-observability defect: ResizeObserver was
installed while the child render root was intentionally empty, before the
first render request. Its initial callback was logged and transported as
“render acked but produced no visible output,” even though no render had acked
and the subsequent real render succeeded. The child now suppresses render
diagnostics until an accepted generation has completed a Glimmer flush. Normal
bootstrap/RPC/render breadcrumbs are debug output; warnings are reserved for
real lifecycle failures. This keeps the smoke log usable as evidence instead
of making a healthy Sandbox look fundamentally broken.

The browser smoke gate now treats either a connection timeout or a blank-render
warning during these successful Sandbox cases as a regression. Semantic text
parity alone is insufficient because the prerender placeholder contains the
same text; the gate also waits for the live child, exercises its controls, and
audits the lifecycle log before declaring the case healthy.

#### Edit interaction baseline — 2026-08-09

The browser gate now includes two interactions that semantic text checks could
not cover:

- Release and Poster Board enter Edit and receive a real wheel gesture over the
  rendered card. Both staging and the local candidate expose a 592 px viewport,
  `overflow-y: auto`, and scroll to 900 px. Release has 3,861 px of content;
  Poster Board has 2,608 px.
- Nested Field Host enters Edit, replaces the title through the visible input,
  waits for the save acknowledgement, restores the original value, and verifies
  that the canonical value is visible again.

The scroll regression was a Direct-runtime wiring error: host layout attributes
were applied to the execution diagnostic wrapper instead of the rendered card
root. The Direct adapter now forwards those attributes to the component, which
matches the pre-runtime contract and keeps scroll ownership with CardContainer.
These interactions are hard smoke failures; a card that merely renders text but
cannot scroll or accept and restore input is not compatible.

## First mirror cohorts and assertions

The first pass should be intentionally small but graph-heavy.

| ID   | Mirror scenario                                                          | Required proof                                                                                                |
| ---- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| M-01 | Execution suite `Release/opening-night` and workspace grid               | Capsule rendering through trusted Base layout by reference; title, theme, fields, and navigation parity.      |
| M-02 | Execution suite Track/Playlist                                           | Audio/browser dependency promotes only the required renderer; parent composition and media lifecycle survive. |
| M-03 | Corpus `NestedFieldHost/sample`                                          | Default edit template, nested FieldDef controls, validation, save, and reload match Direct.                   |
| M-04 | Corpus `MarkdownArticle/sample`                                          | Trusted Rich Markdown portal, editable body, Mermaid, and authored card embed at alternating boundaries.      |
| M-05 | `software-periodic-workspace` invoice/workspace                          | Computed values, cardInfo, image/media projection, default edit behavior, and large-graph performance.        |
| M-06 | `middle-wolverine` airline flight                                        | Deep relationships, BXL/compute values, nested Base fields, currency/configuration metadata.                  |
| M-07 | `tier-maker` representative list                                         | Sandbox DOM, image URLs, modifiers, allocated versus intrinsic layout, edit-return continuity, persistence.   |
| M-08 | `color-tree-playground`                                                  | Dependency-graph promotion, themes/CSS variables, safe modifiers, format-dependent route.                     |
| M-09 | `realm-collaboration` representative graph                               | Same/cross-workspace links, query values, command/refusal boundary, multi-consumer synchronization.           |
| M-10 | Search + room + markdown surfaces using one Capsule and one Sandbox card | No Direct bypass; cheap prerender placeholder; correct nested execution policy.                               |

The purpose-built corpus remains the axis laboratory. The execution suite
remains the cumulative composition canary. Real mirrors supply combinations
the synthetic fixtures did not predict. None replaces the others.

## Compatibility cross-product

Each selected scenario should produce rows across these axes:

### Semantics

- primitive Base fields, enums, field configuration, contains/containsMany;
- linksTo/linksToMany in unloaded, loading, value, broken, and refused states;
- authored getters, `computeVia`, BXL/query/indexed projections;
- cardInfo, themes, images/media, header color, wide-format preference;
- inheritance, FileDef/FieldDef/CardDef descendants, code refs and ancestors;
- context values and absent-context fallback;
- canonical JSON-API serialization and side-loaded relationship handling.

### Rendering and interaction

- standard and custom isolated, embedded, fitted, atom, edit, head, markdown,
  plus one custom format;
- trusted Base portal, authored nested component, Rich Markdown embed;
- default edit template and authored edit template;
- forms, validation, focus, pointer, keyboard, drag/drop, popover/top layer;
- CSS scoping, theme variables, image/font/network styles, View Transitions;
- audio/video/playback, canvas, Leaflet, Three.js;
- Surface presentation, layout, and observation.

### State and lifecycle

- cold load, warm remount, format switch, rapid navigation;
- local edit, remote acknowledgement, remote conflicting update;
- valid HMR, invalid generation, recovery, explicit reload;
- two consumers in different tiers;
- permission grant/revocation;
- teardown, cache eviction, long cross-workspace navigation.

### Security

- no live Store, owner, loader, service, DOM node, class, or instance crosses;
- nested rendering re-enters Host policy;
- receiving relationship data does not widen search/read authority;
- every write is re-authorized by Host;
- Sandbox origin, transport version, generation, and capability ownership are
  checked;
- unknown record feature/version fails closed to last-known-good;
- trusted portals receive projected data and bounded callbacks only.

## Design improvements required for a durable protocol

### Separate three planes in names, types, and tests

The current implementation already points this way. Make it normative:

- **Boxel semantic runtime** — cloneable descriptions, field metadata,
  projections, render records, and serialization.
- **Boxel rendering runtime** — process-local component/template identity,
  render slots, formats, DOM ownership, and updates.
- **Boxel capability runtime** — Host-granted mutation, Surface, navigation,
  media, and future bounded operations.

Direct, Capsule, and Sandbox implement the same family, but a function or DOM
program never needs to pretend it is cloneable data.

### Make format descriptions open-ended

Replace boolean template flags and exhaustive format assumptions with a
description such as:

```ts
interface BoxelFormatDescription {
  name: string;
  renderer: CodeRef;
  sourceHash: string;
  requiredFeatures: string[];
  preferredExecution?: 'capsule' | 'sandbox';
  hasAuthoredTemplate: boolean;
}
```

Policy owns the final route. Author metadata may request stronger confinement
(`prefersFullSandbox`) but may never weaken it. Classification uses the
selected renderer's authoritative dependency graph, so moving browser-heavy
code to a separate module naturally keeps compact formats in Capsule.

### Give relationships an explicit state union

A cloneable linked value needs more than `value | undefined`. Use an explicit
state with `unloaded`, `loading`, `value`, `broken`, and `refused`, plus a
stable reference and diagnostic where applicable. Base portals consume this
state consistently. A query field receives projected results, not Store search
authority.

### Generate one import and capability registry

Trusted imports, Capsule facades, Sandbox child-local packages, protocol
features, Surface operations, and conformance tests should be generated or
validated from one registry. Adding a new Boxel API is incomplete until it
declares:

1. semantic owner;
2. boundary representation;
3. Direct/Capsule/Sandbox consumers;
4. authority and refusal behavior;
5. pairwise and graph tests.

This converts accidental implicit APIs into reviewed compatibility work.

### Align protocol versions with last-known-good behavior

Every semantic and transport record should carry its version and required
features. Consumers reject unknown required features before partially applying
a generation. The UI keeps the last-known-good output and exposes one named
diagnostic with mode, principal, format, generation, source hash, and missing
feature.

### Enforce Host integration coverage

A runtime can be internally secure while the product bypasses it. Treat the
`CardRenderer` call-site inventory as part of the security and compatibility
contract. New card-rendering surfaces must state their execution intent and
enter the graph through the Host router.

### Keep observability non-authoritative

The existing execution eyebrow is useful. Extend its debug data to include
route reason, selected renderer, protocol/features, generation, and parent
render slot. None of these strings grants authority; capabilities remain
Host-owned handles. The same trace makes mirror failures actionable.

## Completion gates

### Drop-in compatibility gate

The runtime is a drop-in replacement for existing cards only when:

- every Host card-rendering surface has an explicit execution intent;
- the first mirror cohort passes semantic, DOM, interaction, persistence, and
  lifecycle assertions without changing card source;
- the cumulative execution suite passes as one mixed-boundary graph;
- default and authored formats, nested fields, relationships, compute/query,
  cardInfo/themes/images, edit/write, and error recovery match Direct;
- three deterministic rotating ten-card mirror rounds add no unexplained
  failures;
- the cross-workspace soak shows bounded runtimes, ports, observers, styles,
  and caches;
- confined tiers do not gain authority relative to Direct policy.

### Future author upgrade gate

The upgrade API is ready when authors can deliberately use:

- open-ended per-format renderer modules;
- `prefersFullSandbox` to strengthen isolation;
- documented `surfacePresentation`, `surfaceLayout`, and `surfaceObserve` with
  identical semantics in Direct, Capsule, and Sandbox;
- a small, versioned capability discovery/refusal API;
- projected relationship/query data and explicit grants without Store access;
- split modules to keep safe formats in Capsule and browser-dependent formats
  in Sandbox;
- stable diagnostics explaining why each format received its execution tier.

Future Surface additions should stay narrow. Store/search, secrets, AI,
commands, and authorization are separate Host capabilities rather than being
hidden under the `surface*` prefix.

## Recommended implementation order

1. **Build the authoritative mirror manifest and import ledger.** Reuse the
   real virtual network and classifier; do not build another resolver.
2. **Resolve protocol drift.** Separate semantic/render/capability planes,
   correct RP-14.2, and update the test bijection.
3. **Close Host surface bypasses.** Start with search, room cards, and markdown
   embeds, with execution-intent inventory enforcement.
4. **Add the graph gauntlet using real mirror fixtures.** Prioritize Rich
   Markdown, Capsule-to-Sandbox, child-local Base plus authored fields,
   multi-consumer writes, and default edit.
5. **Complete relationship/query and prerender handoff semantics.** Make every
   unsupported state an explicit refusal.
6. **Generate the package/capability compatibility ledger.** Close only the
   imports exercised by the first cohorts before broadening it.
7. **Run workspace workflows and the cross-workspace soak.** Fix lifecycle and
   cache bounds before visual scale testing.
8. **Begin browser differential testing.** Use semantic probes plus screenshots,
   then three rotating ten-card rounds.

This order preserves the architecture while forcing compatibility claims to be
earned by real Boxel graphs. It also makes browser comparison the final
diagnostic layer, not the only mechanism capable of discovering a missing
protocol field.
