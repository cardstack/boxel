# Boundary findings

This is the register of places where the line between interface and
implementation is currently blurred. Each entry is grounded in code that exists
today. Each proposes a fix. None is a complaint about how the code was written;
each is a decision the code has already made without recording it.

**Classification**

| Class | Meaning                                                                        | What it needs                                |
| ----- | ------------------------------------------------------------------------------ | -------------------------------------------- |
| Leak  | Cards depend on an implementation detail today.                                | Hide it, or replace it with a real contract. |
| Gap   | Cards need to know something and nothing states it either way.                 | Decide, then state it.                       |
| Note  | The boundary is currently clean. Recorded so a later change does not break it. | Nothing.                                     |

**Status**: `open` (needs a decision), `proposed` (a recommendation is written,
awaiting review), `accepted` (an ADR records the decision), `fixed`.

An entry that becomes a decision gets an ADR and a ticket, and its status here
changes. An entry that becomes a code change gets removed from the code and
stays here with status `fixed`, so the boundary it protects is not re-broken.

**Index**

| ID            | Finding                                                                          | Class | Status   |
| ------------- | -------------------------------------------------------------------------------- | ----- | -------- |
| [B-01](#b-01) | The `searchable` field option does nothing                                       | leak  | open     |
| [B-02](#b-02) | `data-test-*` means two different things                                         | leak  | proposed |
| [B-03](#b-03) | The format list has three sources of truth, and they disagree                    | leak  | proposed |
| [B-04](#b-04) | Host UI modes are in the card context                                            | leak  | proposed |
| [B-05](#b-05) | `commandContext` and `toolContext` are the same thing under two names            | leak  | proposed |
| [B-06](#b-06) | `Box` is exported into the author API                                            | leak  | proposed |
| [B-07](#b-07) | `import.meta.loader` hands card code the loader                                  | leak  | proposed |
| [B-08](#b-08) | Cross-runtime channels are `Symbol.for` keys                                     | gap   | open     |
| [B-09](#b-09) | A prerender's missing services are per-member absence                            | gap   | proposed |
| [B-10](#b-10) | The store's diagnostics sit on the card-facing interface                         | leak  | proposed |
| [B-11](#b-11) | Synthetic search-doc keys are reachable from a card's own queries                | leak  | proposed |
| [B-12](#b-12) | The concept docs contradict the code                                             | gap   | proposed |
| [B-13](#b-13) | A file def declares an edit template it may not use                              | leak  | open     |
| [B-14](#b-14) | `eager` has two defaults that contradict                                         | leak  | proposed |
| [B-15](#b-15) | Per-instance field overrides have no stated semantics                            | gap   | proposed |
| [B-16](#b-16) | `cardInfo`, `cardTitle`, and `cardDescription` have no owner                     | gap   | open     |
| [B-17](#b-17) | `capturesMeta` exposes the capture pipeline                                      | leak  | proposed |
| [B-18](#b-18) | The clock seam is a lint rule, not an API                                        | gap   | proposed |
| [B-19](#b-19) | The erasable-TypeScript rule for card code is a lint rule, not a contract        | gap   | proposed |
| [B-20](#b-20) | The reserved field-name list covers two members of a large provided surface      | gap   | open     |
| [B-21](#b-21) | A platform import rule reads like an author rule                                 | note  | proposed |
| [B-22](#b-22) | `description` is a real author-facing feature that nothing states                | note  | proposed |
| [B-23](#b-23) | A card's icon is a component from one icon package                               | leak  | open     |
| [B-24](#b-24) | Runtime-owned values are author-facing sort keys                                 | gap   | open     |
| [B-25](#b-25) | `readSource` is a name an author may not use, for a reason only the server knows | note  | proposed |
| [B-26](#b-26) | A card's default template drives the host's navigation                           | leak  | open     |

---

## B-01

**The `searchable` field option does nothing**

**Class:** leak · **Status:** open

`@field` accepts `searchable: true | string | string[]`, and its type and
validation are complete: dotted paths are checked against the definition graph.
Nothing consumes it. `packages/host/tests/unit/searchable-option-test.ts` says
so directly: "additive, inert — nothing consumes it for search-doc depth yet".

An author who writes `searchable: 'address.city'` today gets a card that
compiles, lints, and does not behave as written. That is the worst shape a leak
can take: the API is finished, so the author believes it.

**Why it matters.** The option is the author-facing answer to "how deep does my
card's search go?" Without it, the runtime decides depth, and an author who
needs a nested value searchable has no way to ask. With it inert, an author has
a way to ask that silently fails.

**Proposal.** Decide which of these is true, and delete the other:

1. **The runtime decides depth.** Remove `searchable` from the author API. State
   the depth rule in [author API §8](author-api.md) as a runtime decision, and
   give authors the concept they actually need if they need it.
2. **Depth is the author's.** Implement it in the search-doc generator, with the
   invalidation that follows from a deeper doc.

Option 2 is the larger change. Option 1 is the smaller contract. Either is fine;
leaving it as it is is not.

---

## B-02

**`data-test-*` means two different things**

**Class:** leak · **Status:** proposed

`eslint/data-test-selectors.cjs` records the split: host app builds strip
`data-test-*` in production; realm card code — compiled by the realm pipeline —
keeps them. The ban on selecting on them applies in both, for two different
reasons.

A card whose styles or behavior select on `[data-test-foo]` therefore works in
one runtime and breaks in another, and works in production and breaks when a
test is deleted.

**Proposal.** Make `data-test-*` mean one thing: a test hook, in every context.
A runtime MUST strip it from every rendering it serves to a person, including
prerendered HTML. Then the ban is a consequence of the contract rather than a
lint rule with two justifications.

**Open question.** Does stripping prerendered HTML break any test that reads the
index's HTML directly? Those tests should select on the runtime's own hooks, not
on a card's test hook.

---

## B-03

**The format list has three sources of truth, and they disagree**

**Class:** leak · **Status:** proposed

`packages/runtime-common/formats.ts` declares:

- A `Format` union of nine names, including `form` and `metadata`.
- A `formats` array of seven, which omits both.
- Three per-family lists: `cardDefFormats`, `fieldDefFormats`, `fileDefFormats`.

`form` appears nowhere else in the repository. `metadata` is in
`fileDefFormats` but not in `formats`, so `isValidFormat('metadata')` is false
by default while the file family accepts it. Meanwhile `FileDef` declares
`static edit` (`FileDefEditTemplate`) while `fileDefFormats` excludes `edit`.

A card author reading one of these three gets a different answer from a reader
of another. A runtime implementing "the formats" has to guess which list is the
contract.

**Proposal.** One source: a per-family map from family to its formats, with the
`Format` union derived from it. Delete `form`. Resolve the `FileDef` / `edit`
contradiction by deciding whether a file is editable in place (see B-13). Make
the union a type-level projection so adding a format to one family cannot
silently make it a name a card may write.

---

## B-04

**Host UI modes are in the card context**

**Class:** leak · **Status:** proposed

`CardContext` carries `mode?: 'host' | 'operator'` and
`submode?: 'interact' | 'code' | 'host'`, described as "Optional runtime
mode/submode hints used by cards that render differently per context." Base-realm
cards already branch on them: `base/field-component.gts`,
`base/links-to-editor.gts`, and `base/realm-config.gts` all change behavior for
"code submode".

The vocabulary goes deeper than the context. `base/command.gts` declares
`@field submode = contains(StringField)`, so a host navigation state is stored as
card data. And `base/default-templates/missing-template.gts` — a card's _default_
rendering — imports `switch-submode` from the host and executes it with
`submode: 'code'`; see [B-26](#b-26).

This is the host's navigation implementation, named in the host's vocabulary,
sitting in the interface every card sees. A second runtime — a documentation
site, a mobile client, a different host — has no `operator` mode and no
`submode`, and a card that branches on them renders wrong there.

**Proposal.** Replace them with presentation intents the card can honor without
knowing the host's shape. Two are enough for the cases in use today:

- **editing** — the person is changing this card.
- **definition-visible** — the person can see the card's own code.

`code submode` is really the second: a card renders differently because the
viewer can edit the card's definition, not because a host tab is named "code".
Freeze `mode` / `submode` as host-internal, and give the host a way to pass the
intents.

**Open question.** Is there a card today that branches on `mode: 'host'` for a
reason the two intents do not cover? None was found in `packages/base`.

---

## B-05

**`commandContext` and `toolContext` are the same thing under two names**

**Class:** leak · **Status:** proposed

`CardContext.toolContext` is the current name; `commandContext` is kept as the
"pre-rename spelling" because deployed realm content reads it.

Two names is two contracts. A runtime implementing the interface has to provide
both, and a card author cannot tell which is real.

**Proposal.** Keep one name. Give the other a sunset with a date and a
measurement — count the realms that still read `commandContext`, and remove it
when the count is zero. A permanent alias is a permanent second contract.

---

## B-06

**`Box` is exported into the author API**

**Class:** leak · **Status:** proposed

`Box` is exported from `packages/base/card-api.gts`, and base-realm components
that card authors extend import it: `base/field-component.gts`,
`base/contains-many-component.gts`. Its API is a runtime mechanism — `Box.create`,
`box.field(name)`, `box.children`, `useIndexBasedKey` — that exists to keep
Glimmer from remounting a field's subtree.

An author who writes a custom plural field component today has to learn `Box`,
including `useIndexBasedKeys`, which is a reconciliation strategy, not a concept.

**Proposal.** Keep `Box` as the platform's internal mechanism. Give the author
API for custom field components what it needs directly: the value, the field
name, the index, and a stable identity per element. Mark `Box` platform-only and
move it out of the module card authors import.

**Note.** `useIndexBasedKey` is a per-field-def flag a primitive field sets to
get identity-based reconciliation by position instead of by value. That is a
reconciliation policy the runtime chose, exposed as an author knob. Whatever
replaces `Box` should state the reconciliation policy per field kind instead.

---

## B-07

**`import.meta.loader` hands card code the loader**

**Class:** leak · **Status:** proposed

[ADR 010 §1.4.1](../adr/010-give-loaded-modules-native-esm-semantics.md) lists
`import.meta.loader` as a supported departure from native ESM: the loader injects
itself into every module, and a compiler rewrites bare `fetch()` and dynamic
`import()` to go through it.

The rewrite is fine and useful. Injecting the loader object is the leak: card
code can reach the module map, the dependency graph, and the observation APIs
that ADR 010 §1.4.3 says MUST NOT change what a module observes — and CAN change
what a card does.

**Proposal.** Keep the compiler rewrite. Stop giving card code the loader. Where
card code needs the loader's behavior, it uses `import()` and `fetch()`, which
the rewrite already routes. Restrict `import.meta.loader` to platform modules,
which the compiler can do because it already decides which modules to rewrite.

---

## B-08

**Cross-runtime channels are `Symbol.for` keys**

**Class:** gap · **Status:** open

Several `Symbol.for` keys carry values across module universes:
`cardstack.getFields` (carried on every instance so BXL materializes through the
card-api copy that created it), `cardstack-ident` (the identity tag),
`shimmed-module` and `shimmed-module-deps` (the only way into the module map),
`cardstack-use-index-based-key`, `cardstack-field-decorator`, `cardstack-queryable-value`,
`cardstack-format-query`, `cardstack-realm-info`, `cardstack-empty-value`.

`Symbol.for` is a process-global registry. Two loader universes, two copies of a
card-api, or two runtimes in one process share these keys implicitly. The
`cardstack.getFields` comment acknowledges the multi-universe case and picks
"the copy that created the instance" as the rule — a good rule, written in a
code comment, with nothing stating it as a contract.

**Proposal.** Split them:

- **Identity tags** (`cardstack-ident`) are contract: [runtime contract §3](runtime-contract.md)
  states them, and they are the only cross-universe channel a card may rely on.
- **Definition-internal symbols** (field decorator, queryable value, empty value,
  index-based key) belong to one card-api copy. A runtime MUST NOT require two
  copies to agree on them, and MUST NOT expose them where a card can read them.
- **Loader-internal symbols** (`shimmed-module`) belong to the loader and its
  host.

Then state the rule for a value crossing universes: it carries its own
provenance, or it is a code ref.

---

## B-09

**A prerender's missing services are per-member absence**

**Class:** gap · **Status:** proposed

`CardContext` marks several services optional and says each is "absent where
nothing can answer — a prerender, a freestyle — so consumers guard on it":
`canInvoke`, `keyReadiness`, `markdownEmbedChooser`, `loadRoomMedia`.

Guarding on `undefined` per member works, but it means every card that uses one
of these carries a private list of which contexts answer which questions. That
list is the runtime's, and it is not written down.

**Proposal.** Keep the per-member optionality — it is the honest shape — and add
one thing: a capability answer the card can ask instead of inferring. A card
should be able to ask "can this context tell me whether this person may invoke
this operation?" and get _yes_, _no_, or _unknown_, and render each. Then the
contract's rule is: a context MUST answer a capability question, and a card MUST
render all three answers.

This also fixes the trap the current comments warn about — `undefined` means
"not known yet", never "not ready" — by making "not known" a first-class answer
rather than an absence a card must interpret correctly.

---

## B-10

**The store's diagnostics sit on the card-facing interface**

**Class:** leak · **Status:** proposed

`CardStore` has about a dozen optional diagnostic members:
`queryLoadsInFlight`, `cardDocLoadsInFlight`, `fileMetaDocLoadsInFlight`,
`recentCardDocLoads`, `recentFileMetaLoads`, `recentQueryLoads`,
`trackQueryLoad`. They exist so the prerenderer's timeout error can say what a
render was waiting on.

They are on the interface a card sees. A runtime implementing the store contract
must decide whether to implement them, and a card author cannot tell whether
they are promised.

**Proposal.** Split the store into the two interfaces it already is:

- **The card-facing store** — the members in [runtime contract §6.1–§6.6](runtime-contract.md).
  Small, complete, required.
- **The platform store view** — the diagnostics, reached by the platform through
  a separate type a card cannot import.

A runtime that implements the card-facing store then conforms to P2 whether or
not it has diagnostics.

---

## B-11

**Synthetic search-doc keys are reachable from a card's own queries**

**Class:** leak · **Status:** proposed

`packages/runtime-common/search-doc-keys.ts` reserves `_`-prefixed top-level
search-doc keys for synthetics: `_title`, `_cardType`, `_isCardInstanceFile`,
plus `_matchRelevance` as a sort key and `lastModified` / `createdAt` /
`cardURL` as general sort fields. The file states the hazard plainly: a
user-defined field whose name collides at the top level "would silently get the
synthetic's semantics instead of its own value's".

Card-authored queries already use them. `base/workspace.gts` filters on
`_cardType`; `base/cards-grid.gts` filters on `_cardType` and reasons about
which rows carry it; `base/cards-grid.gts`'s comment explains that dual-indexed
`.json` file rows "never carry `_cardType`". That is an index storage detail —
one URL having two rows — visible to a card author writing a filter.

**Proposal.** Give authors the concepts and hide the keys:

- **Title and type** are already concepts. Expose them as named filter and sort
  members, not as `_`-prefixed keys a card writes.
- **Row kind** — "is this a card or a file?" — is a concept. Expose it as one.
  The `_isCardInstanceFile` spelling, and the fact that `eq: false` matches an
  absent key, are storage.
- **Relevance** is a concept. Expose it as a sort member.
- **Collision safety**: a field name MUST NOT be able to collide with a
  synthetic key. Reject it at definition time rather than resolving it
  ambiguously at query time.

**Open question.** `cardURL` as a sort key sorts by a URL that is not durable
across deployments ([ADR 002](../adr/002-keep-identifiers-canonical-resolve-at-network-boundary.md)).
Is it sorting by identity or by storage order? If the latter, it should not be
author-facing.

---

## B-12

**The concept docs contradict the code**

**Class:** gap · **Status:** proposed

Three statements in `docs/` are not true of the code, and each is something a
card author would act on:

- `docs/computed-fields.md`: "Computed fields are eagerly evaluated, they do not
  need to be consumed for `computeVia` to run." `docs/card-serialization-deserialization.md`
  and `packages/base/card-api.gts` both say computed values are computed on
  demand and never stored.
- `docs/computed-fields.md`: "computeVia can currently only be applied to
  contains/containsMany fields… there's a plan to let it work for linksTo and
  linksToMany in the future." It already works: `CardDef.cardTheme` is
  `linksTo(() => Theme, { computeVia })`.
- `docs/card-rendering.md` lists four formats; the runtime has seven in use and
  nine in the type.
- `docs/card-inheritance.md`: "fields in its schema cannot be deleted or
  modified." Per-instance field overrides (`meta.fields`, `CardDef[fields]`)
  modify a field's type, and the doc never mentions them.

**Proposal.** This contract is the normative source for these semantics. Each
stale doc gets edited to state the contract and link here, or gets a line saying
it describes one runtime's behavior rather than the contract. Do not leave a doc
that a card author would follow into a wrong assumption.

---

## B-13

**A file def declares an edit template it may not use**

**Class:** leak · **Status:** open

`FileDef` declares `static edit = FileDefEditTemplate`, while
`fileDefFormats` excludes `edit`, and `base/operations.ts` explains why a file
has no editable value: its `file-meta` fields are content-derived and read-only.

Either a file is editable in some runtime — and `edit` belongs in its format
list — or it is not, and the template is dead code that a file family author
will find and wonder about.

**Proposal.** Decide, then make the two agree. The recommendation is that a file
is not edited; its bytes are replaced. Delete `FileDef.edit` and
`FileDefEditTemplate`, and state in [author API §12](author-api.md) that a file
def has no edit format.

---

## B-14

**`eager` has two defaults that contradict**

**Class:** leak · **Status:** proposed

The `eager` option's comment says it "Defaults to true". `CardStore.resolvesQueryFieldsEagerly`
says "Absent means it does not, so a store that has no opinion never starts a
search on its own behalf."

So an author who writes nothing gets eager resolution in one store and lazy
resolution in another, and the difference is observable: a query-backed field
either resolved before the card rendered or did not.

**Proposal.** The author's default is the contract: a query-backed relationship
resolves with its owner unless the author says otherwise. `resolvesQueryFieldsEagerly`
is the store's capability answer, and a store that cannot honor the default MUST
say so, and MUST NOT silently invert the author's declaration. State it in
[author API §4.3](author-api.md).

---

## B-15

**Per-instance field overrides have no stated semantics**

**Class:** gap · **Status:** proposed

`CardDef[fields]` and `meta.fields` let one instance declare that a field has a
different type than its definition says. The wire format carries it, the
serializer round-trips it, and the type allows it. Nothing states:

- Who may write an override — an author in code, a person in the UI, a tool?
- Whether an override changes what the instance is searchable by.
- Whether an override may narrow a link's target type, widen it, or both.
- What happens to an override when the definition it names is renamed or removed.
- Whether an override applies to a field value nested below the instance.

**Proposal.** State the semantics in [author API §6.3](author-api.md), and make
the answers uniform across rendering and search. The recommendation: an override
narrows a field's type, applies to that field and its descendants, is visible to
search, and is carried as a code ref that MUST resolve or the instance renders as
an error rather than as the un-overridden type.

---

## B-16

**`cardInfo`, `cardTitle`, and `cardDescription` have no owner**

**Class:** gap · **Status:** open

`CardDef` declares `cardInfo` (a `CardInfoField` with `name`, `summary`,
`cardThumbnail`, `cardThumbnailURL`, `theme`, `notes`), and `cardTitle` and
`cardDescription` as computeds derived from it. `cardTitle` falls back to a
generated "Untitled" title when `cardInfo.name` is empty.

Questions nothing answers:

- Is `cardInfo` an author's field or the platform's? An author can override it.
- When a card overrides `cardTitle`, what does `cardInfo.name` mean, and which
  does search use?
- Is `cardInfo.notes` a card's own note or a platform note?
- Does a card that wants no title exist, or is "Untitled" a promise?

**Proposal.** Split the ownership. `cardTitle`, `cardDescription`, and
`cardThumbnailURL` are the platform's presentation contract: every card has
them, every consumer reads them, and an author overrides them with a computed.
`cardInfo` is the author's data. Then state the fallback chain as a contract,
including whether an untitled card is a real state or a convenience.

---

## B-17

**`capturesMeta` exposes the capture pipeline**

**Class:** leak · **Status:** proposed

`CardDef.captureURLs` is a clean contract: durable URLs, one per declared slot,
`undefined` when a capture does not exist. `CardDef.capturesMeta` carries each
slot's `width`, `height`, `deviceScaleFactor`, and `useAsThumbnail` — the capture
renderer's parameters, including a device scale factor that only means something
to the browser that rendered it.

**Proposal.** Keep the URL contract as it is. For dimensions, state the promise
an author needs: the rendered image's intrinsic size, in CSS pixels. Drop
`deviceScaleFactor` from the author-facing view, or rename it to what it promises
if a `srcset` assembler genuinely needs it — and then say what a `srcset`
assembler should assume about the other candidates.

---

## B-18

**The clock seam is a lint rule, not an API**

**Class:** gap · **Status:** proposed

`eslint/ambient-clock-selectors.cjs` bans `Date.now()` and a zero-argument
`new Date()` in card code, and points at `helpers/clock`'s `now()` / `nowDate()`.
The rule is right, and its reason is user-visible: a card that renders an elapsed
time changes without anyone editing it.

But the seam exists because a lint rule says so. Nothing in the card API states
that a card reads the clock through it, and nothing states what a runtime does
when it pins the instant.

**Proposal.** State it in [author API §1.7](author-api.md) as a contract
requirement, and state the runtime side: a runtime MUST provide a clock seam a
caller can pin, MUST route a card's reads through it, and MUST say which instant
a rendering used. The lint rule then enforces a contract instead of inventing one.

---

## B-19

**The erasable-TypeScript rule for card code is a lint rule, not a contract**

**Class:** gap · **Status:** proposed

`eslint/erasable-syntax-selectors.cjs` bans `enum`, `import =`, `export =`, and
value `namespace` in realm-compiled contents, with the reason "so it can run
under Node natively". The rule applies to card code, which is never run by bare
Node in production.

The real reason is portability, and it is a good one: a card is read by tools
that do not run the card pipeline. But an author who breaks the rule today gets
a lint error with a rationale that does not apply to their code.

**Proposal.** State the source-language contract in
[author API §1.4](author-api.md), with the portability reason. Then the lint
rule's message can say the true reason, and a runtime that cannot compile
non-erasable syntax is a conforming runtime rather than a broken one.

---

## B-20

**The reserved field-name list covers two members of a large provided surface**

**Class:** gap · **Status:** open

`RESERVED_FIELD_NAMES` is `['captureURLs', 'capturesMeta']`. The instance surface
the platform provides is much larger: `id`, `cardInfo`, `cardTitle`,
`cardDescription`, `cardTheme`, `cardThumbnailURL`, plus the symbol-keyed members
(`[fields]`, `[meta]`, `[relativeTo]`, `[realmURL]`, `[localId]`, `[isSavedInstance]`).
Symbols are safe because `@field` refuses them. The public names are not: an
author can declare `@field captureURLs` only for the two that are listed, and an
author can declare a field named `theme`, `notes`, or `url` that a later platform
member will want.

**Proposal.** Enumerate the instance surface a template can read
([author API §5](author-api.md)) and reserve exactly that list, checked at
definition time. Add a rule: a runtime MUST NOT add a member to the instance
surface that collides with an existing card's field. New platform members take a
name that is already reserved, or take a symbol.

---

## B-21

**A platform import rule reads like an author rule**

**Class:** note · **Status:** proposed

`AGENTS.md` states that only card definitions may use static ESM imports from
`@cardstack/base/*`, and that host-side modules must load at runtime. That is a
fact about the host's build, not about cards: a card definition is exactly the
place a static import is correct.

**Proposal.** Keep it out of the author contract, and state it in the host's own
documentation as a host build constraint. This entry exists so a later reader
does not turn it into a card rule.

---

## B-22

**`description` is a real author-facing feature that nothing states**

**Class:** note · **Status:** proposed

A field's `description` option is readable from a template through
`getFieldDescription`, and `base/brand-logo.gts` uses it that way. That is a
legitimate contract, and it is currently discoverable only by finding a use.

**Proposal.** State it in [author API §2](author-api.md): a field's description
is author-facing text a template and a field editor may show. Record that a
runtime MUST NOT require it for a card to render.

---

## B-23

**A card's icon is a component from one icon package**

**Class:** leak · **Status:** open

`BaseDef.icon` is typed `ComponentLike<{ Element: SVGSVGElement }>`, and every
card def in every realm imports its icon from the host's icon package. A card's
presentation therefore depends on a package the card's realm may not otherwise
use, and a runtime without that package cannot render a card's icon at all.

**Proposal.** Make an icon a reference the environment resolves, not a component
the author imports: a name, or a code ref, or a URL the realm serves. The
environment decides how to render it and what to show when it cannot. Keep the
current spelling working by resolving a component to a rendered asset, so no
existing card breaks.

**Open question.** Does an icon need to be a component for any card today — an
animated or themed icon — or is every icon in use a static glyph?

---

## B-24

**Runtime-owned values are author-facing sort keys**

**Class:** gap · **Status:** open

`lastModified`, `createdAt`, and `cardURL` are sortable in a query
(`generalSortFields` in `packages/runtime-common/index-query-engine.ts`). The
first two are server-owned metadata the contract says a runtime stamps and
strips; the third is a URL that is not durable across deployments.

Sorting by `lastModified` is a real card feature ("most recent first"). Sorting
by `cardURL` sorts by storage order in one deployment.

**Proposal.** Keep the two timestamps as named sort members and state what they
promise: when the realm last stored this card, and when it first stored it. Drop
`cardURL` from the author-facing sort set, or rename it to what it means and say
it is not portable.

---

## B-25

**`readSource` is a name an author may not use, for a reason only the server knows**

**Class:** note · **Status:** proposed

`base/operations.ts` refuses a declaration named `readSource` in two places,
because the realm answers that name "without reading a definition". The reason is
correct and the refusal is right — and it is written twice, in the decorator and
in lowering, because both must hold.

**Proposal.** State it once in [author API §11.5](author-api.md) as a property of
the name, not of two implementations. This entry exists so a third place does
not appear.

---

## B-26

**A card's default template drives the host's navigation**

**Class:** leak · **Status:** open

`base/default-templates/missing-template.gts` is the template a card gets when it
declares no `isolated` template of its own. It imports `SwitchSubmodeTool` from
`@cardstack/boxel-host/commands/switch-submode` and calls it with
`{ codePath: moduleId, submode: 'code' }`.

So the default rendering of every card in every realm depends on one host's
command surface, and on that command existing in the context it was handed. A
runtime without that command cannot render a card that declares no template —
which is the most portable kind of card there is.

**Why it matters.** Default templates are the part of the model an author does
not choose. If they reach the host, then "write no template and your card still
renders" is true only in this host.

**Proposal.** Give the author API the intent instead of the command: a card's
template MAY ask the environment to _show this card's definition_, and the
environment decides what that means and whether it can. A host that has a code
submode implements it as a submode switch; a runtime without one renders the card
without the affordance. Then a default template imports nothing from the host.

**Open question.** Is `switch-submode` reachable from a realm-sourced card in a
deployed realm today, or only in the local host? That decides whether this is a
portability fix or a live bug.

---

## Clean boundaries worth imitating

Recorded so a later change does not accidentally break them.

| Boundary                                                                 | Why it is right                                                                                                                                                             |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CardStore.resolveURL` / `canonicalizeId` / `realmForId` / `openableURL` | Gives a card the value it needs and never the mapping table. The comment on `CardStore` says the reason: stores expose URL-resolution capability, never the network object. |
| `captureURLs` absence signal                                             | `undefined` means "no capture yet", and the contract says a template must guard. An honest unknown, not a placeholder.                                                      |
| `LinkStrategy` ("assembly, not derivation")                              | States what the knob does not change, in the same breath as what it does. Most author-facing semantics need this half.                                                      |
| `canInvoke` / `keyReadiness` advisory rule                               | "Hide a control on `false`; never skip the call on `true`." The prediction/enforcement split, said out loud.                                                                |
| `markDefinition`                                                         | The author says at the call what the definition is, instead of the platform keeping a list of factories it recognizes.                                                      |
| ADR 010's closed list of ESM departures                                  | Every departure is named in the PR that adds it. That is the mechanism this whole chapter is asking for.                                                                    |

---

## Decisions this register needs from people

1. **B-01** — Is search depth the author's or the runtime's?
2. **B-04** — Do "editing" and "definition-visible" cover every card that
   branches on host mode today?
3. **B-08** — What is the rule for a value crossing two loader universes?
4. **B-13** — Is a file ever edited in place?
5. **B-16** — Is `cardInfo` the author's data or the platform's?
6. **B-20** — Which instance members are reserved, and may the platform ever add
   one that collides?
7. **B-23** — Must a card's icon ever be a component?
8. **B-24** — Is `cardURL` a sort by identity or by storage order?
9. **B-26** — Should a card's template be able to ask the environment to show
   the card's own definition at all?
