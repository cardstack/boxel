# Boxel rendering protocol — v1 DRAFT

## RP-0 Status, scope, and how to read this document

**RP-0.1** This is the normative specification of the Boxel rendering
contract: what a card author's code may rely on at render time, the records
and operations that cross an execution boundary, the routing rules that
select a trust tier, and each tier's obligations. It is derived from `main`'s
observed behavior (extracted at `origin/main` = `43e3a530cb`), not designed
forward. Rationale and the larger future live in
[boxel-execution-runtime-architecture.md](boxel-execution-runtime-architecture.md);
the delivery plan is
[boxel-rendering-protocol-plan.md](boxel-rendering-protocol-plan.md).

**RP-0.2** Status: **DRAFT**. It becomes NORMATIVE when the Direct
equivalence suite (RP-8.2) is green. From that point, no adapter PR may
change this document or the protocol module; a spec change requires a
version bump, a Direct conformance proof, and adapter updates in one PR.

**RP-0.3** Every normative statement carries an ID (`RP-x.y`). The
conformance suite mirrors these IDs; CI enforces the bijection: a statement
with no test and a test citing no statement both fail the build (RP-8.5).

**RP-0.4** File/line citations are informative, pinned to the extraction
commit; the statement text is what binds. `[GAP]` marks main behavior that
is arguably defective but is preserved until a versioned change decides
otherwise. `[DEFERRED]` and `[EXCLUDED]` are collected in RP-9.

**RP-0.5** Tiers: **Direct** (trusted code, Host loader), **Capsule**
(authored code in an SES compartment, Host Glimmer renders), **Sandbox**
(authored code and Glimmer in an origin-isolated iframe). Routing is RP-6.
Direct is the reference implementation: where this spec is silent, main's
Direct behavior is the contract.

---

## RP-1 Component entry

**RP-1.1** `BaseDef.getComponent(card, field?, opts?)` returns the renderable
component for an instance. It is memoized per `(model, componentCodeRef)` so
reactive re-renders never remount the tree (`card-api.gts:4747-4753`).

**RP-1.2** The returned value is both invokable (`<Thing/>`) and indexable
(`<Thing.someField/>`): a proxy whose properties are the declared fields'
components, with `ownKeys` exposing declared field names (so
`{{#each-in @fields}}` works) (`field-component.gts:551-686`).

**RP-1.3** `opts.componentCodeRef` pins rendering to an ancestor class's
format component (used by prerender for per-ancestor embedded/fitted HTML).
No match falls back to the instance's own class
(`field-component.gts:198-220`).

**RP-1.4** Component identity is stable per `Box`: the same box yields the
same component instance (`componentCache`, `field-component.gts:153-176`).
A polymorphic class swap busts the cache. Stability is what preserves input
focus across re-renders; every tier must preserve it.

**RP-1.5** The host render entry (`CardRenderer` on main) provides
`CardURLContextName` (= `card.id`) and seeds `DefaultFormatsContextName` as
`{cardDef: format ?? 'isolated', fieldDef: format ?? 'isolated'}` — both
axes from the caller's format (`card-renderer.gts:41-61`). The only
format it special-cases is `head` (RP-2.9). It has **no** error or loading
branch: error/loading presentation is chrome's job (RP-11.4).
`BoxelExecutionRenderer` seeds identically; the rp-equivalence suite holds
it to this statement.

**RP-1.6** `@displayContainer` is a pure pass-through; `undefined` means
`true`, only an explicit `false` suppresses the container
(`field-component.gts:356`).

## RP-2 Formats

**RP-2.1** The renderable format inventory is
`isolated, embedded, fitted, atom, edit, head, markdown`
(`runtime-common/formats.ts:19-27`). `metadata` and `form` exist in the
`Format` type but are not renderable-format members; they are reserved.

**RP-2.2** Per-kind slots: CardDef declares all seven; FieldDef declares
`embedded, fitted, atom, edit, markdown` (no `isolated`, no `head`); FileDef
declares `isolated, embedded, fitted, atom, head, markdown, metadata`
(`formats.ts:29-47`).

**RP-2.3** A def declares a format as a static class field
(`static isolated: BaseDefComponent = ...`); inheritance is plain static
inheritance. Defaults when undeclared: CardDef gets the Base default
templates (`card-api.gts:3289-3299`, with `isolated === edit ===
DefaultCardDefTemplate`); FieldDef gets `MissingTemplate` for
embedded/fitted, `FieldDefEditTemplate` for edit
(`card-api.gts:2733-2741`).

**RP-2.4** Format resolution: an explicit `@format` that is a member of the
renderable inventory sets both axes; otherwise the ambient default formats
win entirely. An unknown format is **silently ignored**, not an error
(`determineFormats`, `field-component.gts:178-192`).

**RP-2.5** A computed field never renders `edit`; it is rewritten to
`embedded` at format resolution (`field-component.gts:187-190`).

**RP-2.6** The child-format cascade, re-derived at every nesting level
(`defaultFieldFormats`, `field-component.gts:599-619`):

| containing format            | nested FieldDef | nested CardDef |
| ---------------------------- | --------------- | -------------- |
| edit                         | edit            | edit           |
| isolated / embedded / fitted | embedded        | fitted         |
| atom                         | atom            | atom           |
| head                         | head            | head           |
| markdown                     | markdown        | markdown       |
| (anything else)              | embedded        | fitted         |

`edit`, `atom`, `head`, `markdown` are fixed points; the tree stabilizes at
`{embedded, fitted}` for the display formats.

**RP-2.7** In `edit`, a linked CardDef/FileDef target renders `fitted` (a
linked card is never edited inline); a linked FieldDef keeps `edit`
(`getChildFormat`, `card-api.gts:1612-1628`). The linksToMany editor renders
FieldDef elements as `atom` pills, card elements as a `fitted` sortable
list.

**RP-2.8** Edit/view slot coalescing: when a class's `edit` slot is the same
reference as its `isolated` (cards) or `embedded` (fields) slot, the same
component instance serves both formats so toggling edit does not remount;
templates branch on `@format` (`field-component.gts:232-256`).

**RP-2.9** `[GAP]` A missing format slot resolves to `undefined` and fails
the render (`field-component.gts:253-255`). Concretely: FieldDef declares no
`head` static, yet the `head` cascade sets `fieldDef: 'head'`, so a
contained field inside a `head` template renders `undefined`. Preserved as
main behavior; a versioned change may introduce a trusted fallback.

**RP-2.10** Format-driven geometry is owned by Base, not the card:
`isolated → height:100%`; `fitted → container-name: fitted-card;
container-type: size; min-height 40px; max-height 600px; overflow hidden`;
`embedded → container-type: inline-size`; `atom → display:contents` /
`inline-block` by display-container (`field-component.gts:482-540`). The
named fitted footprints are `FITTED_FORMATS` (`formats.ts:49-166`). Cards
must not alter geometry at the card boundary.

## RP-3 Fields, model, and component arguments

**RP-3.1** The authored component argument contract (what every format
component receives) is: `@cardOrField, @model, @fields, @format, @set,
@fieldName, @context, @configuration, @createCard, @viewCard, @saveCard,
@editCard, @canEdit, @typeConstraint` (`field-component.gts:388-407`,
`BaseDefComponent` `card-api.gts:2695-2717`). `[GAP]` `SignatureFor` omits
`cardOrField` and `typeConstraint` from the published type; `deleteCard` is
in `CardCrudFunctions` but is never threaded as a component argument.

**RP-3.2** `@model` is the live instance for cards/compound fields (getters
reachable) and the raw value for primitive fields. `@set` writes through the
`Box` chain to the real model descriptor. `@fieldName` is the box name
(numeric string for plural children).

**RP-3.3** `contains` composite values are never null: `emptyValue` is a
fresh instance for composites and the field's declared empty for primitives
(`card-api.gts:1197-1203`).

**RP-3.4** Plural fields: `@fields` of a plural field is array-like
(iterable, `length`, index). Plural boxes key children by **value identity**
unless the element class declares `static [useIndexBasedKey]` (all Base
primitives do) — this keeps `{{#each}}` stable while editing
(`card-api.gts:4880-4908`).

**RP-3.5** Polymorphism: the rendering class for a composite value is the
runtime value's constructor (a subclass stored in a `contains(Base)` field
renders with its own templates); per-instance overrides via the `[fields]`
channel re-render on assignment (`card-api.gts:645-670, 3218-3233`).

**RP-3.6** Field descriptors are introspectable at render:
`getFields(cardOrInstance, opts?)`, `getField(instance, name)`,
`getFieldDescription`, and descriptor members `name`, `card`, `fieldType`
(`'contains'|'containsMany'|'linksTo'|'linksToMany'`), `computeVia`,
`configuration`, `queryDefinition` are author-reachable.

**RP-3.7** Reactivity has one root: `cardTracking` (a per-instance
TrackedWeakMap read in every field getter, written by every `setField`)
(`field-support.ts:52-55, 214-218`). The data buckets themselves are
untracked. Every tier must reproduce invalidate-on-instance, not
per-field tracking.

## RP-4 Computed values

**RP-4.1** `computeVia` is **function-form only**: `() => unknown`, invoked
bound to the instance (`card-api.gts:344`; `field-support.ts:172-182`).
There is no string/method-name form on main.

**RP-4.2** Computeds are strictly synchronous. A compute returning a Promise
stores the Promise as the value; there is no async-computed loading state.

**RP-4.3** A compute returning `undefined` falls back to the field's
`emptyValue` (`field-support.ts:173-184`).

**RP-4.4** A plain class getter is not a field: invisible to `getFields`,
never serialized or indexed, unreachable via `<@fields.x/>`, reachable only
as `@model.x`. A `computeVia` field is a real field: renderable, indexed,
excluded from edit (RP-2.5) and from `@canEdit`.

**RP-4.5** There is no error boundary around computes: a throwing
`computeVia` fails the render; chrome presents the error (RP-11.4). The only
structured in-render error states are relationship states (RP-7).

## RP-5 Field configuration

**RP-5.1** Configuration inputs are the FieldDef's `static configuration`
and the per-usage `options.configuration`; each may be an object or a
function called with the **owning root instance** as `this`
(`card-api.gts:308-312, 2731`).

**RP-5.2** Resolution merges FieldDef-static first, per-usage second
(per-usage wins), one level deep: nested plain objects spread-merge one
level, arrays and `null` replace, `undefined` never overwrites. Resolution
is memoized per `(instance, fieldName)` and invalidated by instance
mutation (`field-support.ts:236-312`).

**RP-5.3** The resolved value is delivered as `@configuration`. The owning
instance itself is deliberately not exposed to nested templates
(`field-component.gts:320-338`).

**RP-5.4** Cross-tier rule: configuration functions execute with their
semantic owner (authored functions in the authored tier); the resolved
**data** crosses the boundary. Trusted-Base semantics (e.g. a currency
symbol getter) are materialized by the Host over the canonical instance and
cross as data — no tier re-implements or vendors trusted Base behavior.

## RP-6 Routing rules

**RP-6.1** Routing is a pure, total, ordered function from a module's
resolved import-graph facts to a tier:

```
R1  Module has trusted Base/Cardstack-package provenance           → Direct
R2  Module's import closure requires browser authority,
    or contains an unresolvable import (fail closed + diagnostic) → Sandbox
R3  Module declares `static prefersFullSandbox = true`             → Sandbox
R4  Otherwise authored                                             → Capsule
R5  Host policy may escalate isolation; nothing may de-escalate
    (authored code never routes Direct, whatever it requests)
```

**RP-6.2** Classification is module-based: all formats defined by a module
share its route. A nested Boxel defined in a different module routes
independently. Authors recover Capsule for compact formats by splitting
browser-dependent formats into separate modules.

**RP-6.3** Format-level containment: compact/non-DOM formats (`fitted`,
`atom`, `head`, `markdown`) AND the `edit` surface of a Sandbox-classified
module render in Capsule and fail closed there — composition (especially
fitted galleries) never creates inline iframes, and the STANDARD `edit`
surface must run host-side because it is the trusted Base editor chrome
operating directly on the canonical store — a module with no authored
edit template contributes no authored code to that surface, so demoting
it de-escalates nothing (`executionDecisionForFormat`).
EXCEPTION — stated as the principle, not the trigger: `edit` demotes
ONLY when the surface would contain no authored template at all. A
module authoring ANY `static edit = …` template — on the card class (an
in-place editor) or on any of its FieldDefs (authored cell/field
editors) — contributes authored code to the edit surface, and authored
code never runs below its module's classified tier (R5): the edit
surface keeps the Sandbox, in the SAME retained iframe as the isolated
render (the runtime router retains the process by surface identity
across format switches), so in-iframe state survives the switch. The
standard Base editor chrome renders inside the child around those
authored editors; entitlement arrives via the RP-9.1 context push and
persistence via the RP-20.6 write leg.

**RP-6.4** Static import edges come from the canonical transpiler/parser.
Browser-authority candidates come from comment/string-masked source and are
confirmed with scope-aware Babel AST checks (including `globalThis`, `self`,
computed properties, and destructuring), not from compiled wire opcodes or
an unscoped token-regex decision. The complete reachable graph is collected
before deterministic promotion, so import order and cycles cannot change the
answer. The mounted tier is stamped as `data-boxel-execution`
(`direct|capsule|sandbox|prerender`) with `data-boxel-execution-reason` —
a diagnostic, not an author API. Every top-level `CardRenderer` invocation
enters this router by default. A trusted caller must explicitly request the
legacy Direct path; delegated field renders remain inside the execution
environment already selected for their parent instead of recursively opening
one boundary per field. The stamped execution mode describes the provider of
the mounted format: a Capsule-classified definition with no authored `edit`
format therefore stamps `direct`, because trusted Base owns and renders that
format against the canonical Store instance.

**RP-6.5** The standard-view base-template override (interact mode's
"Toggle Standard View", the preview panel's synthetic `form` format — a
`baseCardRef` passed alongside `execution='auto'`) is resolved by the
execution renderer per tier, never by opting the render out of the
execution runtime. For Direct and Capsule it resolves host-side through
`trustedBaseRenderSlotFor` — the same trusted-Base resolution a Capsule's
missing authored format takes. For a Sandbox-classified module it is
REFUSED: the authored render stays confined to the iframe and the override
is ignored with a diagnostic, because honoring it host-side would execute
the module's authored field templates in the main document. This is an
instance of R5: nothing may de-escalate isolation.

## RP-7 Relationships and lazy loading

**RP-7.1** Link state is a five-way union: `present`, `not-loaded`,
`error`, `not-found`, `not-set` (`field-support.ts:666-696`). All
non-present states read as `undefined` (singular) / absent (plural) through
the ordinary getter; `getRelationshipMembershipState(instance, fieldName)`
is the only sanctioned structured observation and is a pure read.

**RP-7.2** The field getter is the lazy-load trigger: reading a link starts
the fetch, deduped per `${field}/${reference}`, returning `undefined`
synchronously. On success the value is assigned through the normal setter
path (array identity preserved for plurals); on failure a **terminal**
sentinel is planted (`404 → link-not-found`, else `link-error`) and never
retried (`card-api.gts:3557-3798, 1317-1324`).

**RP-7.3** A still-loading link renders the empty/absent presentation, not
a spinner; `isLoading` is observable only via membership state, invalidated
by a microtask-deferred monotonic signal (`field-support.ts:81-111`).

**RP-7.4** Broken links present via `BrokenLinkTemplate` with
`@state ∈ {error, not-found}` and an `errorDoc` carrying `status`,
`message`, `stack`; there is no distinct unauthorized state (a 403 is a
`link-error` with `status: 403`). The placeholder renders in one of four
footprints; `edit → fitted`, `head|markdown|... → embedded`
(`card-api.gts:2302-2318`).

**RP-7.5** Plural sentinel masking: index access on a `linksToMany` value
hides sentinels as `undefined`; editors rebuild from `rawArrayValues` so
broken siblings survive add/remove/reorder
(`links-to-many-component.gts:133-206`).

**RP-7.6** Query-backed relationships (`options.query`) render like links,
are never editable, are skipped by broken-link scans, and are excluded from
the search doc.

## RP-8 Instance identity and documents

**RP-8.1** `createFromSerialized(resource, doc, relativeTo, opts)` resolves
`meta.adoptsFrom` against **the resource's own id** when it has one, else
the supplied `relativeTo` (`card-serialization.ts:105-128`). The canonical
relative-resolution base for instances is the shared `[relativeTo]` symbol;
ids are opaque `RealmResourceIdentifier`s, never fed to `new URL()`.

**RP-8.2** Identity map: same canonical id + assignable class ⇒ the same
instance object, updated in place; a class mismatch constructs fresh.
Instances register mid-deserialization (untracked) so cyclic `included`
graphs resolve, and are promoted to tracked only when complete
(`card-api.gts:4248-4304, 4613-4615`). One instance is keyed under its
localId and every known remote id; a remote id claimed by a second local id
is a hard error. Layering note (informative): "constructs fresh" is the
card-api layer's behavior; through the Host store, the fresh instance's new
local id immediately trips the second-local-id hard error at registration —
so the only Store-level observable of a mismatch sequence is that error,
whose diagnostic names both local ids. A NORMATIVE revision should state
this composition explicitly.

**RP-8.3** Side-loaded resources enter only via `resourceFrom(doc, id)`
matching `data.id` (never `links.self`); an absent `included` entry yields
`not-loaded`; nested `included` entries resolve recursively with the same
document (`card-serialization.ts:195`; `card-api.gts:1494-1537`).

**RP-8.4** Cross-boundary corollary (the tier-neutral restatement of
RP-8.1–8.3): an execution document carries absolute/canonical module
identities and explicit `included` resources; a consumer never derives a
module base from an instance id, and receiving a document grants no realm
read/search authority beyond the granted graph.

**RP-8.5** Store reads: `peek` (sync) may return a stale instance when the
server has an error for the id; instance-over-error is preferred so stale
data stays renderable (`gc-card-store.ts:666-671`).

## RP-9 Edit and save (mutation v1)

**RP-9.1** Render-time writability is exactly
`(not computeVia) ∧ (not queryDefinition) ∧ permissions.canWrite`, delivered
as `@canEdit`; absent permissions context ⇒ not writable. Editors render
disabled, not hidden (`field-component.gts:401-405`). The Sandbox tier
honors this through a pushed context snapshot: host chrome's live
permissions cannot flow into a cross-origin child through component-tree
scope, so the Host renderer consumes them where it sits (inside the stack
item's provider) and pushes a cloneable `{canRead, canWrite}` over the
render transport (`updateContext`, generation-ordered like every
render-family request; re-pushed when the consumed value settles or
changes). Until the first snapshot arrives the child provides no
permissions — editors disabled, the same fail-closed default as the Host
before realm permissions settle.

**RP-9.2** All mutation funnels through `setField`: validate → write data
bucket → notify subscribers → invalidate instance tracking. `@set` and
direct `@model.x =` assignment are the same write
(`card-api.gts:4631-4667`).

**RP-9.3** Plural editing: `containsMany` mutates the watched array in
place (push/splice); `linksToMany` editors replace the whole array rebuilt
from raw values (RP-7.5). Choosers resolve picked ids through
`context.store.get` — never bypassing the store — and card/file choosers
are the ambient `globalThis._CARDSTACK_CARD_CHOOSER` / `_FILE_CHOOSER`
hooks, which throw when unset (RP-10.6).

**RP-9.4** Autosave is the default: any field mutation on a store-resident
instance queues a save; explicit save is the immediate variant of the same
queue. Saves per instance are serialized and coalesced; a non-writable
realm skips persistence (edits stay in memory); prerender contexts never
write (`store.ts:2362-2983`).

**RP-9.5** Serialization for save is a **complete document**, never a
sparse patch: computeds and query fields are excluded; unsaved link targets
serialize as `{data: {type, lid}}`; visited targets as
`{links: {self}, data}` without duplication; plural relationships as
indexed keys `field.0, field.1, ...`; authored-empty links round-trip as
`{self: null}` (`card-serialization.ts`; `card-api.gts:1352-1448,
2036-2049`).

**RP-9.6** Wire: `PATCH` to the card URL when `data.id` exists, else `POST`
to the realm — full document either way. Every write carries
`X-Boxel-Client-Request-Id`. There is **no revision/etag token**: conflict
handling is (a) echo suppression — an incoming index event whose
clientRequestId is ours with prefix `instance:`/`editor-with-instance` is
ignored; (b) per-instance write serialization; (c) otherwise last-write-wins,
where a foreign write's reload overwrites unsaved local edits without a
conflict surface (`store.ts:2074-2104, 2962-2983`).

**RP-9.7** Post-save, the server's attributes/relationships are discarded;
only id and realm meta merge back. A 404 on reload is a delete: consumers'
slots are rewritten to `link-not-found` sentinels
(`store.ts:3069-3090, 2323-2343`).

**RP-9.8** Cross-boundary mutation (Capsule/Sandbox) is main's `Box.set`
expressed as a capability: the Host grants a `set` closure per
non-computed field (through the field portal / renderer argument chain),
and an authored editor's set effect invokes that closure, which assigns
the canonical instance's field — entering RP-9.2's one `setField` funnel
(validate → write → notify → autosave) exactly as a trusted Base editor
does. Write authority is the presence of the granted closure, never a
record flag or a patch-document protocol; no tier receives a Store-write
shortcut. (The Sandbox tier's equivalent authority is RP-20.6's write
lane: an authored setter mutates the child's materialized copy and the
serialized proposal crosses back to the one entitled receiver, whose
apply enters the canonical instance parent-side — same funnel, expressed
over the boundary.)

**RP-9.9** The box contract is the Host's to declare, never the format's to
imply. Main renders a card directly into the Host's box with no wrapper, so
a card root styled `height: 100%` — which main's own
`.boxel-card-container` and isolated-format wrapper both are — resolves its
percentage against whatever box the Host established. Every tier here
inserts a slot element main does not have, so each slot must be layout
transparent: `height: 100%` on the in-document slots (Direct, Capsule),
which restores the chain against a definite Host box and computes back to
`auto` against an indefinite one, costing nothing where the Host flows its
content. The Sandbox cannot self-neutralize that way — its child's box IS
the iframe's viewport — so the Host's contract crosses as data on the
render op (`hostOwnsBox`), and BOTH sides derive the height mode from the
same `(format, hostOwnsBox)` pair through `surfaceHeightModeFor`. A
declared box allocates (the card fills it, the child stops measuring
itself); an undeclared one keeps the format's default, which is intrinsic
for everything but `fitted`, whose tile owner always allocates. The
declaration cannot be inferred from the format, because the same format
renders into a stack item's definite box in one place and code mode's
auto-height panel in another. Underlying law: a card that FILLS its box can
never also be the thing that MEASURES it — measure the container from the
content and the percentage has nothing definite to resolve against, so it
collapses to the content's own height.

## RP-10 The context plane and ambient contract

**RP-10.1** Context tokens are plain string constants in runtime-common
(`'card-context'`, `'card-crud-functions-context'`, `'permissions-context'`,
`'default-format-context'`, `'card-url-context'`, `'realm-url-context'`,
plus the three getCard\* tokens). Flow is strictly host chrome → down into
authored templates via the consumer components Base wraps around every
render.

**RP-10.2** `CardContext` members and exact degraded behavior when a
provider is absent (`DEFAULT_CARD_CONTEXT`, `field-component.gts:84-93`):

| member                                       | absent behavior                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `cardComponentModifier`                      | no-op modifier; render unaffected, host loses element tracking                              |
| `getCard` / `getCards` / `getCardCollection` | `() => {}` — returns `undefined`; author code reading `.card`/`.instances` **throws**       |
| `store`                                      | `undefined` (not defaulted) — the linksToMany chooser hard-requires it                      |
| `searchResultsComponent`                     | `undefined` — invoking it fails the render                                                  |
| `toolContext` / `commandContext`             | `undefined`; tool affordances dead (MissingTemplate's code-mode button non-null-asserts it) |
| `markdownEmbedChooser`                       | documented-absent in prerender; consumers must guard                                        |
| `mode` / `submode`                           | `undefined`                                                                                 |

**RP-10.3** `CardCrudFunctions` is `{createCard, viewCard, editCard,
saveCard, deleteCard}` with no default: absent provider ⇒ all component
args `undefined`; partial provision is legal (host mode provides `viewCard`
only). **A card must render statically with no CRUD functions available**
(the prerender contract).

**RP-10.4** Permissions: `{canRead, canWrite}` live getters; sole consumer
is the `@canEdit` predicate (RP-9.1).

**RP-10.5** Default formats: absent provider ⇒
`{cardDef:'isolated', fieldDef:'embedded'}`.

**RP-10.6** Ambient globals that are part of the contract and must be
provided (or explicitly denied with a diagnostic) in every tier that renders
authored code:
`globalThis.__card_api_shared_state` (the shared identity/tracking bucket —
two card-api copies that don't share it lose instance identity and
component stability); `_CARDSTACK_CARD_CHOOSER` / `_CARDSTACK_FILE_CHOOSER`
(throw when unset; required for link editing);
`__boxelScopedCSSRegistry` (RP-12.3); the turndown registration (markdown
fallback); `__boxelRenderContext` / `__boxelJobId` /
`__boxelPrerenderApp` (prerender gates, RP-13).

## RP-11 Presentation statics, chrome boundary

**RP-11.1** Author-declared, host-read statics: `displayName`,
`getDisplayName`, `icon`, `getIconComponent`, `headerColor`,
`prefersWideFormat`, `prefersFullSandbox` (routing input, RP-6.1),
`acceptTypes` (FileDefs), `[getMenuItems]`.

**RP-11.2** `cardInfo` is `contains(CardInfoField)` with fields `name`,
`summary`, `cardThumbnail`, `cardThumbnailURL`, `theme`, `notes` — **no
`guide` field on main**. The computed mirrors are `cardTitle` (falls back
to `Untitled {displayName}`), `cardDescription`, `cardThumbnailURL`,
`cardTheme`.

**RP-11.3** Theme: `cardTheme` drives `<CardContainer @isThemed @cssImports
@themeCss @themeScope>`; the scope id is a content hash (theme id + CSS), not
a per-process guid, so shared themes emit one stylesheet and prerendered
HTML stays stable (`field-component.gts:262-318`).

**RP-11.4** Responsibility boundary: the card owns everything strictly
inside `CardContainer`'s children. Base owns the container, its boundary
shadow, theme styles, format geometry (RP-2.10), and the
`data-boxel-card-*` attributes. Chrome owns header, buttons, loading
indicator, error presentation, overlays, breadcrumbs, format chooser. Error
and loading states are chrome's, not the card's and not the render entry's
(RP-1.5); prerender adds no chrome at all.

**RP-11.5** The host discovers card-internal DOM exclusively via the
injected `cardComponentModifier` applied to every rendered card container
(with `card`, `format`, `fieldType`, `fieldName`) — never by selector
convention beyond the emitted `data-boxel-*` attributes.

## RP-12 Scoped CSS

**RP-12.1** `<style scoped>` must be at template root; the transform
suffixes every selector with a deterministic content-hash attribute
(`md5(template)+md5(css)`), stamps that attribute on every element the
template itself emits (nested components only via `...attributes`), removes
the style node, and emits a side-effect import of a synthetic
`.glimmer-scoped.css` module. It is a page-global stylesheet with
attribute confinement, not a shadow root.

**RP-12.2** Realm-authored code compiles with `noGlobal: true`:
`:global()` is dropped with a warning. `:deep()` is the only sanctioned
escape into nested DOM. (Host/boxel-ui code may use `:global` — trusted
chrome only.)

**RP-12.3** Delivery: the scoped-CSS fetch middleware synthesizes a module
that appends `<style data-boxel-scoped-css>` to `document.head`
idempotently via `__boxelScopedCSSRegistry`, before the importing module
evaluates — styles are present before first paint. Search entries and
last-known-good HTML import their recorded stylesheet deps the same way.

**RP-12.4** Tier rule: in any tier sharing the Host document (Direct,
Capsule), an authored stylesheet must remain confined to its scope;
a stylesheet whose selectors escape its compiled scope is rejected, not
injected. The Sandbox child owns its own document and injects locally.

## RP-13 Prerender and indexed HTML

**RP-13.1** Materialized formats per prerender-html visit: `isolated`,
`head`, `atom`, `markdown`, plus `embedded` and `fitted` **per ancestor
type**; icons on index visits. No visit runs the union
(`card-prerender.gts:209-490`).

**RP-13.2** Prerender provides only the four data contexts (`mode:'host'`,
`submode:'host'`, `searchResultsComponent`) — **no CRUD, no permissions, no
default-formats, no CardURL** — and blocks `setTimeout`/`setInterval`
(recorded and appended to failure stacks; `scheduleNativeTimeout` is the
sanctioned escape). Persistence is blocked: **a card must not write during
render**.

**RP-13.3** Indexed HTML is inert: valid as an immediate non-interactive
placeholder, last-known-good display, and search-result rendering (selected
by format/renderType, hydrating to a live card on gesture). It is never
the live renderer and never re-mounted as one.

**RP-13.4** Error rows retain `lastKnownGoodHtml` (the last successful
isolated render) plus its scoped-CSS URLs.

## RP-14 Records and operations (the protocol module)

**RP-14.1** The protocol module is
`packages/runtime-common/boxel-execution-protocol.ts`: cloneable, versioned,
no Ember imports. Records (≈10): `CodeRef`; `BoxelDescription` (ref, kind,
ancestors, fields, formats, presentation statics); `FieldDescription`
(name, kind, field type ref, resolved configuration, computed?);
`InstanceProjection` (id, type ref, revision, cloneable model with linked
values as `{$boxel:{id,type}}` **references, never expanded graphs**);
`TemplateBundle` (validated wire templates + typed dependency union
`trusted-component | authored-component | trusted-helper | safe-modifier |
block`; unknown kind rejects the generation); `SafeEvent` (exported,
versioned); `ComponentUpdate` (`{generation, changed, effects}`); the
protocol-version/feature record.

**RP-14.2** Operations (`BoxelRuntime`, per tier): `loadBoxel`,
`describeBoxel`, `createFromSerialized`, `getFields`/`getField`,
`getRenderSlot(instance, format)`, `invokeAction`, `serializeCard`,
`dispose`. Nothing else — mutation is not an operation on this interface
(RP-9.8: it is a Host-granted `set` capability).

**RP-14.3** Version discipline: every record carries the protocol version;
**consumers check it** and fail closed to last-known-good with one
diagnostic. `requiredFeatures` is populated by producers and
rejected-when-unknown by consumers. Semantic and transport versions are
independent and both enforced.

**RP-14.4** Record parity: Direct, Capsule, and Sandbox produce
deep-equal `BoxelDescription`/`InstanceProjection` records for the same
input, modulo fields this spec explicitly declares tier-specific (currently:
none). The record-diff suite (RP-15.4) enforces this.

## RP-15 Tier obligations and conformance

**RP-15.1** Tier obligations:

| concern                 | Direct            | Capsule                                | Sandbox                                                                               |
| ----------------------- | ----------------- | -------------------------------------- | ------------------------------------------------------------------------------------- |
| module executes in      | Host loader       | SES compartment per principal          | iframe child loader                                                                   |
| semantics               | local             | compartment, via handles               | child, via MessageChannel                                                             |
| Glimmer + DOM           | Host              | Host (manager bridge + TemplateBundle) | child                                                                                 |
| trusted Base components | shared Host graph | Host portal by reference               | child-local Base                                                                      |
| trusted Base semantics  | local             | materialized Host-side, cross as data  | child-local Base                                                                      |
| context plane (RP-10)   | host-provided     | host-provided via bridge               | child-local, protocol-backed; absent members degrade exactly per RP-10.2, never worse |
| capabilities            | local dispatch    | trusted managers → SurfaceService      | protocol client → SurfaceService                                                      |
| failure                 | chrome presents   | last-known-good + diagnostic           | placeholder retained + post-render error signal                                       |

**RP-15.2** Capsule specifics: authored component state is retained across
argument updates (destroy only on definition change); a live iframe is
never created; authored code receives no browser globals; stylesheets obey
RP-12.4. The real Host Loader never crosses through `import.meta.loader`;
transpiled dynamic import receives the named
`CAPSULE_DYNAMIC_IMPORT_DENIED` refusal. Capsule currently runs on the Host
main thread: SES limits authority, not CPU time, and there is no preemptive
termination for an infinite loop. This is an explicit prototype limitation.

**RP-15.3** Sandbox specifics: origin-isolated, credentialless iframe; a
transferred private MessageChannel; **a live iframe is never re-parented**;
Host-brokered module fetches limited to the admitted graph; a post-render
error is reported to the parent (silence after `render()` resolves is a
protocol violation) as a `runtime-error` control message, which the parent
CONSUMES: it fails any in-flight render request and surfaces through the
mount-failure channel to the Host's error presentation — never a silently
blank iframe. Errors cross the boundary with their stack and depth-bounded
`cause` chain so the presentation shows the root cause, not the boundary
wrapper. The prerender placeholder is retained as last-known-good; layout
crosses via the `layout` capability, not hard-coded per format.

A hosted deployment is admitted only with an explicit distinct-origin
`BOXEL_SANDBOX_RUNTIME_URL`, browser support for credentialless iframes, and
restrictive response headers on the child route (CSP, `no-referrer`, and
`nosniff`). Local Vite serve/preview installs those headers; production edge
configuration must provide an equivalent policy before enabling Sandbox.

There is currently one explicit compatibility exception to static graph
admission: `https://bxl.boxel.site/bxl.ts`, Chris's BXL prototype, because
existing cards load that exact URL lazily with `import.meta.loader`. The
exception is exact-URL only. `boxel.site` is a user-publishing domain and is
not trusted; no sibling URL or origin-wide read authority follows from this
exception. The prototype executes inside the origin-isolated Sandbox; it is
not promoted into the Host-trusted Direct/Capsule module set. After the entry
response is admitted, only its literal ESM dependencies may extend the
process's exact module graph under the ordinary RP-15 rules.

Sandbox readiness is a sequence of externally observable protocol states,
not one boolean named `ready`:

| phase                       | owner                | evidence                                                | deadline and failure                                                     |
| --------------------------- | -------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------ |
| child document loaded       | browser              | iframe `load`                                           | 90s; discard the process                                                 |
| control transport ready     | child bootstrap      | private port transferred and bootstrap `ready` received | 15s after document load; discard the process                             |
| semantic RPC admitted       | child runtime server | `boxel-runtime-accepted(requestId, operation)`          | 10s peer-silence deadline; fail the request                              |
| semantic RPC completed      | child runtime        | matching success/failure response                       | cold `loadBoxel` / `createFromSerialized`: 90s; ordinary operations: 10s |
| first live render committed | child renderer       | generation-matched render response                      | render deadline; retain prerender/last-known-good on failure             |

Admission means only that the child owns the request. It is not success and
does not extend the deadline without bound. A late response is stale after its
request has timed out and is ignored. Before `createFromSerialized` is sent,
the Host must freeze the bounded canonical input projection, including
query-backed relationship membership. A Glimmer modifier that may mount after
materialization is not a valid readiness dependency. These rules deliberately
mirror a microservice request path: process health, transport health, admission,
application completion, and presentation readiness are separate signals with
separate owners.

Operationally, `bootstrapId` identifies one child process, `requestId`
identifies one semantic RPC, and `generation` identifies one render-family
revision. Logs and diagnostics must retain all identifiers available at their
layer plus `operation`, elapsed time, and terminal status, so a timeout can be
localized without inferring causality from timestamps. The Host does not retry
an admitted semantic operation in place: `createFromSerialized`, rendering,
and future mutation capabilities are not assumed idempotent. A failed process
is replaced only through the explicit reload/recovery path, while the mounted
surface retains prerender or last-known-good output. Superseded generations
are cancellation by obsolescence—their late replies are dropped and cannot
resurrect older state.

**RP-15.4** Conformance machinery: (a) the **equivalence oracle** — each
fixture rendered through main's legacy path and through the protocol's
Direct adapter must agree on visible behavior; (b) the **cross-tier
suite** — each fixture × applicable tier through `BoxelExecutionRenderer`
in a real DOM (Sandbox in a real iframe), asserting mounted tier, visible
output, interaction results, and boundary negatives; (c) the **record
diff** (RP-14.4).

**RP-15.5** CI enforces the statement↔test bijection (RP-0.3). A fixture
axis inventory (formats × field kinds × computed/config × links ×
broken/loading states × edit) is generated, not hand-picked.

## RP-16 Capabilities v1

**RP-16.1** Exactly five: `presentation` (header/container intent),
`layout` (intrinsic ↔ allocated size), `observe` (frozen size/visibility
records), `view-card` (navigation intent → `viewCard`), `patch` (RP-9.8).
All dispatch to the Host-owned `SurfaceService`; grants are per mounted
surface; released handles fail closed.

**RP-16.2** Everything else in the architecture doc's `surface*` catalog is
DEFERRED (RP-9 list). Each future capability enters as its own spec section

- version bump + three-tier conformance.

## RP-17 Deferred and excluded

**RP-17.1 DEFERRED** (targeted at a future protocol version, in rough
order): the RP-21 entitlement deliveries not yet built — declared query
fields (RP-7.6) evaluated parent-side and delivered through the existing
RP-20.5 push (never as a query capability in the child); mediated
`viewCard` for the Sandbox tier (a navigation REQUEST over the private
port, parent-validated, executed in parent-owned chrome); a
gesture-scoped, parent-confirmed CRUD lane; and the visible-refusal
chrome for an entitlement a surface cannot deliver (RP-21.3's ban on
silent unavailability becomes enforceable only once refusal presentation
exists); mutation beyond RP-9.8's v1 (write grants, edit sessions,
optimistic overlays, structured rejection); Capsule-tier HMR (DOM adoption
across component programs) and save/index acknowledgement arbitration —
Sandbox-tier source volatility is un-deferred as RP-18; the remaining
`surface*` capabilities (pointer, focus, style, transition, schedule,
clipboard, haptics, slot, playback, viewport, canvas); BXL authorization
projection; Guides; annotations/collaboration; Realm Script and async AI;
the `metadata` and `form` formats.

**RP-17.2 EXCLUDED** (denied by design; conformance tests assert denial):
unrestricted clipboard read; arbitrary navigator APIs; arbitrary DOM/CSS
mutation from Capsule code; unbounded timers/background work in prerender;
cross-realm search without an explicit grant; authored code executing
Direct; a generic DOM-request escape hatch; third-party browser packages
outside the Sandbox.

**RP-17.3** Known gaps carried from main (preserved until a versioned
change): the `head` cascade for contained FieldDefs (RP-2.9); the
`SignatureFor`/runtime argument divergence and unthreaded `deleteCard`
(RP-3.1); silent ignoring of unknown formats (RP-2.4); the bounded
clientRequestId set's echo-eviction edge (RP-9.6); `@model`/`@fields`
transiently `undefined` during render is a branch-added tolerance in the
default templates, not main behavior — the spec decision (guarantee
non-null vs. mandate guarding) is owed before NORMATIVE status; the fields
proxy's `ownKeys` trap (RP-1.2) appends declared field names to the
component class's own built-in keys without deduplication, so a field
named `name`, `length`, or `prototype` violates the JS proxy invariant
(`TypeError: trap returned duplicate entries`) on any enumeration —
`field-component.gts` needs a dedupe before NORMATIVE status.

## RP-18 Source volatility v1 (Sandbox tier)

Un-defers RP-17.1's "HMR/source volatility" for the Sandbox tier only.
Capsule-tier HMR (DOM adoption) and save/index acknowledgement arbitration
remain deferred (RP-17.1). The entry seam is
`BoxelExecutionSession.pushDraft(moduleIdentifier, source)`; the explicit
hard reload is `reloadSandbox()`.

**RP-18.1** Every render-family request on one Sandbox process (render,
clear, draft alike) carries one process-monotonic `generation`, which the
child echoes on the matching response. Parent draft/render state
transitions only on a matching echoed generation; a response from an older
generation is a no-op, never an error surface.

**RP-18.2** The child drops a request whose generation is not newer than
the latest it has observed, and abandons in-flight work the moment a newer
generation supersedes it — re-checking after every await, so a burst of
rapid edits never resurrects stale output. A dropped generation is
reported as dropped, not as a failure.

**RP-18.3** A `draft` control message carries only the edited module's
exact URL. The draft's source crosses through the module-read channel's
per-URL override, matched by exact URL only — never a pattern. Before each
draft render, the authority re-allows exactly the draft's own module graph
plus the document-declared modules; admission never widens beyond the
literal reachable graph.

**RP-18.4** A draft invalidates only the edited module in the child's
loader and re-derives the card from the same document object: instance
data state survives the generation; only module and component identity
change.

**RP-18.5** A failed generation — compile-time or render-time — leaves the
previous successful render mounted (last-known-good) with the failure
carried alongside as state; the next successful generation recovers
without a remount.

**RP-18.6** No draft generation ever changes iframe identity (RP-15.3).
Only the explicit hard reload remints the process — new bootstrap
identity, draft overrides cleared, module authority reset, and any
placeholder keyed on the old identity invalidated.

**RP-18.7** An ordinary draft never re-enters the placeholder: the live
render (or its last-known-good) remains the visible content across
generations.

## RP-19 Volatile execution v1 (promotion)

Un-defers the volatile-promotion half of
[boxel-volatile-execution-plan.md](boxel-volatile-execution-plan.md):
which cards get RP-18's source volatility, and what the rest of the
workspace is guaranteed while they have it. The entry seam is
`BoxelExecutionService.promoteToVolatile(moduleIdentifier)`.

**RP-19.1** Promotion is one-way for the session: a promoted module stays
volatile until the tab closes — no demotion, no lease, no quiet-period
expiry. Promoting an already-volatile module is a no-op. A trusted Host
module never promotes: the call is inert for a trusted module identifier.

**RP-19.2** Volatility is a routing input that can only strengthen
isolation. In v1 a volatile module routes to the Sandbox tier regardless
of its classification; volatility never selects a weaker runtime than
classification or Host trust policy selected, and never grants Direct.

**RP-19.3** Promoting a mounted card's module re-routes that card live,
through the ordinary generation-replace path: the superseded generation
disposes normally, the new lease mounts through the same slot machinery
as any first render (RP-15.3, RP-18.6), and only consumers of that
module's own volatility re-evaluate — an unrelated mounted card observes
nothing.

**RP-19.4** A volatile session's drafts never mutate the stable module
graph: the host loader's cached module identity for the drafted URL is
untouched, and a stable consumer of the same module receives zero
notifications during another session's draft cycle. Drafts are visible
only inside the volatile session's own render until an ordinary commit
(save → realm invalidation) updates stable consumers once.

## RP-20 Rehydration continuity v1

What a mounted card is guaranteed across an ordinary data update (an
auto-save echo, a store instance re-set, a relationship settling): the
user perceives a live document being edited, never a page reloading. The
observable bar is: no flash, no scroll reset, no image loss, no lost
in-card state. These statements exist because every one of them was
violated in practice by a single root cause — the renderer's resource
accidentally tracking the instance's own fields, so every save re-booted
the session.

**RP-20.1** A data-only instance update never re-instantiates the render
session or its presentation slot. The renderer resource's tracked
dependency set is exactly three reads: the card's identity (the argument
reference), the requested format, and the module's volatility cell — an
instance's own tracked fields are never among them (the async
materialization pipeline is explicitly untracked). Observable: across an
update, the slot element and its rendered content keep DOM identity, and
the loading/placeholder branch is never re-entered.

**RP-20.2** Data updates reach the mounted component the way main does
it: `@model` is a LIVE read-through projection of the canonical instance
(`createLiveBoxelModel`) — property reads are autotracked (via
`peekAtField`), return only cloneable projected values, and re-render
each binding in place on mutation. There is no delivery pipeline to
build or order: the framework's render pass is the pipeline. Two
structural invariants bound it. **One writer:** a model read may never
mutate an instance, trigger a relationship lazy-load, or dirty anything
— relationships are observed via `getRelationshipMembershipState` only;
a subtree still pending at read time answers with the materialize-time
fallback value (never regressing to absent), and loading remains
materialize's and settlement's job. **No parallel channel:** the
session's subscription carries only what genuinely changes what is
mounted — status, and generation replacement for format/routing changes,
relationship settlement (RP-7.3), source drafts (RP-18), and promotion
(RP-19.3).

**RP-20.3** Because the DOM survives (RP-20.1), user view state anchored
to it survives too: scroll positions inside the card, focus, and
uncommitted in-card component state are retained across a data update.
KNOWN LIMIT (shared with main): an applied serialized update
(`updateFromSerialized` — an RP-20.5 push, or main's own SSE reload)
replaces nested compound field instances, so `{{each}}` blocks keyed on
them remount and THEIR component-local state does not survive that
specific apply. Scalar bindings and the card's own component are
unaffected. This is why RP-20.6's fan-out deliberately skips the
writer's own view — the writer must never pay that remount for its own
edit, exactly as on main.

**RP-20.4** Declarative media never blanks on rehydration. The Sandbox
media bridge accepts only exact URLs in the parent-projected resource set,
rejects non-success and non-image responses before reading their body, and
caches one authorized blob per resolved source URL for the
bridge's lifetime: a re-created `<img>` with an already-hydrated source
swaps in synchronously with no second fetch; concurrent requests for the
same source share one fetch. Cache entries are revoked only at bridge
teardown. A denial leaves the child source removed; it never restores an
arbitrary authored URL as an ambient image egress path.

**RP-20.5** Cross-surface synchronization is a core Boxel guarantee no
execution tier may break: every mounted view of one canonical instance —
any format, any surface, any tier — observes a data mutation from any
same-client source, with component stability throughout (the acceptance
bar: a sentence typed into a text field lands intact — same element, same
focus — while every other view of the card updates live). Per tier:
Direct reads the live instance (Glimmer tracking); Capsule reads the
live model projection (RP-20.2 — the same autotracking, expressed
through the projection boundary); a mounted Sandbox child receives
parent-side mutations as `updateInstance` pushes over the render
transport — the canonical instance's freshly serialized current state,
applied to the child's already-materialized copy IN PLACE
(`updateFromSerialized`, main's reload path) so the child's own tracking
re-renders without remounting, with the render family's monotonic
generation sequence as the revision guard (a push superseded in flight
is dropped, never applied out of order; pushes coalesce per mutation
batch). Because every push carries full current state, a settled
relationship reaches the child through the same lane — there is no
separate settle-republish channel for any tier. The reverse leg is
RP-20.6.

**RP-20.6** The Sandbox write leg — RP-20.5's reverse polarity. An
authored mutation inside a mounted Sandbox child (a setter on `@model`,
exactly main's in-place edit idiom) crosses back to the parent as a full
save-shaped serialized document over a dedicated write lane on the same
private port (`SandboxWriteClient`/`SandboxWriteServer`, mirroring the
render transport's envelope validation, serial dispatch, bounded ack
timeout, and monotonic-sequence stale-drop). The child's trigger is
card-api's own `subscribeToChanges` on the rendered instance — the exact
signal main's store autosave consumes — coalesced per mutation batch
like the RP-20.5 push loop. Authority is entirely parent-side: the one
registered receiver (`connectSandboxInstanceSync`) validates the
document's identity against the ONE canonical instance the process
renders (a write for any other card is refused before anything
applies), constrains relationship targets to the current declared
projection, replaces incoming `included` resources with the parent's
canonical projection (declared related data is read-only), applies the root
in place (`updateFromSerialized`), and persists
through the store's own debounced autosave lane (`scheduleSave`) — the
realm write, permissions, and post-save arbitration never move into the
child. An applied write fans out to every OTHER connected view of the
card as an ordinary RP-20.5 push; the writer's own connection is
deliberately skipped — its child already holds exactly the state it
wrote, and an echo push would replace nested compound field instances
and remount their DOM (destroying an open in-place editor) for zero
data change. Loop termination is structural, not flag-based:
`updateFromSerialized` writes the data bucket without firing change
subscribers, so an applied push (child side) can never re-trigger the
write subscription and an applied write (parent side) can never
re-trigger the push subscription — each direction's apply is silent to
the other's trigger. Writes are proposals of complete current
state, so a missed or dropped one self-heals on the next; Boxel is not
a validate-on-write system (validation is post-save, the guide system),
so an apply is expected to succeed and the error response lane exists
for transport faults and identity violations, not a validation UX.

## RP-21 Entitlement v1 (orthogonal to containment)

Containment tiers (RP-6) answer HOW a module's rendering is contained —
how much browser authority its execution needs and how it is caged. They
never answer what a card is entitled to KNOW or DO. Keying data or action
authority off the tier would invert the security model: an author could
write deliberately DOM-free code precisely to classify Capsule and
thereby GAIN authority. This section is the axis split.

**RP-21.1** Entitlement is a function of module provenance and card
declaration, never of containment tier. Capsule and Sandbox hold the
same trust grade — untrusted authored code — and receive IDENTICAL
entitlements; only delivery mechanics differ (in-tree scope and host-side
portals for Capsule; pushed snapshots and mediated port lanes for
Sandbox). Trusted-realm provenance is what grants ambient authority
today (the Direct tier's modules); a future per-module grant system (the
guide/trust-badge direction) extends grants without touching containment.
Concretely: no store, loader, service, or data-bearing context authority
ever rides a boundary crossing — the Capsule `@context` projection
carries exactly its enumerated presentation keys, and the Sandbox
context push carries exactly its enumerated cloneable snapshots.

**RP-21.2** Entitlement grades, from least to most: **declared** — the
card's own document, its declared `linksTo`/`linksToMany` neighborhood,
and its type's declared query fields (RP-7.6), always delivered as
host/parent-evaluated DATA (materialized results, like `@model`), never
as a query capability; every authored card holds this grade.
**display-only** — a host-rendered presentation surface whose CONTENT the
authored code cannot read back and cannot exfiltrate (no DOM read in SES,
no egress in either cage): today, the Capsule's `searchResultsComponent`
projection key — query influence without data return, the one deliberate
asymmetry, named here so it stays a decision rather than an accident.
**mediated action** — a user-visible request the parent validates and
executes in parent-owned chrome (`viewCard` navigation; the future CRUD
lane); the authored code proposes, the Host disposes. **ambient** — search
and arbitrary data reach; held ONLY by trusted provenance, never
grantable by classification, format, or authored code's own request.

**RP-21.3** Silent unavailability is prohibited: an entitlement a
surface cannot deliver refuses visibly (the fetch gate's self-naming
refusals are the model), never renders as plausible-but-empty output —
an empty list that means "not entitled" must be distinguishable from an
empty list that means "no data." (Refusal chrome is deferred — RP-17.1;
until it lands this statement binds designs, not pixels.)

### Capability matrix (informative)

The full capability surface per tier, each row carrying its RP-21.2
entitlement grade and the normative statement that owns it. Delivery
mechanics differ per tier; the ENTITLEMENT column is identical for
Capsule and Sandbox by RP-21.1 — any future row where those two columns
would diverge in _what_ (not _how_) is a spec bug. Status: ✅ built,
🔜 deferred (RP-17.1), ⛔ excluded by design (RP-17.2).

| Capability                                                | Grade                          | Direct (trusted realm)      | Capsule                                                                                               | Sandbox                                                                                                                        | Owner                     |
| --------------------------------------------------------- | ------------------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| Own `@model` read                                         | declared                       | live instance               | live read-through projection ✅                                                                       | serialized copy, parent-pushed per mutation batch ✅                                                                           | RP-20.2 / RP-20.5         |
| Own instance write                                        | declared                       | native setters → `setField` | `@set` closures → same funnel ✅                                                                      | full-document write proposals over the write lane ✅                                                                           | RP-9.2 / RP-9.8 / RP-20.6 |
| Writability signal (`@canEdit`)                           | declared                       | in-tree permissions context | in-tree permissions context ✅                                                                        | pushed `{canRead, canWrite}` snapshot ✅                                                                                       | RP-9.1                    |
| Cloneable contexts (card-url, realm-url, default formats) | declared                       | in-tree                     | in-tree / facade re-pluck ✅                                                                          | default formats crossed at render ✅; card-url/realm-url ride `updateContext` when needed 🔜                                   | RP-10 / RP-1.5            |
| Declared `linksTo`/`linksToMany` data                     | declared                       | native lazy-load            | host-side Base field portals ✅                                                                       | `withIncluded` serialization in every push ✅; lazy-load of a not-yet-included link resolves parent-side into the next push 🔜 | RP-7 / RP-20.5            |
| Declared query fields (`options.query`, RP-7.6)           | declared                       | native                      | host-evaluated ✅                                                                                     | parent-evaluated, results delivered as data through the push lane 🔜                                                           | RP-7.6 / RP-17.1          |
| Theme (scope token, CSS, imports)                         | declared                       | native                      | host-derived cloneable strings ✅                                                                     | same cloneable strings in the render record ✅                                                                                 | RP-5.4                    |
| Media (authored `<img>` under realm auth)                 | declared                       | native                      | native (shared document) ✅                                                                           | exact projected-resource lane; successful images only; blob-cached ✅                                                          | RP-20.4                   |
| Browser events into authored handlers                     | declared                       | native events               | reduced `SafeEvent` projection ✅                                                                     | native events (child owns its DOM) ✅                                                                                          | RP-14.1                   |
| Surface capabilities (height, presentation)               | declared                       | host-native                 | `SurfaceService` attach ✅                                                                            | `surface*` request/response over the port ✅                                                                                   | RP-16                     |
| Source drafts / HMR                                       | declared                       | host loader invalidation    | deferred 🔜                                                                                           | draft override + invalidate-rerender ✅                                                                                        | RP-18                     |
| Runtime error reporting                                   | declared                       | native                      | boundary rejection → error presentation ✅                                                            | `runtime-error` control lane → same presentation ✅                                                                            | RP-15.3                   |
| Search _display_ surface (host-rendered results)          | display-only                   | yes                         | `searchResultsComponent` projection key — query influence, no read-back (no DOM in SES), no egress ✅ | cannot cross an iframe; visible refusal 🔜                                                                                     | RP-21.2 / RP-11.5         |
| Overlay/adorn discovery                                   | display-only                   | native tracker              | `cardComponentModifier` projection key ✅                                                             | parent-side slot registration (element never crosses) ✅                                                                       | RP-11.5                   |
| `viewCard` navigation                                     | mediated action                | host closure                | host closure crosses as arg ✅                                                                        | navigation REQUEST over the port, parent validates + navigates 🔜                                                              | RP-21.2 / RP-17.1         |
| CRUD (create/delete/save beyond own instance)             | mediated action                | host actions                | not exposed; gesture-scoped parent-confirmed lane 🔜                                                  | same lane, same rules 🔜                                                                                                       | RP-17.1                   |
| Ambient search → data into authored code                  | ambient                        | yes (trusted provenance)    | **never** ⛔                                                                                          | **never** ⛔                                                                                                                   | RP-21.2 / RP-17.2         |
| Arbitrary network egress                                  | ambient                        | yes                         | none (SES scope has no fetch) ⛔                                                                      | none (every fetch dies at the gated port) ⛔                                                                                   | RP-15 / RP-17.2           |
| Module loading                                            | declared                       | host loader                 | exact classified graph ✅                                                                             | exact classified graph via gated port, pre-authorization refusal ✅                                                            | RP-6.4 / RP-15            |
| DOM/document authority                                    | (containment, not entitlement) | full                        | none — reified templates, `on` only                                                                   | full, inside own origin-isolated document                                                                                      | RP-6.1 / RP-14            |

The last row is the reminder of the axis split: DOM authority is what the
containment tiers exist to answer, and it is the ONE row where Capsule
and Sandbox legitimately differ.
