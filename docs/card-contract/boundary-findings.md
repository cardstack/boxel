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
| [B-01](#b-01) | What `searchable` promises is stated only in code comments                       | gap   | proposed |
| [B-02](#b-02) | `data-test-*` means two different things                                         | leak  | proposed |
| [B-03](#b-03) | The format list has three sources of truth, and they disagree                    | leak  | proposed |
| [B-04](#b-04) | Host UI modes are in the card context                                            | leak  | proposed |
| [B-05](#b-05) | The command → tool rename left three aliases, and cards use only the old names   | leak  | proposed |
| [B-06](#b-06) | `Box` is exported into the author API                                            | leak  | proposed |
| [B-07](#b-07) | `import.meta.loader` hands card code the loader                                  | leak  | proposed |
| [B-08](#b-08) | Cross-runtime channels are `Symbol.for` keys                                     | gap   | open     |
| [B-09](#b-09) | A prerender's missing services are per-member absence                            | gap   | proposed |
| [B-10](#b-10) | The store's diagnostics sit on the card-facing interface                         | leak  | proposed |
| [B-11](#b-11) | Synthetic search-doc keys are reachable from a card's own queries                | leak  | proposed |
| [B-12](#b-12) | The concept docs contradict the code                                             | gap   | proposed |
| [B-13](#b-13) | A file def declares an edit template it may not use                              | leak  | open     |
| [B-14](#b-14) | A store can decline `eager` without saying so                                    | leak  | proposed |
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
| [B-27](#b-27) | Third-party packages reach cards only through host shims                         | gap   | open     |
| [B-28](#b-28) | Cards read and write card data through three APIs                                | leak  | proposed |
| [B-29](#b-29) | The context offers five ways to run a query                                      | leak  | proposed |
| [B-30](#b-30) | A file has three addresses                                                       | leak  | proposed |
| [B-31](#b-31) | Template arguments and context members that cards do not use                     | leak  | proposed |
| [B-32](#b-32) | A second context channel: provide/consume                                        | leak  | proposed |
| [B-33](#b-33) | `packages/base` is both the runtime and a card library                           | gap   | proposed |
| [B-34](#b-34) | Tools and operations are two models of card behavior                             | gap   | open     |
| [B-35](#b-35) | Presentation statics name one host's chrome                                      | leak  | proposed |

### What the register proposes to remove

The contract is meant to be the smallest surface that makes a coherent card
model, not a transcription of what the reference runtime happens to expose.
Where a finding could be closed either by stating what exists or by removing
part of it, the register argues for removal. Taken together:

| Today                                                                      | Proposed                                                                            | Finding                      |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------- |
| All of runtime-common and every host tool, reachable through the shim list | Platform internals out of reach; third-party packages kept until package management | [B-27](#b-27)                |
| Three ways to read and write a card (store, host tools, operations)        | One read path, one write path                                                       | [B-28](#b-28)                |
| Five query members on the context, plus three provide/consume getters      | One search resource, one search component                                           | [B-29](#b-29)                |
| Two context channels (`@context` and ~11 provide/consume names)            | One                                                                                 | [B-32](#b-32)                |
| Three permission answers (`@canEdit`, `PermissionsContext`, `canInvoke`)   | Two, with distinct jobs                                                             | [B-32](#b-32)                |
| Six navigation functions across three routes                               | Two (`@viewCard`, `@createCard`)                                                    | [B-31](#b-31)                |
| Two names per presentation value, three thumbnail sources                  | Four members, one stored thumbnail                                                  | [B-16](#b-16)                |
| `captureURLs` and `capturesMeta`                                           | `captureURLs`                                                                       | [B-17](#b-17)                |
| A file's `id`, `url`, and `sourceUrl`                                      | `id`                                                                                | [B-30](#b-30)                |
| `instance[realmURL]` and `instanceRealmId`                                 | `instanceRealmId`                                                                   | [B-30](#b-30)                |
| `headerColor` beside `cardTheme`                                           | `cardTheme`                                                                         | [B-35](#b-35)                |
| Three old/new name pairs from the tool rename                              | One name each                                                                       | [B-05](#b-05)                |
| `mode` and `submode`                                                       | Two presentation intents                                                            | [B-04](#b-04)                |
| Synthetic `_`-prefixed search keys in card queries                         | Named concepts                                                                      | [B-11](#b-11), [B-24](#b-24) |
| `form` in the format type; `edit` on files                                 | Neither                                                                             | [B-03](#b-03), [B-13](#b-13) |

---

## B-01

**What `searchable` promises is stated only in code comments**

**Class:** gap · **Status:** proposed

`@field` accepts `searchable: true | string | string[]`, and it is the
author-facing answer to "how deep does my card's search go?".
`packages/base/searchable.ts` builds the search document from it: it is the
only place the option is read, and it decides which linked cards are pulled
into the search document and which are left as a bare `{ id }`.

The semantics are good, and they are written down only in the comments on the
`Searchable` type in `packages/base/card-api.gts` and at the top of
`packages/base/searchable.ts`. Two of them are easy to get wrong without being
told:

- `searchable` governs links only. A contained value is always in the search
  document once its owner is; a path on a contained field is meaningful only to
  reach a link beneath it.
- Depth is governed entirely by the card being indexed. A card pulled in as a
  link target does not consult its own `searchable`; only the indexed card's
  dotted path continues into it.

**Proposal.** State these in [author API §8](author-api.md) (done, §8.7), so the
comments describe one implementation of a stated contract.

**Note.** `packages/host/tests/unit/searchable-option-test.ts` described the
option as "inert — nothing consumes it" after the generator started reading it.
A stale comment that says an author-facing option does nothing is how an option
gets deleted by someone who believes it.

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
The rule is drawn by build, not by audience: a runtime built for production
MUST strip it from every rendering it serves, card code and prerendered HTML
included, and a runtime built for tests MUST keep it everywhere, because host
acceptance tests and the Playwright suite select on hooks inside card
renderings, some of them served from the index. Then the ban is a consequence
of the contract rather than a lint rule with two justifications.

**Open question.** Prerendered HTML is produced once and served to both kinds of
build in a shared environment. Does the strip happen when the HTML is produced
(so the index differs by build) or when it is served (so one index serves
both)? The second keeps the index build-independent.

---

## B-03

**The format list has three sources of truth, and they disagree**

**Class:** leak · **Status:** proposed

`packages/runtime-common/formats.ts` declares:

- A `Format` union of nine names, including `form` and `metadata`.
- A `formats` array of seven, which omits both.
- Three per-family lists: `cardDefFormats`, `fieldDefFormats`, `fileDefFormats`.

No card can declare a `form` template, and the renderer does not know the name.
It is a menu value: the code-submode playground's format chooser offers `form`
("auto-generated standard view") after `edit` when a card has a custom edit
template, and `playground-panel.gts` and `preview-panel/index.gts` render it as
`edit` against the base card's template. A host UI's menu entry is in the type
that names the formats a card's templates are keyed by. `metadata` is in
`fileDefFormats` but not in `formats`, so `isValidFormat('metadata')` is false
by default while the file family accepts it. Meanwhile `FileDef` declares
`static edit` (`FileDefEditTemplate`) while `fileDefFormats` excludes `edit`.

A card author reading one of these three gets a different answer from a reader
of another. A runtime implementing "the formats" has to guess which list is the
contract.

**Proposal.** One source: a per-family map from family to its formats, with the
`Format` union derived from it. Move `form` out of `Format` into the
playground's own chooser type (a chooser option that maps to a format and a
template source), then delete it from the union. Resolve the `FileDef` / `edit`
contradiction by deciding whether a file is editable in place (see B-13). Make
the union a type-level projection so adding a format to one family cannot
silently make it a name a card may write.

---

## B-04

**Host UI modes are in the card context**

**Class:** leak · **Status:** proposed

`CardContext` carries `mode?: 'host' | 'operator'` and
`submode?: 'interact' | 'code' | 'host'`, described as "Optional runtime
mode/submode hints used by cards that render differently per context." Nothing
in `packages/base` reads them today, but the interface invites every card to.

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

`code submode` is really the second: a card would render differently because the
viewer can edit the card's definition, not because a host tab is named "code".
Freeze `mode` / `submode` as host-internal, and give the host a way to pass the
intents.

**A related gap.** The host's layout already decides which context services a
card gets. `RealmURLContext` is provided only by an operator-mode stack item, so
a card rendered in code submode's playground or spec preview has none.
`base/links-to-editor.gts` and `base/realm-config.gts` work around it by reading
`model[realmURL]` and passing the realm explicitly, and their comments say why.
A service whose presence depends on where the host laid the card out is the
same leak by another route: [author API §10.2](author-api.md) requires such a
service to be named in this contract, with what a card does without it.

**Open question.** Is there a card outside `packages/base` that branches on
`mode` or `submode` for a reason the two intents do not cover?

---

## B-05

**The command → tool rename left three aliases, and cards use only the old names**

**Class:** leak · **Status:** proposed

The rename made three pairs, each kept because deployed realm content reads the
old spelling:

| Old name (what cards use)          | New name                        | Catalog uses, old / new |
| ---------------------------------- | ------------------------------- | ----------------------- |
| `Command` from runtime-common      | `Tool`                          | ~130 / 0                |
| `@cardstack/boxel-host/commands/*` | `@cardstack/boxel-host/tools/*` | ~300 / 0                |
| `@context.commandContext`          | `@context.toolContext`          | 96 / 16 (all in base)   |

Two names is two contracts. A runtime implementing the interface has to provide
both, and a card author cannot tell which is real. Here the new names have no
card users at all: the rename changed the platform's vocabulary without moving
a single card, so today it has added a contract rather than replaced one.

**Proposal.** Keep one name per pair, and move the cards to it, not the other
way round. Rewrite the catalog's imports and context reads with a codemod in one
change, then give the old spellings a sunset with a date and a measurement:
count the realms that still read them, and remove them when the count is zero.
A permanent alias is a permanent second contract.

Before doing that, settle [B-28](#b-28): most catalog imports of
`@cardstack/boxel-host/commands/*` are card reads and writes that should not go
through a host tool at all, so the codemod's largest effect may be deleting
imports rather than renaming them.

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

"Platform modules" here means the author API modules [B-33](#b-33) names, and
`code-ref.gts` (a field def) and `links-to-editor.gts` (the `linksTo` editor)
are among them. `spec.gts` is a library card, and passes `import.meta.loader` to
three calls; two catalog cards read it as well. Each of those is a card asking
for something the contract does not give, such as loading a definition named by
a code ref, and each needs an answer in the author API before the restriction
lands.

---

## B-08

**Cross-runtime channels are `Symbol.for` keys**

**Class:** gap · **Status:** open

About thirty `Symbol.for` keys in `packages/base` and
`packages/runtime-common` carry values across module universes. For example:
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

- **The instance store** — the members in [runtime contract §6.5–§6.9](runtime-contract.md):
  identity, settle, tracking. Small, complete, required.
- **The platform store view** — the diagnostics, reached by the platform through
  a separate type a card cannot import.

The card-facing store on `@context` (runtime contract §6.1–§6.4) is a third,
separate interface, and has no diagnostics.

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

Four statements in `docs/` are not true of the code, and each is something a
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

**A store can decline `eager` without saying so**

**Class:** leak · **Status:** proposed

The `eager` option's comment says it "Defaults to true". `CardStore.resolvesQueryFieldsEagerly`
says "Absent means it does not, so a store that has no opinion never starts a
search on its own behalf."

These do not contradict outright: a store that does not resolve eagerly still
resolves the field when something first reads it, so the author's value
arrives. What differs is when, and that is observable. A field the author left
eager may be unresolved when a prerender captures the card, and the card
renders its empty state into the index. Nothing tells the author that the store
they ran in declined the default.

**Proposal.** The author's default is the contract: a query-backed relationship
resolves with its owner unless the author says otherwise. `resolvesQueryFieldsEagerly`
is the store's capability answer. A store that cannot honor eager resolution
MUST say so in that answer, and a settle wait ([runtime contract §9.3](runtime-contract.md))
MUST include the first read of every eager field, so a store that defers the
query still has it resolved before the rendering is captured. State it in
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

The names also double up. Every presentation value has two names, and the
thumbnail has three sources:

| Read by consumers  | Stored as                                                                   |
| ------------------ | --------------------------------------------------------------------------- |
| `cardTitle`        | `cardInfo.name`                                                             |
| `cardDescription`  | `cardInfo.summary`                                                          |
| `cardTheme`        | `cardInfo.theme`                                                            |
| `cardThumbnailURL` | `cardInfo.cardThumbnailURL`, else `cardInfo.cardThumbnail`, else a capture. |

An author who wants to set a card's title has two places to look, and one of
them (`cardTitle`) is a computed that rejects a write.

**Proposal.** Shrink it to one name per concept. The presentation contract is
four members every card has: `cardTitle`, `cardDescription`, `cardTheme`, and
`cardThumbnailURL`. An author customizes one by overriding it with a computed,
which already works. `cardInfo` stops being part of the contract: it becomes the
default card's storage for those four, named for what it is, and a card that
overrides all four does not need it.

For the thumbnail, keep one stored source. A stored URL and a linked image do
the same job; keep the link, because an image card carries its own dimensions
and alt text, and treat a capture marked `useAsThumbnail` as the fallback the
runtime fills in, not as a third thing an author chooses. Then state the
fallback chain, including whether an untitled card is a real state or a
convenience.

---

## B-17

**`capturesMeta` exposes the capture pipeline**

**Class:** leak · **Status:** proposed

`CardDef.captureURLs` is a clean contract: durable URLs, one per declared slot,
`undefined` when a capture does not exist. `CardDef.capturesMeta` carries each
slot's `width`, `height`, `deviceScaleFactor`, and `useAsThumbnail` — the capture
renderer's parameters, including a device scale factor that only means something
to the browser that rendered it.

No catalog card reads either member yet; the only readers are in
`packages/base`. This is the cheapest moment to shape the surface.

**Proposal.** Keep the URL contract as it is, and remove `capturesMeta` from the
instance. Everything an author can use in it is already in the declaration they
wrote: `static captures` states each slot's width and height, in CSS pixels,
and whether it is the thumbnail. Repeating those on every instance gives an
author a second place to read the same fact, and gives the runtime a place to
add renderer parameters (`deviceScaleFactor` is one already). A `srcset`
assembler that needs the device scale factor is platform code, and reads it
from the server-owned `meta` it came from.

That leaves one provided member for captures, `captureURLs`, and one reserved
name fewer for [B-20](#b-20).

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

**Proposal.** Shrink the instance surface first, then reserve all of it. With
[B-16](#b-16) and [B-17](#b-17) applied, the provided string-named members are
`id`, the four presentation members, and `captureURLs`; [author API §7.8](author-api.md)
lists them. Reserve exactly that list, checked at definition time. Add a rule: a runtime MUST NOT add a member to the instance
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

## B-27

**Third-party packages reach cards only through host shims**

**Class:** gap · **Status:** open

Cards are meant to use third-party packages freely, the way any JavaScript
program does. Today the only way a card gets one is a host shim:
`packages/host/app/lib/externals.ts` registers about sixty modules a card can
import by bare specifier, each one the host's own copy of a package the host
happens to bundle. That is a stopgap. The lasting answer is package management,
almost certainly compatible with the npm registry, and designing it is a
standalone project this contract does not attempt.

This finding records where the boundary is weak until that project lands, so
the gaps are known and none of them gets mistaken for a decision.

### Where the boundary is weak

1. **The host chooses the set.** A card can use only a package the host
   bundles, and adding one means changing the host. The set is whatever some
   host module needed: it has `lodash` _and_ `lodash-es`, fifteen
   `ember-animated` submodules beside `glimmer-motion`, and `matrix-js-sdk`.
2. **No versions.** A card cannot say which version of a package it was written
   against. It gets the host's, and a host upgrade can change a card's
   behavior with no change to the card. A second runtime cannot tell which
   version to serve.
3. **No declared dependencies.** A card's package needs are discoverable only
   by reading its imports. A runtime cannot check before loading that it can
   run a card, and a missing package fails at load time, in whichever context
   loaded the card first.
4. **Shared instances.** A shim hands every card the host's own module
   instance. Module-level state is shared between the host and every card in
   the tab: a card that sets a library's global configuration (a default
   locale, a mixin) changes it for the host and for every other card.
5. **Silent stubs.** Some specifiers resolve to empty `fallbackShim` namespaces
   whose missing names read as `undefined`: the host's test helpers,
   `@cardstack/host/services/store`, `@ember/owner`, and
   `@cardstack/host/config/environment`. They exist so a realm's co-located
   `*.test.gts` card tests load outside a test run. A card that imports one of
   them outside a test gets `undefined` instead of an error, which
   [author API §1.5](author-api.md) forbids ("fail loudly rather than
   substitute"). Catalog modules import the host's test helpers about 140
   times, so card tests are a real author surface this contract does not cover
   yet.
6. **Platform internals share the mechanism.** The shim list does not tell a
   third-party package from the platform's own code. All of
   `@cardstack/runtime-common` (the index query engine, the realm, the loader,
   the queue) is reachable, and catalog cards import a few dozen names from it:
   mostly `Command` ([B-05](#b-05)), `identifyCard`, `codeRef`, the `realmURL`
   symbol, `rri`, and the query types, but also `Loader`, `loadCardDef`,
   `logger`, `subscribeToRealm`, and a wire-format converter. Every host tool is
   reachable under `@cardstack/boxel-host/commands/*` and `tools/*`
   ([B-28](#b-28)), and so are three host internals under
   `@cardstack/boxel-host/lib/`.

### Proposal

Do not close the set of packages, and do not design package management here.
Until it exists:

- **Separate the platform internals now** (weakness 6). This does not depend on
  package management. `@cardstack/runtime-common` and `@cardstack/boxel-host/*`
  stop being importable by cards. What cards genuinely use from runtime-common
  moves to a card-facing author API module under the same names (`codeRef`,
  `identifyCard`, `rri`, the query types). `Loader`, `loadCardDef`, `logger`,
  and the wire converters do not move; each catalog use is either an `import()`
  or a gap this register should record.
- **Keep serving third-party shims, and keep adding them when cards need them.**
  Each shim is an entry in the inventory the package management project starts
  from, so keep the list in one place. Removing a shim no card imports is
  cheap and MAY happen any time.
- **Make the stubs fail loudly outside tests** (weakness 5). A fallback stub is
  served only to a test module, and everywhere else the specifier fails to
  resolve.
- **Say what a card may rely on meanwhile.** A card MAY import a shimmed
  package. It MUST NOT rely on a particular version, or on module state it
  shares with the host ([author API §1.10](author-api.md)).

The package management project inherits weaknesses 1–4 as its requirements:
packages from a registry, versions a card or realm declares, dependencies
declared before load, a stated rule for whether two cards share a package
instance, and the same answer in every context (live host, prerender,
server-side read, script).

---

## B-28

**Cards read and write card data through three APIs**

**Class:** leak · **Status:** proposed

A card that wants to load, save, or change another card has three ways to do it:

| Path       | How a card reaches it                                                                                    | Catalog uses                   |
| ---------- | -------------------------------------------------------------------------------------------------------- | ------------------------------ |
| The store  | `@context.store`: `get`, `add`, `patch`, `search`, …                                                     | ~15 calls                      |
| Host tools | `new SaveCardCommand(commandContext).execute(…)`; also `get-card`, `patch-card-instance`, `search-cards` | ~210 imports                   |
| Operations | `operations(card).update(…)`, `.atomic(…)`, or a declared name                                           | ~130 declared, a dozen invoked |

The host tools are the most used and the least portable. They are the host's
implementation of the AI assistant's tools, imported from the host by module
path ([B-27](#b-27)), and a card reaches them by constructing a host class with
the host's command context. A runtime that is not this host cannot run any of
the 92 catalog modules that import `save-card`.

Operations are declared widely and invoked rarely, and every catalog invocation
casts first: `(operations(card) as any).atomic(…)`. A typed accessor that every
caller defeats is not yet serving as the author API.

Operations are the one path the realm itself enforces: they carry the def
family's implied operations, the realm's authorization decision, and the batch
commit. The store's writes and the host tools both end up as realm writes, but
neither states which operation it performs or which policy decided it.

**Proposal.** One read path and one write path, both in the contract:

- **Reads** go through the store on `@context` and the instance itself (a
  linked card is read by reading the field). A card does not import a tool to
  fetch a card.
- **Writes** are operations. The store's write methods become the card-facing
  way to invoke `create`, `update`, and `delete` on a card, and say so; there is
  no second write path with its own semantics.
- **Host tools** stay what they are for: the AI assistant's tools, and host
  automation. A card MAY offer a person a tool to run, through the context
  ([author API §10](author-api.md)), but MUST NOT need one to read or write a
  card.

Of the store's twelve methods, eight have no catalog users: `save`, `create`,
`addWithoutPersisting`, `addWithoutWaiting`, `peek`, `peekError`, `delete`, and
`getSaveState`. Deciding the write path above settles which of them are
contract, and the expectation is that most are not.

`operations()` needs a type a caller can use without casting: the implied
operations of the target's family, plus its declared ones, inferred from the
definition.

---

## B-29

**The context offers five ways to run a query**

**Class:** leak · **Status:** proposed

A card that wants the cards matching a query can use `@context.getCard`,
`@context.getCards`, `@context.getCardCollection`, `@context.store.search`, or
`@context.searchResultsComponent`. The store adds `getSearchResource`, and the
same three getters are also provided again through provide/consume contexts
([B-32](#b-32)).

`getCards` is the most used (about ninety reads across catalog and base);
`searchResultsComponent` is the newest and its own comment says it "supersedes
`prerenderedCardSearchComponent`". `getCardCollection` has no catalog user.

**Proposal.** Two members, one per job:

- **A search resource**: a query in, a reactive list of results out, with the
  total and completeness ([runtime contract §10.7](runtime-contract.md)).
  `getCard` is this with an id filter; `getCardCollection` is this with a list
  of ids.
- **A search rendering component**: the same query in, rendered results out,
  live or prerendered without the card branching
  (`searchResultsComponent` as it is).

`store.search` is the imperative form of the first, for code outside a template.
Keep it only if there is a card use the resource does not cover, and say which.

---

## B-30

**A file has three addresses**

**Class:** leak · **Status:** proposed

`FileDef` declares `id`, `url`, and `sourceUrl`. The file indexer
(`packages/runtime-common/index-runner/file-indexer.ts`) stamps all three with
the same value, the file's URL in this deployment.

Three names for one value is two too many, and that value is the wrong kind for
two of them: [ADR 002](../adr/002-keep-identifiers-canonical-resolve-at-network-boundary.md)
says identifiers travel in canonical form, and a stored deployment URL does not
survive a realm move.

**Proposal.** A file has one address, `id`, an RRI like a card's. A card that
needs a URL a browser can load asks for one ([author API §7.2](author-api.md)),
which for a file is `openableURLOf`. Remove `url` and `sourceUrl` from the
instance. Keep them in the search document only as long as a migration needs
them, and not as card fields.

A card's realm is doubled the same way. `instanceRealmId(instance)` gives the
realm in the same canonical form as the card's id. `instance[realmURL]`, a
symbol catalog cards import from `@cardstack/runtime-common` about 36 times,
gives it as this deployment's URL. Keep `instanceRealmId`, and make the symbol
platform-only.

---

## B-31

**Template arguments and context members that cards do not use**

**Class:** leak · **Status:** proposed

The navigation functions reach a card three ways: as template arguments
(`@createCard`, `@viewCard`, `@editCard`, `@saveCard`), through the
`CardCrudFunctions` provide/consume context (which adds `deleteCard`), and
formerly as `@context.actions`.

In the catalog, `@viewCard` has ten uses and `@createCard` three. `@editCard`
and `@saveCard` have none. `@context.actions` no longer exists, and two catalog
cards still read it through `(this.args as any).context?.actions`, which
silently yields `undefined`.

`@saveCard` is a write path ([B-28](#b-28)). `@editCard` asks the host to open
an editor, which is the presentation intent [B-04](#b-04) names.

**Proposal.** Keep `@viewCard` and `@createCard` as the two navigation requests
a card may make, with stated semantics: ask the environment to show a card, or
to start creating one of a type. Remove `@editCard` and `@saveCard` from the
template arguments and `CardCrudFunctions`, and remove `deleteCard` (a write
path). Add the two catalog cards that read `context.actions` to the list a
codemod fixes.

---

## B-32

**A second context channel: provide/consume**

**Class:** leak · **Status:** proposed

Besides `@context`, cards read the environment through Ember's provide/consume
contexts, keyed by names in `packages/runtime-common/constants.ts`:
`CardContextName`, `CardCrudFunctionsContextName`, `CommandContextName`,
`DefaultFormatsContextName`, `GetCardContextName`, `GetCardsContextName`,
`GetCardCollectionContextName`, `PermissionsContextName`, `CardURLContextName`,
`RealmURLContextName`, and `CardSearchDefaultRealmContextName`. Catalog and base
cards consume at least six of them and provide two.

This is a sixth channel, which [runtime contract §1.1](runtime-contract.md)
says does not exist. It is also the channel through which a context service's
presence depends on host layout: `RealmURLContext` is provided by an
operator-mode stack item, so a card rendered in the playground does not get it
([B-04](#b-04)). And it duplicates the first channel. Permission alone reaches a
card three ways: `@canEdit`, `PermissionsContext` (`canRead`, `canWrite`), and
`@context.canInvoke`.

**Proposal.** One context channel. Everything a card may ask the environment
for is a member of `@context`, listed in [author API §10](author-api.md), with
its availability stated. The provide/consume names become platform-only: the
host uses them to thread values to its own components and to the code that
builds `@context`, and cards stop importing the names.

For permissions, keep two answers with distinct jobs: `@canEdit` (may this
viewer change this card here) and `canInvoke` (may this session invoke this
operation). `PermissionsContext` goes; a card that needs `canRead` on another
card asks whether it can invoke `read`.

**Open question.** A card that provides a context to its own descendants
(`PermissionsContextName` and `DefaultFormatsContextName` are provided in
`base/spec.gts` and `base/field-component.gts`) is using the channel for composition, not to reach the environment.
Does the author API need a way for a card to pass a value to the cards it
renders, or is a component argument enough?

---

## B-33

**`packages/base` is both the runtime and a card library, and nothing says which
module is which**

**Class:** gap · **Status:** proposed

The base realm holds about 170 modules. Some are the author API itself:
`card-api.gts`, `operations.ts`, the primitive field defs, the file-def
families, the default templates, `helpers/`. The rest are cards like any other:
`cards-grid.gts`, `workspace.gts`, `spec.gts`, `skill.gts`, `theme.gts`,
`welcome-to-boxel.gts`.

The register keeps meeting this: [B-04](#b-04), [B-07](#b-07), [B-11](#b-11),
and [B-26](#b-26) each cite a base module as a card that reaches past the
contract, and each proposal works only if that module is held to the contract.
But some base modules legitimately use platform-only members, and today no rule
says which ones may.

**Proposal.** Split the realm's modules into two named groups, and state each
group's rule in the [README](README.md#the-base-realm):

- **Author API modules** are part of the runtime. They MAY use platform-only
  members, because they implement the contract. They MUST NOT depend on one
  host: a default template that imports a host tool ([B-26](#b-26)) breaks
  every other runtime.
- **Library cards** are cards. They get exactly what any card gets. A library
  card that needs more is a finding against the contract, not a precedent for
  other cards.

The list of author API modules is part of the contract ([author API §1.9](author-api.md)).

---

## B-34

**Tools and operations are two models of card behavior**

**Class:** gap · **Status:** open

A card author can define behavior two ways. A **tool** (`Tool`, still imported
as `Command`) is a class whose `run` method is imperative JavaScript, executed in
a host tab with the host's tool context. An **operation** (`@operation`) is a
declaration the realm lowers and runs without executing the card's module
([author API §11](author-api.md)). The catalog has both in quantity: about 136
modules define a tool, and about 130 operations are declared.

They overlap: both are named, invokable units of behavior attached to a card's
definition, both are offered to the AI assistant, and both can write cards. They
differ in everything the contract cares about: where they run, what authority
they have, whether the realm can decide them, and whether a runtime other than
this host can run them.

**Proposal.** Decide which is the card author's unit of behavior, and state the
other's role. The recommendation: operations are the contract for behavior on a
card, because the realm can run and authorize them without a browser. Tools are
the host's automation API, a separate surface the contract names and does not
govern, which a card may offer through the context but does not need to define
its own behavior.

---

## B-35

**Presentation statics name one host's chrome**

**Class:** leak · **Status:** proposed

`static headerColor` is "the color of the card's container header". The only
reader is the operator-mode stack item
(`packages/host/app/components/operator-mode/stack-item.gts`). About 25 catalog
cards set it. `static prefersWideFormat` was described in the host's terms too,
as wanting "a full-width container in a stack", and about 60 catalog cards set
it.

A second host has no stack and no container header. A card that sets
`headerColor` gets nothing there, and an author cannot tell from the contract
which hosts honor it ([author API §9.1](author-api.md) says a static one context
ignores is a defect).

**Proposal.** Keep `prefersWideFormat`, stated as what it asks for: the card's
isolated rendering wants all the width it can be given, which any host can
honor or not. Remove `headerColor`. A card's color is its theme's job, and the
contract already has `cardTheme`. A host that draws a header around a card takes
the header's color from the card's theme, so one declaration colors the card and
its chrome in every host.

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

1. **B-04** — Do "editing" and "definition-visible" cover every card that
   branches on host mode today?
2. **B-08** — What is the rule for a value crossing two loader universes?
3. **B-13** — Is a file ever edited in place?
4. **B-16** — Is `cardInfo` the author's data or the platform's?
5. **B-20** — Which instance members are reserved, and may the platform ever add
   one that collides?
6. **B-23** — Must a card's icon ever be a component?
7. **B-24** — Is `cardURL` a sort by identity or by storage order?
8. **B-26** — Should a card's template be able to ask the environment to show
   the card's own definition at all?
9. **B-27** — Are card tests (`*.test.gts` in a realm) part of the author
   API, and if so, what may they import?
10. **B-28** — Are operations the one write path, and which store methods
    survive?
11. **B-32** — Does a card need a way to pass a value to the cards it renders,
    beyond a component argument?
12. **B-34** — Is the operation or the tool the card author's unit of behavior?
