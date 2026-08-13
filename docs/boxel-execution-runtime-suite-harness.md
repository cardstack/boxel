# Boxel execution runtime suite — fixture harness

The acceptance suite specified in
[boxel-execution-runtime-composition-suite.md](boxel-execution-runtime-composition-suite.md)
needs a place to live while the execution runtime is being built. This document
describes the harness that hosts it: what it is, what it can already answer,
and the single seam the runtime must fill.

The harness is a Boxel realm, not a test file. That is deliberate. The suite's
own pass criteria include "a passing placeholder, raw JSON dump, blank panel,
or inert control is a failure even when no exception was thrown" — a claim that
can only be settled by mounting the real Boxel and looking at what it produced.

**Location.** Studio lane:
`https://realms-staging.stack.cards/ctse/execution-runtime-suite/`.
Partner lane: `https://realms-staging.stack.cards/ctse/execution-runtime-partner/`
(created for use case 5). The Lab lane arrives with use case 9.

## Built on the current API

Every module in the suite uses only the API documented in the shipped Boxel
author guidance: `CardDef`, `FieldDef`, `contains` / `containsMany` /
`linksTo`, `Component` formats, base fields, `enumField`, `Command`, and
ordinary Glimmer. Nothing imports the execution runtime, because it does not
exist yet. Consequences worth stating plainly:

- the suite runs today, so a red row is a real defect, not scaffolding;
- the boundary lane is **declared, not observed** — see the seam below;
- when the new API lands, a couple of cases get refactored onto it and their
  boundary rows go green. The remaining cases keep working unchanged, which is
  itself the regression signal: adopting the runtime must not require rewriting
  ordinary authored cards.

## Two deliverables per case

Each use case pins **two** cards, and they are different products:

|                     | What it is                                                                             |
| ------------------- | -------------------------------------------------------------------------------------- |
| **a. Diagnostic**   | The `SuiteCase` instrument that measures the runtime.                                  |
| **b. Product card** | What an end user is actually handed — a believable, finished card, not a fixture stub. |

For use case 1 that is `SuiteCase/uc-01-release-identity` (diagnostic) and
`Release/opening-night` + `Release/second-pressing` (product). The diagnostic
links the product card through `subject` and **mounts the real instance**,
never a copy of its markup. That constraint is what makes use case 12's
composition claim testable at all, so it holds from case 1 onward.

## Layers

```
suite/vocabulary.gts          evidence kinds, execution tiers, source lanes, probe rules
suite/probe.gts               FieldProbe FieldDef + runFieldProbe evaluator
suite/visual-expectation.gts  VisualExpectation FieldDef + evaluateVisual + visualProbe modifier
suite/expected-route.gts      ExpectedRoute FieldDef + runRouteCheck
suite/suite-case.gts          SuiteCase CardDef — the instrument
suite/suite-home.gts          SuiteHome CardDef — the index
suite/run-case-command.gts    RunCaseCommand — durable verdicts
lib/bxl.ts, lib/bxl/          vendored bxl 0.5.1 realm bundle (pinned)
use-case-1/release.gts        the first subject Boxel
use-case-1/release-schema.ts  the readable schema Release publishes to a Guide
use-case-2/catalog-metadata.gts   contained metadata + field configuration
use-case-2/guided-card-info.gts   CardInfoField subclass — the guide attachment
use-case-2/release-guide.gts      Guide card, cascade, bxl evaluation, GuidePanel
use-case-3/release-theme.gts      poster tokens — CSSValueField + TypographyField
use-case-3/deluxe-release.gts     DeluxeRelease extends Release; enums, images, tags
suite/interaction-script.gts      InteractionStep fixture + step runner (added by case 4)
use-case-4/playback-group.ts      playback-group registry — the surfacePlayback seam
use-case-4/track.gts              Track + MusicPlayer
use-case-5/playlist.gts           Playlist — relationship states, cross-realm, query fields
assets/                           real image and audio files, typed by the realm from their bytes
```

Nothing above `use-case-1/` knows anything about music releases.

Cases 2 and 3 added subject modules and fixture JSON only. **Case 4 broke
that**, and the earlier claim that it would hold through case 12 was wrong:
interactive evidence is a claim about what happens _after_ a user acts, and
nothing in the harness acted on anything. `suite/interaction-script.gts` and a
fifth lane on `SuiteCase` are the addition. Expect the same for a genuinely new
kind of evidence — the rule is that a case may not need a _bespoke case
component_, not that the vocabulary is frozen.

## Assertions are data, not code

A `SuiteCase` carries three `containsMany` fixtures, all authored in the case's
JSON instance:

| Fixture             | Field          | Answers                                                  |
| ------------------- | -------------- | -------------------------------------------------------- |
| `FieldProbe`        | `probes`       | Semantic evidence, evaluated now                         |
| `VisualExpectation` | `expectations` | Visual evidence, measured against the live DOM           |
| `ExpectedRoute`     | `routes`       | Boundary evidence, **pending** until the runtime reports |

### FieldProbe

`{ path, rule, expected, claim, evidence }`. `path` is a dot path read through
the ordinary Card API — no runtime internals, no live constructors. Rules:

| Rule            | Meaning                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------- |
| `defined`       | value is neither null nor undefined                                                          |
| `unset`         | value is null or undefined                                                                   |
| `equals`        | scalar compare form equals `expected` (`''`, `'0'`, `'false'` are distinct)                  |
| `type`          | `string` \| `number` \| `boolean` \| `bigint` \| `date` \| `object` \| `null` \| `undefined` |
| `matches`       | `new RegExp(expected)` matches the compare form                                              |
| `date`          | value is a valid Date whose **local** `YYYY-MM-DD` equals `expected`                         |
| `datetime`      | value is a valid Date whose `toISOString()` equals `expected`                                |
| `not-untitled`  | value is a string that does not begin `Untitled`                                             |
| `has-format`    | `subject.constructor[path]` is a component class                                             |
| `static-equals` | `subject.constructor[path]` compare form equals `expected`                                   |

`date` uses local components on purpose: `DateField` deserializes through
date-fns `parse`, which produces a local Date.

Every branch is total. A probe against a missing field reports a failure with
the observed value; it never throws and never renders a blank row.

### VisualExpectation

`{ format, visibleText[], roles[], images[], cssVariables[], geometry[], note }`.
The case mounts the subject once per expectation at that format, then measures
the produced DOM after paint and again after a settle delay.

- `roles` accept implicit roles (`link`, `heading`, `textbox`, …), not just
  `[role=…]`.
- `images` are alt text; an `<img>` that is present but not decoded fails.
- `cssVariables` are `--token: value`, optionally scoped:
  `.release --release-accent: #f2c14e`.
- `geometry` is `selector` or `selector >= WIDTHxHEIGHT` in CSS pixels.
- A `fitted` expectation mounts the subject into all four container classes
  (badge 150×40, strip 250×65, tile 170×250, card 400×275) in one pane.

`roles`, `geometry` and `cssVariables` name **real selectors in the product
card's markup**, so redesigning a subject is a two-file change: the template
and the case fixture. That coupling is deliberate — it is what stops a
redesign from silently dropping a required element — but it means a visual
refactor that forgets the fixture shows up as red geometry rows, not as a
passing suite.

The measuring modifier takes **only a pane index and a stable component
arrow** — never the expectation object, and never a `(fn …)` closure. This is
load-bearing, not stylistic. The getter that builds the panes reads the
recorded results, so it recomputes whenever a measurement lands; any
object-valued argument would be a fresh reference on each recompute, Glimmer
would see changed args, re-run the modifier, measure again, and record again.
That loop does not settle — it overflows the stack. The component resolves the
expectation by index instead, and an equality guard makes a repeat measurement
a genuine no-op as a second line of defence.

Measurement is scheduled with `scheduleOnce('afterRender', job, 'measure')` on
a per-install target, not a timer: the prerenderer blocks `setTimeout`
outright, and `scheduleOnce` cannot dedupe an inline closure (realm lint
enforces this — `ember/no-incorrect-calls-with-inline-anonymous-functions`).

### InteractionStep

`{ action, target, expected, attribute, settleMs, claim }`. Actions: `click`,
`assert-text`, `assert-absent`, `assert-name`, `assert-attr`, `assert-count`,
`assert-advanced`, `set-range`. `target` is a CSS selector resolved **inside
the mounted subject**, never globally, and `assert-name` computes the
accessible name the way a control is actually announced (`aria-label`, then
`aria-labelledby`, then text).

Two constraints, both load-bearing:

- **Operator-triggered, never automatic.** A script runs when someone presses
  Run. Auto-running would put a click — and the state change it causes —
  inside the render that produced the element being clicked, which is the same
  re-entrancy that overflowed the stack when the visual modifier took an object
  argument. It would also be meaningless in the prerenderer, which never clicks
  and blocks the timers a media element needs.
- **Pending until run.** A green row for a click nobody made would be worse
  than no row.

Steps run in order against one captured pane element, with `assert-advanced`
carrying a value forward between two readings. Known limit: the runner captures
**pane 0**, so a script drives the first declared expectation's mount. Asserting
against the embedded mount needs the runner to take a pane index.

### ExpectedRoute — **the seam**

`{ format, lane, expectedTier, capabilities[], observedTier, note }`.

`lane` ∈ `official | studio | partner | lab`; `expectedTier` ∈
`direct | capsule | sandbox`. The Phase 2 Host now marks every live mount with
`data-boxel-execution='direct|capsule|sandbox'` (and marks an inert indexed-HTML
placeholder as `prerender`). The realm fixture still needs a small adapter that
copies the live value into `observedTier`; until that adapter is installed, its
persisted route rows correctly remain `pending`. An unrouted boundary is never
a pass — the case's overall verdict is `pending` while any route lacks a trace.

**What the harness adapter must supply.** For each mounted render slot, observe
the Host diagnostic and write the selected tier back to the matching route's
`observedTier`. The suite compares and reports `pass` / `fail` with the mismatch
spelled out. That is the entire contract on the harness side; the execution
runtime does not know about probes, expectations, cases, or the command.

The composition-suite document lists a wider trace record (source generation
and hash, parent/child slot ids, Store revision, granted capabilities, mount
and stylesheet counts). Those become additional `ExpectedRoute` fields — or a
sibling `ObservedTrace` FieldDef — as the runtime starts producing them. The
tier is the minimum that makes the boundary lane meaningful.

## The Guide layer (use case 2) — applied

Use case 2 calls for `ReleaseGuide`: a data-authored Guide linked from
`cardInfo.guide`, with expression-backed visibility, constraints, computed
defaults, helper text and field order cascading base → domain → realm →
inline.

An earlier revision of this document called that unbuildable, on the grounds
that `CardInfoField` carries only `name`, `summary`, `cardThumbnail`,
`cardThumbnailURL`, `theme` and `notes`. That was right about the platform and
wrong about the conclusion. `CardInfoField` is an ordinary FieldDef, so a realm
can **subclass** it:

```ts
export class GuidedCardInfo extends CardInfoField {
  @field guide = linksTo(() => ReleaseGuide);
}
```

`Release` declares `@field cardInfo = contains(GuidedCardInfo)`, keeps every
inherited CardInfo field including the theme link, and `cardInfo.guide`
resolves today. The Guide layer is therefore **applied, not declared**.

### What runs it

The rule vocabulary is ported from the jqxl Guides spec (§38's annotation
types, §43.2's `Guide` CardDef shape) onto **bxl 0.5.1**, which ships a
first-class Boxel Guide runtime — `prepareBoxelGuide`, `BoxelGuideSpec`,
`BoxelFieldState`. jqxl is the predecessor language; bxl is what exists. The
bundle is vendored at `lib/bxl/index.ts` and pinned: an acceptance suite cannot
have its evaluator drift underneath its fixtures.

Nothing in the suite evaluates an expression by hand. Constraints, visibility
tests, suggestions and computed defaults are compiled once and evaluated
against a plain snapshot of the release.

Rules are authored in **readable BXL** — the Excel-like surface, not jq:

```
LEN(Catalog.Producer) > 0
Catalog.Process <> "lathe" OR Catalog.PressingRun <= 500
LEN(Catalog.Region) = 0 OR Catalog.Region = Catalog.Venue.Address.State
Completion < 100 OR IsAvailable = TRUE
ROUND(Catalog.Price.Amount * 1.1, 0)
```

Two conventions hold across every guide:

- **PascalCase paths, not quoted labels.** Both resolve — `Catalog.PressingRun`
  by key, `Catalog."Pressing Run"` by label — but the PascalCase form reads as
  a path rather than as prose, which matters when the expression is the thing
  under review.
- **No `REGEXMATCH`.** It is not a bxl builtin, and bxl compiles an unknown
  function to `null` instead of raising. As a constraint that fails closed, but
  for the wrong reason, and as a `computedVia` it would silently write null.
  Spell pattern checks out of real builtins:
  `LEFT(CatalogNumber, 4) = "STU-" AND ISNUMBER(VALUE(RIGHT(CatalogNumber, 4)))`.

Two responsibilities stay in the realm rather than in bxl:

1. **The cascade.** §43.2.1 says guides compose in order and later layers win.
   bxl takes one flat `BoxelGuideSpec`, so `composeFieldGuides` folds base →
   domain → realm → inline first: set scalars overwrite, blanks do not erase an
   earlier layer's value, and constraints concatenate. The fixture authors
   `.catalog.sleeveNote` twice, at `base` and at `domain`, precisely so the
   merge is observable — eleven authored rules compose to ten.
2. **Fail-closed reporting.** A compile error, a runtime error, or a
   non-boolean constraint result is a violation. `evaluateGuide` returns
   `applied: false` with the compiler's own message; it never returns an empty
   green result.

### The schema is load-bearing

`evaluateGuide` requires the governed card's `GuideSchema`, published next to
its snapshot (`RELEASE_GUIDE_SCHEMA` and `releaseGuideInput` on `Release`).
bxl compiles in schema-aware mode, so a rule naming a path the card does not
publish fails at **compile** time — `Unknown field 'venue' in schema-aware
path` — rather than evaluating to null and quietly passing. A typo'd guide
turns the panel red, which is the only useful behaviour for a suite.

`release-schema.ts` is its own module so both sides can import it — the
release to evaluate the guide, the Guide card to compile its own rules against
the real target via a small `target` → schema registry. The Guide card
therefore makes the same claim the release does, on the guide itself, where an
authoring mistake belongs.

A schema-free compile is **not** a usable fallback, which is worth recording
because it looks like one. bxl synthesizes a partial schema from the guide's
own `fieldPath`s; that puts a scope in play, which disables the PascalCase
fallback. `Catalog.Venue.Address.State` then fails with `Unknown field 'State'`
unless some fieldGuide happens to target that exact path. Compile against the
real schema or report that you could not — there is no honest middle.

### What case 2 now asserts

Twelve semantic probes cover the attachment (`cardInfo` is the subclass, the
inherited name and theme survive, `cardInfo.guide` resolves to a live
`ReleaseGuide`) and the rule data (target, counts, dot paths, layers, the
bxl source text of a constraint). One visual expectation covers the applied
panel: the single real violation, the cross-field suggestion drawn from
`.catalog.venue.address.state`, the `2 hidden by a visibility rule` footer, and
the absence of the fields those rules hide.

The guide route still reports `pending` — but for the ordinary reason every
route does, `observedTier` being unwritten, not because the feature is missing.

### The remaining seam

When the platform ships `guide` on `CardInfoField` itself, the refactor is
deleting `guided-card-info.gts` and changing one line on `Release`. The guide
instances, the rules, the cascade and the panel are unaffected. That is the
seam, and it is now much smaller than a missing feature.

## Verdicts

A case's isolated view rolls up four lanes: semantic, visual, interactive and
boundary. The
overall verdict is `fail` if any lane has a failure, `pending` if any lane has
a pending check, and `pass` only when every declared check is answered and
green. `RunCaseCommand` evaluates the semantic probes headlessly and persists
`lastRunAt` / `lastRunSummary` so the suite home can show verdicts without
mounting every case at once.

Note: existing-card `SaveCardCommand` is optimistic in the current host, so a
recorded run is durable only once the realm resource reflects it. The live
instrument, not the recorded summary, is the authority.

## Use case 1 — what is currently covered

`Release` (Studio lane) exercises the primitive, string-variant, time and
quantity field families through trusted Base field components in seven
declared formats (`isolated`, `embedded`, `fitted`, `atom`, `head`, `markdown`,
and the un-overridden default `edit`).

The fixture `Release/opening-night.json` is chosen so the distinctions that
matter cannot be faked: `unitsSold` is `0`, `isExplicit` is `false`, `edition`
is `''`, `pressNotes` is unset, and `preOrders` is `18446744073709551617` —
past `Number.MAX_SAFE_INTEGER`. All five survive a realm round trip.

43 semantic probes, 7 visual expectations and 5 expected routes are authored.
The routes are all `pending` by design.

`availabilityStatus` is a `computeVia` that reads only stored fields — a
computed that read the clock would render differently in the indexer than in
the browser and the suite would stop being deterministic. `catalogStamp` is an
ordinary getter chained onto it.

## Use case 3 — what is currently covered

`DeluxeRelease extends Release` and redeclares **one** format. `embedded`,
`fitted`, `atom`, `head` and `markdown` render through the parent's templates
against the child's data; `isolated` is the poster. Inherited computeds
recompute (`availabilityStatus`), and case 2's guide attachment survives the
subclass because `cardInfo` is inherited whole.

Overriding a format requires a loose annotation **on the parent**:
`static isolated: BaseDefComponent = ReleaseIsolated`. Without it the parent's
static is inferred as the concrete `typeof ReleaseIsolated` and no subclass can
override it — annotating the child does not help. This is how Base's own cards
declare formats, so it is the idiom rather than a workaround.

Three deliberately different enum shapes:

| Field          | Shape                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `stage`        | static rich options with labels **and** icons                                                                                    |
| `pressingTier` | options resolved from owner state — `lathe` is offered only when `catalog.pressingRun` ≤ 500, and the label interpolates the run |
| `sleeveFinish` | per-use `enumConfig` narrowing the FieldDef's five finishes to three                                                             |

The enum edge cases are real data rather than staged: `DeluxeRelease/corridor-tapes`
has `stage` unset, and `pressingTier` holding `lathe` — a value **outside its
own option list**, because the run grew past 500 after the value was entered.

**Images are real files.** `assets/*.png` and `assets/*.webp` are pushed like
any other realm file; the realm types them as `PngDef` / `WebpDef` from the
bytes and extracts intrinsic dimensions. `linksTo(ImageDef)` therefore links to
a **file path**, not to an authored instance, and the subtype resolves
polymorphically — the field never names it. `coverImageKind` /
`sleeveImageKind` store what resolved so a probe can assert it without
mounting anything.

The broken half of the URL/ImageDef pair is genuinely broken:
`insertImageURL` on `night-sessions` points at a file that is not there, and
`CoverArt` sets its `broken` flag from the `error` event rather than guessing
from the URL. A fallback that has never failed proves nothing. The fallback is
mounted only when a source was **declared** — an empty placeholder for artwork
that was never meant to exist reads as a defect, not as a fallback.

Note that realm asset URLs are authenticated: an unauthenticated `curl` returns
401 while the host and prerenderer load the bytes. Verify artwork through the
indexed `url` / `width` / `contentType`, not through a raw fetch.

**Theme and brand guide keep one canonical token source.**
`BrandGuide/night-sessions` is a local **instance** adopting the trusted
`BrandGuide` definition — not a subclass — linked through `cardInfo.theme`. It
computes functional CSS variables from its own palette:

```
--background: var(--sleeve-paper);   --moon-gold: #F2C14E;
--foreground: var(--corridor-ink);   --theme-heading-font-family: Playfair Display;
--primary:    var(--moon-gold);
```

`ReleaseTheme` maps poster roles onto those tokens and copies none of them.
Its `allTokensDerived` computed reports `derived` / `has-literals`, so a
hard-coded colour — the thing that would survive a theme relink — is data a
probe can catch rather than something review has to notice.
`BrandGuide/night-sessions-rotated` is the relink target, linked live from
`corridor-tapes`.

39 semantic probes, 4 visual expectations and 5 expected routes are authored.
The routes are all `pending` by design.

## Use case 4 — what is currently covered

`Track` links a real MP3 — pushed like any other file, typed `Mp3Def` from its
bytes, with `duration` extracted (18.207s) — plus the case-3 cover art **by
link**, not by copy. `MusicPlayer` holds `@tracked` play state, current time,
duration and volume; `Track` declares isolated, embedded, fitted (a bounded
mini-player that drops the transport entirely below the strip quantum, where no
control could be hit) and atom (a non-playing identity pill).

`edit` is deliberately **not** overridden. The spec requires that editing Track
metadata does not duplicate audio bytes into card JSON, and the default editor
— which edits the _link_ — is the evidence.

### Three silent failures a naive player has

Corrected against two existing workspace realms rather than discovered by
testing, which is the cheaper order:

1. **A native media element cannot authenticate.** `<audio src={realmURL}>`
   issues its own request and cannot attach the realm bearer token, so
   realm-hosted media 401s and the player does nothing visible. The player
   fetches with `credentials: 'include'` and hands the element an object URL,
   keeping the canonical URL as the fallback. `ctse/filedef-developer-handoff`
   ships this as `FileAudio` with `@loadAsBlob={{true}}`; prefer that component
   unless a custom transport is required, as it is here.
2. **An interactive child must swallow its own clicks.** Rendered embedded, the
   host tracks an ancestor element for click-to-open, so pressing play
   navigates instead. The guard has to live **inside** the player — a wrapper
   in the parent is an ancestor of the tracked element and sees the click too
   late. Bubble phase, attached via a modifier, so the player's own handlers
   have already run. `ctse/interaction-lab` benches E (❌ overlay) and K (✅
   child-owned guard) settle this.
3. **Media needs an unconditional caption track.** Realm lint reads the
   template AST, so a `<track>` behind a conditional does not satisfy
   `require-media-caption`.

### The surfacePlayback seam

There is no capability plane, so this is the third refactor seam alongside
`ExpectedRoute.observedTier`. Two halves, both narrow on purpose:

- The player touches exactly one ambient thing — the media element it rendered
  itself, held through a component-local ref. Never `document`, `window` or
  `navigator`. Swapping in a capability plane replaces that ref and five
  commands rather than rewriting the component.
- `use-case-4/playback-group.ts` is a module-scoped registry with no DOM and no
  Store handle. Two surfaces sharing a `playbackGroup` converge through it. Its
  `applying` latch drops re-entrant broadcasts, so A→B does not echo B→A — the
  same class of bug as the render loop, guarded the same way, by making the
  re-entrant path a no-op rather than hoping it settles.

### A bug the suite caught in its own subject

`durationLabel` first existed as a computed field and indexed as `--:--` on
both fixtures, although the linked `Mp3Def` carries `duration: 18.2`. A
`computeVia` that reads a linked card's **class** resolves at index time
(`audioKind` correctly reported `MP3 Audio`); one that reads a linked card's
**field value** does not. Duration is read at render time now. The rule:
`computeVia` may traverse a `linksTo` for identity, but must not depend on the
linked card's data.

18 semantic probes, 16 interaction steps, 4 visual expectations and 4 expected
routes are authored. The routes are all `pending` by design, and the
interaction steps are `pending` until run.

## Use case 5 — what is currently covered

The first case that crosses a realm boundary, and the first whose graph is
deeper than a pair.

### A relationship slot has five states

Reading the field alone collapses four distinct failures into `undefined`.
`getRelationshipMembershipState(instance, fieldName)` reports `present`,
`not-loaded`, `error`, `not-found` and `not-set`, and each renders as itself: a
spinner at stable height, a bounded error row, a bounded unavailable row, an
empty slot.

Two requirements come with it, both easy to miss:

1. **The template must ALSO read the field.** The membership getter is a _pure
   read_ — it entangles but never triggers `lazilyLoadLink`. Read only the
   membership and a `not-loaded` slot never starts loading, leaving a spinner
   that never resolves. `touchLinks` exists solely to perform that read and is
   called from `rows` so a later "remove unused getter" cleanup cannot quietly
   break it.
2. **`{{#each}}` must key on `reference`, never on the envelope.** The getter
   returns a fresh envelope on every call, so envelope identity is not stable
   across renders — keying on it re-creates every row each render and discards
   focus and in-row state.

### The hole

`Playlist/night-sessions-set` authors four slots and slot 3 points at a card
that does not exist. The indexed result:

```
trackCount: 4
tracks.0 -> corridor-take-one       present
tracks.1 -> licensed-interlude      present (Partner realm)
tracks.2 -> withdrawn-take-nine     BROKEN — holds its place
tracks.3 -> ferry-terminal-encore   present, trackNumber still 14
```

An unloadable entry is `undefined` **in place**, so the array length is
unchanged and position 4 is still position 4. Rows are numbered from the
membership index. `.filter(Boolean)` is confined to the running-time aggregate,
where dropping entries is what the aggregate means — applying it to the rows
would renumber everything after the break and a listener would click the wrong
track. Every row carries the same `min-height` for the same reason.

### Cross-realm

`Track/licensed-interlude` lives in the Partner realm and **adopts this realm's
Track module**, so the module reference and the instance reference cross in
opposite directions. Both resolve and index cleanly, and a computed declared
here (`audioKind`) evaluates against Partner data.

`recentTracks` is query-backed with `$REALM`, sort and page, scoped to _this_
realm on purpose: linking one Partner card explicitly is not the same as being
able to search that realm, and the query field is where that distinction is
visible. Membership is `undefined` while the search is in flight — distinct
from an empty result, and rendered differently.

### What is declared, not enforced

The **grant** is the honest gap. There is no per-card grant mechanism today.
The Partner realm is real and the link resolves, but "unreadable before an
explicit grant, readable after, without granting search over the realm" is a
route that reports `pending`. Same for query-fields-omitted-from-PATCH — case 7
is the first position that can test it.

### A cross-case assertion

The interaction script presses play on a **Track mounted inside the Playlist**.
If the host swallowed that click to navigate, the control name would not change
— so case 4's child-owned click containment is now tested under the nesting
condition it exists for.

16 semantic probes, 11 interaction steps, 4 visual expectations and 5 expected
routes are authored.

## Expected indexing findings

`boxel realm indexing-errors` is no longer expected to be empty on the Studio
realm. Use case 5 requires a broken link, and the realm correctly reports it:

```
[instance] .../Playlist/night-sessions-set.json  1 broken: tracks→.../Track/withdrawn-take-nine
```

That exact finding, and only that one, is the healthy state. Anything else is
real.

## Adding a case

1. Add `use-case-N/<subject>.gts` and its **product card** instances — built on
   the current documented API, finished enough that an end user would accept
   them.
2. Add the **diagnostic** `SuiteCase/uc-NN-<slug>.json`, linking `subject` to
   the real instance — never a copy of it.
3. Author probes, expectations and routes as data.
4. Pin **both** in `index.json` `entryPoints`.

No harness code changes. If a case cannot be expressed in the rule set, that is
a signal to add one rule to `vocabulary.gts` and `probe.gts` — not to write a
bespoke case component.

## Known toolchain baselines

`npx boxel parse` reports three errors on this realm that are pre-existing
toolchain gaps, reproducible in unrelated working realm code:

- `Cannot find module '@cardstack/boxel-host/tools/save-card'` — the bundled
  wildcard declaration does not resolve for local-workspace parse programs.
- `No overload matches this call` on any functional-modifier invocation in a
  template (reproduced with a two-line scratch modifier, and on
  `@context.cardComponentModifier` in shipped realm code).

`lib/bxl/index.ts` adds a fourth: the vendored minified bundle is untyped dist
code and reports thousands of implicit-`any` and structural errors. Authored
modules report none.

Realm lint is clean on every authored module. It is **not** clean on
`lib/bxl/index.ts`: the vendored minified bundle trips 364 style rules
(`no-var`, `require-yield`, unused minifier temporaries). This is the standing
baseline for a vendored dist bundle in a realm — the `ctse/common-libs` realm
reports 456 of the same errors for its own copy. Filter lint output by filename
before reading it.
