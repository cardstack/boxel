# Boxel execution runtime — reviewer's guide

**Status:** this guide describes the branch as built
(`codex/boxel-execution-runtime-architecture`). It has two companions:
[boxel-rendering-protocol.md](boxel-rendering-protocol.md) is the normative
specification — every claim in this guide cites an RP id from it, and the
spec wins if the two ever disagree — and
[boxel-execution-runtime-architecture.md](boxel-execution-runtime-architecture.md)
is the original forward-looking design rationale. This guide is the
narrative bridge between them and the code: read it top to bottom once, then
use the protocol document as your reference while reviewing.

---

## Layer 0 — the one-sentence model

Card authors keep main's authoring API unchanged; the Host decides, **per
module**, how much of a cage that module's _rendering_ needs; and everything
that crosses a cage wall is either plain cloneable data or a narrow
capability that the parent validates — never a live object, a store, or a
service.

That sentence compresses three ideas, and almost every file you will review
is an expression of one of them. It is worth slowing down on each.

**First: rendering is tiered; data is not.** On main, one process does
everything: it loads the card's module, constructs the class, deserializes
the instance, and renders the template, all in the same JavaScript world.
This branch splits that world along exactly one line — _who renders the
template, and in whose document_ — and leaves everything else where main put
it. The Host still loads and evaluates every module. The Host still holds
the one canonical instance of every card, still runs search against real
classes, still saves through the same store, still receives realm events the
same way. When you see the word "tier" in this codebase, it is always
answering the rendering question and never the data question. This is the
single most important thing to understand before reading any code, because
it explains what you will _not_ find: there are no changes to the store's
identity map, no changes to how instances deserialize, no changes to search
or indexing, and main's chrome code (which reads `card.constructor` in
several places) still works, because the constructor still exists.

**Second: boundaries speak one grammar.** There are several different
message lanes between the Host and a sandboxed card (rendering commands,
module fetches, size reports, instance writes, and so on). Every one of them
follows the same set of rules: a message is validated before it is acted on;
messages are processed one at a time, in order; every message carries an
ordering number so a stale message can be recognized and dropped; every
request either gets an answer or times out loudly; and when something is
refused, the refusal says what was refused and why. Once you have reviewed
one lane carefully, you have effectively reviewed the shape of all of them —
what remains is checking that each lane's _content_ is appropriate.

**Third: authority is declared, then delivered.** A caged card does not ask
for things at runtime and hope. What it may load (its module graph) and what
data it may see (its own document, the cards it links to, the queries its
type declares) are all knowable _before_ it runs, from its source and its
document. The Host computes that entitlement up front and delivers it —
either as data pushed across the wall, or as a narrow capability. Anything
outside the declared set is refused, and the refusal is visible. The card
cannot expand its own entitlement from inside the cage, and — just as
important for product quality — it cannot _silently lose_ something it is
entitled to: an entitled thing that cannot be delivered must fail loudly,
not render as a mysteriously empty box.

## Layer 1 — the three tiers

| Tier        | Who executes the module                                                 | Whose DOM the template renders into                                     | When it is used                                                                                |
| ----------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Direct**  | The Host's own loader and Glimmer                                       | The Host document                                                       | Trusted-realm modules: Base, catalog, skills                                                   |
| **Capsule** | A SES compartment inside the Host process                               | The Host document, but only through reconstructed ("reified") templates | Authored modules whose rendering needs no real browser authority                               |
| **Sandbox** | A complete child copy of the host app, inside an origin-isolated iframe | The child's own separate document                                       | Authored modules that genuinely need the DOM, third-party browser libraries, canvas, and so on |

Some vocabulary, because two of these terms carry a lot of weight:

- **SES compartment** (Capsule): SES is "Secure ECMAScript" — a way of
  running JavaScript inside the same process but with a controlled global
  environment. Code inside the compartment sees only the globals we hand it.
  There is no `document`, no `window`, no `fetch`. Its templates are not
  executed as authored; they are compiled, inspected, and rebuilt by the
  Host, which is why a Capsule card can render into the Host's document
  without ever touching the Host's document itself.
- **Origin-isolated, credentialless iframe** (Sandbox): the iframe is served
  from a _different origin_ than the Host, which means the browser itself —
  not our code — guarantees the child cannot reach into the parent page.
  `credentialless` additionally means the child gets a blank, throwaway
  cookie jar and storage: even though the child runs on a realm-user origin,
  it carries none of the user's ambient credentials. The only way in or out
  is the single message channel the parent hands it at boot.

Every rendered card is stamped with `data-boxel-execution="direct|capsule|
sandbox|prerender"` and a human-readable `data-boxel-execution-reason`
(RP-6.4). When you are triaging any rendering question, read those two
attributes first; they tell you which code path you are actually looking at.

**The load-bearing architectural bet.** This branch had a predecessor — a
frozen reference branch — that proved the product experience was achievable
but took a different structural approach: it removed authored classes from
the Host entirely, so that an "interactive card" might have no executable
constructor at all. That purity had a price. Main's chrome reads
`card.constructor` in about a dozen places; main's search walks real class
hierarchies; main's indexing needs executable classes. The frozen branch had
to rewrite all of those call sites and split the store into two
materialization paths, which interleaved its changes deeply into main's
core. This branch makes the opposite bet: **the Host keeps executing
authored modules for data purposes** — construction, deserialization,
identity, search, save — and only the _rendering_ of authored templates is
pushed into cages. The measurable consequence: the whole branch deletes only
75 lines of existing code. Main's machinery is not modified; it is
surrounded. The discipline that makes this safe is stated in RP-6 and
enforced by the renderer: **an authored template never renders host-side
below its module's tier.** Running an authored _class_ to deserialize data
is a very different risk from running an authored _template_ with live
access to the page, and the branch treats them differently on purpose.

## Layer 2 — the spine of a render

Here is what actually happens when a card appears on screen, top to bottom.
Each stage names its main analog, because the design rule throughout the
branch is: where main already proved a pattern, express that same pattern
across the boundary rather than inventing a new one.

```
BoxelExecutionRenderer            ← the one component chrome invokes,
  |                                 equivalent to main's CardRenderer;
  |                                 it seeds formats identically (RP-1.5)
  └─ BoxelExecutionService.requestFor(card, format, surfaceId)
       │
       ├─ 1. classify   Which cage does this module need?
       │                BoxelModuleGraphClassifier inspects the module's
       │                source and its resolved import graph (RP-6) and
       │                answers: direct, capsule, or sandbox — plus a
       │                human-readable reason.
       │
       ├─ 2. route      BoxelRuntimeRouter leases a runtime for this
       │                surface. Crucially, a Sandbox process is RETAINED
       │                per surface identity: switching a card from
       │                isolated to edit and back reuses the same live
       │                iframe. The iframe never reloads on a format
       │                switch, which is what lets in-card state survive.
       │
       ├─ 3. materialize  The canonical instance is serialized into a
       │                "projected execution document" (a JSON:API
       │                document plus included linked cards), and the
       │                runtime builds its own instance from it using
       │                createFromSerialized — the very same card-api
       │                entry point main uses to build instances from
       │                realm data. The caged copy is constructed by the
       │                same machinery as the real one.
       │
       └─ 4. getRenderSlot(format)  The renderer's template branches on
                        what comes back: a Direct component, a Capsule
                        component, or a Sandbox iframe slot.
```

The correspondence table below is the heart of this guide. The left column
is a pattern that main has already proven in production; the right column is
where that exact pattern reappears in this branch. When you review a piece
of runtime code and want to know "is this right?", the strongest tool you
have is to find its row here and compare against main's behavior directly.

| Proven on main                                                                                           | Where it lives now                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defaultFieldFormats` — the cascade that decides what format a nested field renders in                   | `childFieldFormatsFor` in runtime-common. There is exactly ONE definition, and every tier consumes it (RP-2.6). A drifted copy would make nested cards render in the wrong format on one tier only — precisely the class of bug the protocol exists to prevent. |
| `Box.set` — all mutation flows through one `setField` funnel: validate, write, notify, autosave          | A Capsule card's `@set` argument is a Host closure that enters that same funnel (RP-9.8). A Sandbox card's mutations arrive as serialized documents and re-enter the same funnel parent-side (RP-20.6). No tier gets a store-write shortcut.                    |
| `subscribeToChanges` — the card-api signal main's store autosave listens to                              | The identical signal drives both directions of sandbox sync: the parent's push loop subscribes to the canonical instance, and the child's write loop subscribes to its rendered copy.                                                                           |
| `updateFromSerialized` — how main's store applies a realm event to a live instance without remounting it | The apply mechanism for every push and every write, in both directions. This choice has a deep consequence explained in Layer 4.                                                                                                                                |
| The store's debounced autosave lane                                                                      | `store.scheduleSave()` exposes that exact lane, so a sandbox write persists with the same timing a host-side keystroke would have — not faster, not slower.                                                                                                     |
| The permissions provider in operator mode's stack item (RP-9.1)                                          | The renderer consumes that same live value and forwards a plain `{canRead, canWrite}` snapshot to the child, so editors inside the iframe enable and disable exactly like host-side ones.                                                                       |
| Theme scope tokens (`themeScope`, `themeCss`)                                                            | Computed host-side once, crossed as plain strings (RP-5.4). The live Theme card never crosses.                                                                                                                                                                  |
| The scoped-CSS pipeline                                                                                  | The same pipeline everywhere; Capsule adds an admission policy in front of it, the Sandbox runs it natively inside the child document.                                                                                                                          |

The review heuristic this table supports: **when a runtime path and a main
path disagree, main is the bug oracle** (RP-0.5 — Direct behavior is the
reference implementation, and the spec was extracted from main's observed
behavior, not designed fresh).

## Layer 3 — the boundary grammar

A Sandbox card lives on the far side of a real security boundary, so
everything it needs must arrive as messages. All of those messages travel
over **one** private `MessagePort`. The port itself is established by a
short bootstrap dance worth understanding, because it is the root of the
whole trust chain: the parent creates the iframe with a random, unguessable
bootstrap id in its URL; the child announces "listening" with that id; the
parent — after checking the message came from the exact expected origin with
the exact expected id — hands over one end of a fresh `MessageChannel`. From
that moment on, the window-level messaging is torn down and every bit of
authority the child will ever have flows through that single transferred
port. There is no second door.

Five lanes are multiplexed over the port, each identified by a `kind` field
in its message envelope:

| Lane              | Direction      | What it carries                                                                                                                                                                                                                                                                                                        |
| ----------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Runtime RPC**   | parent → child | The semantic Boxel API: `loadBoxel`, `createFromSerialized`, `describeBoxel`, `serializeCard`, and friends. This is how the parent asks the child to build and describe its copy of the card.                                                                                                                          |
| **Render family** | parent → child | The rendering commands: `render`, `clear`, `draft` (live-edit HMR), `updateInstance` (RP-20.5 data push), `updateContext` (RP-9.1 permissions push). All five share one monotonically increasing generation number; a command that arrives after a newer one has superseded it is dropped, never applied out of order. |
| **Fetch**         | child → parent | Module reads. The child has no network of its own; every import resolves to a request on this lane, and the parent checks the exact URL against the module graph the classifier computed _before_ performing an authenticated fetch on the child's behalf. A bounded media sub-lane does the same for realm images.    |
| **Surface**       | child → parent | Layout and presentation requests (RP-16): most importantly "my content is N pixels tall," which is how the iframe gets sized, since the parent cannot measure inside a cross-origin frame.                                                                                                                             |
| **Write**         | child → parent | Instance-write proposals (RP-20.6): the child's full serialized document after an authored mutation, carrying its own sequence number.                                                                                                                                                                                 |

Every lane obeys the same discipline, and these are the specific things
worth spot-checking in any transport file you open:

- **Envelope validation before dispatch.** A message with the wrong shape —
  wrong kind, missing field, out-of-range value, non-boolean where a boolean
  belongs — is ignored or refused before any handler runs. The validators
  are plain, readable predicate functions at the bottom of each transport
  file.
- **Serial dispatch.** Each lane processes messages through a promise queue,
  one at a time, in arrival order. Two writes can never interleave; a render
  can never overtake the render before it.
- **Ordering tokens with supersede-drop.** Parent-issued lanes share the
  generation counter; the child-issued write lane has its own sequence.
  In both cases the rule is the same: if a newer message has already been
  seen, the older one is dropped and its sender is told it was dropped
  (which the sender treats as success, because every message carries
  complete state — a newer one already contains everything an older one
  proposed).
- **Bounded timeouts.** Silence after a request is a protocol violation
  (RP-15.3). Every request either resolves, rejects with a real error from
  the far side, or rejects with a timeout that says what timed out.
- **Self-naming refusals.** "Sandbox module read is outside its classified
  graph: <url>" — the refusal states what was refused. Nothing is silently
  swallowed.

## Layer 4 — the sync loop that must terminate

This is the subtlest mechanism in the branch, and it is worth holding all
four of its facts in your head at once, because its correctness is
structural rather than enforced by any guard code.

**Fact 1 — downstream sync (RP-20.5).** When the canonical instance changes
on the host side — the user edited the card in another view, a relationship
finished loading, a realm event arrived — the parent's subscription (via
card-api's `subscribeToChanges`) fires. The parent serializes the
instance's complete current state and pushes it over the render lane. The
child applies it to its copy **in place** with `updateFromSerialized`, so
the child's own reactivity re-renders the changed bindings without
remounting the component. Rapid changes coalesce: a burst of mutations
produces one push per queue drain, each carrying full current state.

**Fact 2 — upstream sync (RP-20.6).** When an _authored_ mutation happens
inside the child — the user typed in an input the card renders, and the
card's own code did `this.args.model.price = 12` — the child's subscription
fires the same way, the child serializes its complete current state, and
sends it up the write lane. On the parent side, exactly one registered
receiver is entitled to apply writes from this process, and it was bound at
connection time to the ONE canonical card the process renders. The receiver
checks that the incoming document's id matches that card (a write for any
other card is refused before anything is touched), applies it to the
canonical instance with `updateFromSerialized`, and schedules the store's
normal debounced save. Persistence, permissions, and realm arbitration all
stay parent-side; the child never gains a save capability.

**Fact 3 — termination is structural, not flag-based.** Here is the
question a careful reviewer should ask: doesn't this loop? A push causes the
child to apply changes; doesn't applying changes fire the child's
subscription and send a write back up, which the parent applies, which
fires the parent's subscription, which pushes back down, forever? The
answer is no, and the reason is a property of card-api that main itself
already depends on: **`updateFromSerialized` writes field values directly
into the instance's data bucket and does not fire `subscribeToChanges`
subscribers.** (It only notifies Glimmer's tracking, so bindings re-render.)
Main relies on this so that applying a realm event doesn't trigger a
pointless re-save. We rely on it so that each direction's _apply_ is
invisible to the other direction's _trigger_. An applied push cannot cause
a write; an applied write cannot cause a push. There is no suppression
flag, no re-entrancy guard, no state to get wrong — the loop cannot form,
by construction. (An earlier design draft had suppression flags; the
investigation that found this property let us delete them, which is the
best kind of simplification.)

**Fact 4 — the writer never hears its own echo.** When a write is applied
parent-side, every _other_ mounted view of that card is notified and gets a
fresh push — that is how two views of one card stay in sync. But the
writer's own view is deliberately skipped. Its child already holds exactly
the state it just wrote, so an echo push would carry zero new information —
and it would not be free: applying a serialized document replaces the nested
compound field objects (the rows and cells of a spreadsheet, say), which
remounts the DOM inside `{{each}}` blocks and would destroy an open inline
editor about a second after every edit. This mirrors main precisely: on
main, the view that performs a mutation sees only its own tracked updates,
never a reload of itself. (The remount behavior of serialized applies is a
known limit shared with main, recorded in RP-20.3.)

## What card authors see

**Nothing new is required.** The authored surface is main's, verbatim. This
card runs correctly on main and on every tier of this branch, unchanged:

```gts
import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import { on } from '@ember/modifier';

export class Product extends CardDef {
  @field name = contains(StringField);
  @field price = contains(NumberField);
  @field vendor = linksTo(() => Vendor);

  static isolated = class extends Component<typeof Product> {
    updatePrice = (ev: Event) => {
      // Main's in-place edit idiom: a plain assignment to the model.
      // On main this mutates the live instance and autosaves. In a
      // Sandbox, this same line mutates the child's copy, crosses the
      // write lane, applies to the canonical instance, and autosaves —
      // the author neither knows nor cares which one happened.
      this.args.model.price = Number((ev.target as HTMLInputElement).value);
    };
    <template>
      <h1>{{@model.name}}</h1>
      <input value={{@model.price}} {{on 'change' this.updatePrice}} />
      <@fields.vendor @format='embedded' />
    </template>
  };
}
```

What _does_ change is behavior at the edges, and it is different per cage.
The honest list:

**In a Capsule** (authored code, no browser authority):

- There is no `document`, no `window`, no `fetch` in scope. Code that
  merely _probes_ for them (`typeof window !== 'undefined'`) is fine — the
  classifier explicitly exempts probes — but code that uses them routes the
  whole module to the Sandbox instead.
- Only the `{{on}}` modifier is available in templates. Modifiers that
  receive the live element (`ember-modifier`-style `modifier((element) =>
…)`) cannot be honored, because handing authored code a live Host DOM
  element would breach the cage; a module that uses them classifies to the
  Sandbox.
- Event handlers receive a reduced projection of the event called
  `SafeEvent` (RP-14.1): the scalar properties (key, coordinates, checked,
  value, dataset and so on) are copied across; the live `Event` object and
  live elements are not. Most handlers never notice.
- Dynamic inline style strings (`style="color: {{this.color}}"`) and
  global/unscoped styles are Sandbox signals, not Capsule features. Scoped
  `<style scoped>` blocks work identically to main.

**In a Sandbox** (authored code with real browser authority):

- The card has a full, real DOM — its own document. Real events, real
  modifiers, third-party browser libraries, canvas, WebGL: everything
  works, because it is a genuine page.
- The card's _data world_ is its declared world: its own document, the
  cards it declares links to (delivered inside every data push), and its
  type's declared query fields (delivery in flight — RP-17.1). Ambient
  search and arbitrary network access do not exist inside the cage and are
  refused with named refusals rather than rendering as empty results
  (RP-21.3).
- Boot costs real time (the child is a whole app). The user sees a
  server-prerendered placeholder of the card instantly, and the live iframe
  replaces it in place when the child reports its first real paint.

**Format containment (RP-6.3)** — this one surprises people, so it gets its
own paragraph. A module's tier applies to its _isolated and embedded_
renders. The compact formats — `fitted`, `atom`, `head`, `markdown` — of a
Sandbox-classified module render in Capsule instead. The reason is
composition: a grid of fifty fitted tiles must never become fifty booting
iframes. And the `edit` format renders the trusted Base editor host-side —
_unless the module authors any `static edit` template of its own_, whether
on the card class or on any of its FieldDefs. Authored edit code is still
authored code; it keeps the Sandbox, and it keeps the SAME retained iframe
its isolated render used, so switching between viewing and editing never
reloads the card or loses its in-progress state. The principle, stated once:
the edit surface demotes only when demoting executes no authored template at
all.

## The classifier — compatibility defaults, stated as choices

The classifier answers one question per module: which cage will this
module's rendering actually work in? The design goal that shaped every
default is: **realms authored against main render correctly with zero
edits.** Compatibility first; the cheapest-possible cage second.

How it decides, in order:

1. **Provenance.** Modules from trusted realms (Base, catalog, skills) are
   Direct. This is a provenance decision, not a code-inspection decision.
2. **Everything else starts at Capsule** — the default cage for authored
   code — and is promoted to Sandbox only when the code shows a concrete
   signal that Capsule cannot honor:
   - imports of browser-authority packages (`three`, `ember-modifier`,
     chart libraries, and so on);
   - unbound browser globals (`document`, `window`, `navigator` used as
     free identifiers — with the explicit exemption that
     `typeof x !== 'undefined'` probes do not count, because feature
     detection is not a dependency);
   - DOM method calls in the module body;
   - dynamic or quoted inline `style` attributes in templates (a styling
     channel the Capsule's CSS policy cannot admit);
   - global or document-level styles (`@font-face`, unscoped selectors,
     view transitions);
   - top-layer attributes (`popover`, `command…`) that require a real
     document to mean anything.
3. **Classification is module-based, and promotion follows static import
   edges** (RP-6.2). All formats defined in one module share its route. A
   dependency's signals promote its importers only along real import edges
   — and ambient-global signals deliberately do _not_ propagate upward,
   because a library often contains a dormant browser adapter that SES can
   safely leave unavailable; promoting every importer for a stray
   `document` token would drag otherwise-Capsule cards into iframes for no
   benefit.
4. **Every ambiguity resolves upward** (the R5 rule: nothing may
   de-escalate isolation). If the classifier cannot be sure Capsule will
   work, the module gets the Sandbox. A false positive costs smoothness —
   an iframe boot the card didn't strictly need. A false negative would
   cost correctness or containment. The branch always pays the smoothness
   price, never the other one. Authors also have an explicit escape hatch
   _upward_ (`static prefersFullSandbox = true`); there is deliberately no
   escape hatch downward.

## Ideal authoring — getting the most out of the platform

The defaults above make existing cards work. Module layout is what decides
how _fast and smooth_ a card feels, because the unit of classification is
the module. An author who understands that one fact can get almost all of
the platform's performance with almost no effort:

1. **Split presentation weight by format.** Put the compact formats —
   `embedded`, `fitted`, `atom` — in a module with no browser signals, and
   put the heavy interactive isolated experience (the WebGL scene, the
   drag-and-drop board) in its own module that the first one links to.
   RP-6.2 gives each module its own route, so the galleries and search
   results that compose your card render instantly in-document via Capsule,
   while only the full-screen experience pays for an iframe. One merged
   module means every tile in every gallery pays the sandbox toll.
2. **Split data shape from presentation.** A module containing only the
   type — fields, serializers, computed values — has no reason to ever
   leave Capsule. Other cards that want to link to your type import the
   data module and stay light, regardless of how heavy your isolated view
   is.
3. **Don't buy the Sandbox by accident.** The most common accidental
   promotions, and their free alternatives: interpolated inline styles
   (`style="width: {{w}}px"`) → a scoped-CSS class plus a custom property,
   or static style constants; a bare `window` check → `typeof window`;
   a global `@font-face` in a card → the Theme card's `cssVariables`
   contract, which crosses every boundary as plain strings.
4. **Declare data; don't fetch it.** `linksTo`, `linksToMany`, and query
   fields (`options.query`) are the entitlement-correct way to reach other
   cards: the Host evaluates them, delivers the results as data, and keeps
   them live-synced through the push lane. An imperative `fetch` in card
   code is ambient authority — it classifies you into the Sandbox _and_
   then gets refused there.
5. **Author `static edit` deliberately.** Writing your own edit template —
   at the card level or on your FieldDefs — is the opt-in to an in-iframe
   editing experience with retained state and write-leg persistence. If the
   standard generated editor serves your card well, omit it and get the
   host-side form for free. Either way works; the choice should be a
   choice.
6. **Trust the retained process.** Because the router keeps one Sandbox
   process per surface across format switches, isolated↔edit toggles are
   free once booted. Design flows that stay within one card's surface
   rather than bouncing between stacked copies of it.

## The security model

Two orthogonal axes organize everything (RP-21 — this separation is
load-bearing, and it exists because collapsing the axes creates a real
vulnerability):

**Axis one: containment** — how much browser authority a module's rendering
needs, and which cage delivers it safely. This is what the tiers are. It is
chosen by the classifier, from evidence in the code.

**Axis two: entitlement** — what a card may _know_ and _do_. This is a
function of module provenance and card declaration only. Capsule and
Sandbox hold the **same trust grade** (untrusted authored code) and receive
**identical entitlements**; only the delivery mechanics differ. The reason
this must be an invariant rather than a tendency: if entitlement keyed off
the tier, an attacker would simply write deliberately DOM-free code so the
classifier assigns Capsule — and thereby _gain_ authority. The cage you get
must never change what you're allowed to reach.

Entitlement comes in four grades (RP-21.2), from least to most:

1. **Declared** — the card's own document, the cards its fields declare
   links to, and its type's declared query fields. Every authored card
   holds this grade. Note the delivery rule: declared data always arrives
   as _parent-evaluated results_ — materialized data, like `@model` — never
   as a query capability the card could repoint.
2. **Display-only** — a host-rendered surface whose content the authored
   code cannot read back and cannot exfiltrate. There is exactly one today:
   the Capsule's `searchResultsComponent` context key, which lets a card
   _show_ host-rendered search results (this is how grid-style cards work
   on main). The authored code influences the query but never receives the
   result data: in SES it cannot read the DOM the results rendered into,
   and it has no network to send anything out on. It is named in the spec
   precisely so it stays a decision rather than an accident.
3. **Mediated action** — a user-visible request that the parent validates
   and executes in parent-owned chrome. `viewCard` (tap a linked card, the
   stack navigates) is this grade; a future create/delete lane will be too.
   The authored code proposes; the Host disposes.
4. **Ambient** — search and arbitrary data reach. Held only by
   trusted-realm provenance (the Direct tier's modules). Never grantable by
   classification, by format, or by anything the authored code itself does
   or requests. The planned guide/trust-badge system is the future
   mechanism for granting upward — per module, by policy, without touching
   containment.

So, to answer the concrete question directly: **"can a card search your
contact book?"** is an ambient-grade question, and for authored code in any
cage the answer is unconditionally no. And because exfiltration requires
both _reading_ something and _sending it somewhere_, it is worth noticing
that both halves are independently denied: no ambient read (grades 1–3 are
all the card can hold) and no egress (no `fetch` in the Capsule's scope; the
Sandbox's every network request dies at the gated port unless it is an
entitled module read).

Cage properties a reviewer should verify rather than take on trust:

- **Sandbox isolation:** the child origin must differ from the Host's (the
  process refuses to boot otherwise); the iframe is `credentialless`
  (throwaway storage, no ambient cookies); the bootstrap accepts exactly
  one origin-checked, nonce-matched connect with exactly one transferred
  port; module reads are pre-authorized against an exact-URL allow list
  (never pattern-matched), the _response_ URL is re-checked after redirects
  so a redirect cannot smuggle an unauthorized module in, bodies are
  size-capped, and refusals fire _before_ any host-credentialed fetch is
  performed — the gate is pre-authorization, not post-filtering.
- **Capsule confinement:** the compartment's scope contains no `document`
  and no `fetch`; templates are reconstructed by the Host rather than
  executed as authored; element-receiving modifiers are rejected; CSS
  passes an admission policy; events cross as `SafeEvent` reductions; and
  the `@context` handed to authored code is frozen to exactly two
  enumerated presentation keys (`projectCapsuleContext` — unit-tested
  against a deliberately over-full host context to prove nothing else
  rides along).
- **Write authority:** one entitled receiver per sandbox process, bound to
  the one canonical card that process renders; every incoming write is
  identity-checked before anything applies; saving happens through the
  store's own lane with the store's own timing. Boxel is not a
  validate-on-write system — validation is a post-save concern (the future
  guide system) — so the write lane's error path exists for transport
  faults and identity violations, not as a validation UX.
- **Failure posture:** fail closed, and say so. Silence after an
  acknowledgment is a protocol violation (RP-15.3: a child that stops
  responding fails the render rather than leaving a stale frame); an
  entitlement that cannot be delivered refuses visibly (RP-21.3); and
  nothing, under any error, falls back to a weaker cage (R5).
- **Excluded by design** (RP-17.2 — conformance tests assert the denial):
  authored code executing in the Direct tier; cross-realm search without an
  explicit grant; arbitrary DOM/CSS mutation from Capsule code; any generic
  "just give me the element" escape hatch.

## Where to look

| Concern                          | File                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------- |
| Classification and routing       | `host/app/lib/boxel-source-classifier.ts`                                        |
| Session/engine spine             | `host/app/lib/boxel-execution-engine.ts`, `host/app/services/boxel-execution.ts` |
| The renderer (every tier branch) | `host/app/components/boxel-execution-renderer.gts`                               |
| Capsule evaluator and facade     | `host/app/lib/capsule-module-evaluator.ts`                                       |
| Sandbox process, parent side     | `host/app/lib/sandbox-runtime-process.ts`                                        |
| Sandbox child shell              | `host/app/components/boxel-sandbox-runtime.gts`                                  |
| Transports (read one, know all)  | `host/app/lib/sandbox-{render,fetch,surface,write}-transport.ts`                 |
| Cross-boundary types             | `runtime-common/boxel-execution-protocol.ts`                                     |
| The Capsule entitlement boundary | `host/app/lib/capsule-context-projection.ts`                                     |

**How the spec is enforced:** every normative statement in the protocol
document carries an id, and CI enforces a bijection between statements and
conformance tests (`scripts/check-rp-bijection.mjs`) — a statement with no
test fails the build, and so does a test citing no statement. The
capability matrix at the end of the protocol's RP-21 section is the
one-page index of everything in this guide: every capability, per tier,
with its entitlement grade, delivery mechanism, build status, and owning
statement.
