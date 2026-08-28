# Realm sandbox card API compatibility ledger

## Canonical document contract

This is the canonical inventory of every sandbox-related API, shim, and
authoring alternative that affects card authors. Reviewers should treat a
sandbox change as incomplete until this ledger answers all four questions:

1. Does an existing realm card have to change its imports or source?
2. Is the behavior a net-new opt-in API, a Host-owned compatibility shim, or
   an ordinary authoring convention?
3. Which trusted side owns and validates the capability?
4. Which focused test proves the boundary and the unchanged-card behavior?

Internal protocol fields may be documented here for reviewability, but they
must not become imports available to realm source. New card-facing APIs are a
last resort: the preferred order is preserve an existing API with a confined
Host shim, select a stronger sandbox automatically, and only then introduce a
new opt-in capability.

The companion
[execution runtime coverage audit](boxel-execution-runtime-coverage-audit.md)
maps this author-facing ledger onto the cards, tests, execution owners, nested
render graphs, and UX gates that a replacement architecture must preserve.

Current branch checkpoint (2026-08-04):

- **Required new APIs for existing card source:** none.
- **Net-new opt-in card-author APIs:** `safeModifier`,
  `surfacePresentation`, and literal `static prefersFullSandbox = true`.
- **New optional authoring convention:** isolate browser-dependent renderers
  in a module referenced only by `isolated`, `embedded`, or `edit` static
  format slots.
- **Everything else in this document:** a Host/Base compatibility shim or an
  internal boundary protocol, not a realm-card capability.

## Compatibility rule

Read/write authority is part of this rule. If a realm is writable, its edit
templates, writable fields, linked-card mutations, and commands must retain
write behavior through explicit Host capabilities. Rendering those values
read-only is a bug, not a safe fallback. Conversely, read-only realms must not
gain write authority through a shim, iframe message, URL, or Surface API.

The expected matrix is deliberately boring:

| Realm authority | Native/trusted                          | SES                                                        | Iframe                                                                                |
| --------------- | --------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Writable        | Reads and persists writes               | Reads and persists the same writes through Host validation | Reads and persists the same writes through a data-only MessageChannel capability      |
| Read-only       | Reads; write UI is disabled or rejected | Reads; Host rejects every mutation                         | Reads; `canWrite: false` is explicit and the Host rejects every forged update message |

`canWrite` is derived from the Host's realm permission state. It is not inferred
from sandbox tier, card source, URL parameters, or whether the child can render
an edit control. The child receives only the boolean needed for presentation;
the Host rechecks permission, card identity, and canonical Store ownership for
every mutation. Therefore a field that is writable in native rendering but
read-only in SES or an iframe is a product bug, while a child that can forge a
write into a read-only realm is a security bug.

## Vocabulary: API versus tunnel

This document uses four labels deliberately:

- **Existing authored API**: source that cards can already write on `main` and
  staging. Sandboxing must preserve it without a migration.
- **New opt-in authored API**: a new import or declaration introduced by this
  branch. It may reduce the authority a new card needs, but it cannot be the
  compatibility requirement for an existing card.
- **Compatibility shim**: a Host-owned implementation of an existing authored
  API. The card keeps its original source.
- **Internal tunnel**: an inert value or bounded request sent between the Host,
  a Capsule, or an iframe Sandbox. It is not importable by a card and is never
  serialized into card data.

The word _tunnel_ does not imply authority. Each tunnel below names its
direction, payload, validation, and lifetime. A value that cannot meet those
constraints must remain on its owning side of the boundary.

## Complete authored presentation and format ledger

These values existed before sandboxing. They are listed individually because
the non-sandboxed Host used to read them directly from the executable class;
the sandboxed Host must now obtain the same result without retaining that
constructor.

| Authored value                                        | Status                   | Scope and semantics                                                                                                                                                                                                               | Capsule tunnel                                                                                                                                                 | Iframe Sandbox tunnel                                                                                                                                           | Validation or known gap                                                                                                                                                                 |
| ----------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `static displayName`                                  | Existing authored API    | Type-level human name used by inspectors, card headers, schema UI, and fallback titles. It is not the instance title.                                                                                                             | Captured as `SandboxCardTypeMetadata.displayName`; copied onto the Host-owned opaque type and its inert `@model.constructor` descriptor.                       | Initial Host metadata is available before startup; the child may refresh it in `ready.typePresentation.displayName`.                                            | Capsule capture truncates to 256 characters; iframe update to 1,024. Empty iframe values retain the Host value. These limits should eventually converge.                                |
| `static icon`                                         | Existing authored API    | Type-level icon component for headers, inspectors, and type affordances.                                                                                                                                                          | Only an icon whose value resolves to an approved trusted export identity crosses metadata; the Host resolves that identity with its trusted loader.            | Uses the parent metadata path. The iframe child does **not** send component code or a late icon replacement.                                                    | Arbitrary authored component objects cannot cross. Unsupported icons fall back to the trusted CardDef, FieldDef, or FileDef icon.                                                       |
| `static headerColor`                                  | Existing authored API    | Type-level background color for the trusted Boxel card title bar. It does not color the authored card body or iframe container.                                                                                                   | Captured as type metadata and copied to opaque presentation state.                                                                                             | Refreshed in `ready.typePresentation.headerColor`.                                                                                                              | Maximum 128 characters; values containing declaration delimiters or `url(...)` are rejected. **There is no `headColor` API.** `head` is a format; `headerColor` is the title-bar color. |
| `static prefersWideFormat`                            | Existing authored API    | Boolean layout hint: an isolated card prefers the wide stack presentation. It is not a width value, does not grant fullscreen, and does not choose a sandbox.                                                                     | Captured as type metadata and exposed on the opaque type/presentation record.                                                                                  | Refreshed in `ready.typePresentation.prefersWideFormat`.                                                                                                        | Strict boolean: only value `true` enables it. The Host remains responsible for available layout.                                                                                        |
| `static isolated`                                     | Existing authored API    | Full card view. Defaults to the trusted Base card template when unauthored.                                                                                                                                                       | Captured as an authored format slot and rendered in Capsule when its module graph is eligible.                                                                 | May render in an iframe when the selected format graph needs browser authority. Default iframe height ownership is intrinsic.                                   | A missing slot must use trusted Base, not a blank sandbox.                                                                                                                              |
| `static embedded`                                     | Existing authored API    | Inline/composed card view, including delegated linked-card rendering and rich content.                                                                                                                                            | Same captured-slot path; nested fields/cards re-enter the owning boundary.                                                                                     | Eligible for an iframe when required; default height ownership is intrinsic.                                                                                    | Inline iframe proliferation is avoided for compact composition; exact indexed HTML may be used as an inert startup handoff.                                                             |
| `static fitted`                                       | Existing authored API    | Renderer placed into a Host-allocated tile/strip/card rectangle.                                                                                                                                                                  | Captured and rendered in Capsule when eligible.                                                                                                                | An iframe is allocated the Host viewport; child resize reports are ignored.                                                                                     | Default iframe height mode is `allocated`; internal overflow belongs to authored CSS.                                                                                                   |
| `static edit`                                         | Existing authored API    | Interactive edit renderer. Missing custom edit uses trusted Base edit UI.                                                                                                                                                         | `@set` is a bounded effect and the Host rechecks write permission before saving canonical Store data.                                                          | The child serializes a plain root document; the Host rechecks identity and permission, persists it, and acknowledges the revision. Default height is intrinsic. | Writable native behavior becoming read-only is a product bug. A forged write in a read-only realm is rejected.                                                                          |
| `static atom`                                         | Existing authored API    | Small textual/visual identity used in pills and dense composition.                                                                                                                                                                | Captured and rendered in Capsule when safe.                                                                                                                    | The architectural default is not to create an iframe pill; prefer a safe format or inert indexed markup. Protocol height would otherwise be intrinsic.          | A browser-dependent module should separate its compact renderer into an SES-safe file.                                                                                                  |
| `static head`                                         | Existing authored API    | Head/summary rendering used by supported file/card presentation paths. It is unrelated to `headerColor`.                                                                                                                          | Captured as a format slot.                                                                                                                                     | Compact head rendering should not create an iframe farm; use safe code or indexed markup.                                                                       | `head` is in the format contract, but not every definition kind or UI surface requests it.                                                                                              |
| `static markdown`                                     | Existing authored API    | Markdown renderer or trusted Base HTML-to-Markdown fallback.                                                                                                                                                                      | Captured as a format slot; linked-card `getComponent()` calls use the Host synthetic-format compatibility shim.                                                | Markdown composition should remain safe/inert rather than embedding live iframes.                                                                               | Trusted Rich Markdown UI is a Host/Base portal; Mermaid/CodeMirror are not handed to realm code.                                                                                        |
| `hasCustomEditTemplate` / `hasCustomIsolatedTemplate` | Existing **derived** API | Base getters compare a type's slot with the Base default; Host menus use the result for “Toggle Standard View.” Authors normally set the format slot rather than these flags.                                                     | Exported as inert metadata and reproduced on the opaque type.                                                                                                  | Parent metadata supplies the initial result.                                                                                                                    | Do not infer these from whether an iframe successfully starts.                                                                                                                          |
| `authoredTemplateFormats`                             | Internal derived value   | Complete list of authored `isolated`, `embedded`, `fitted`, `atom`, `edit`, `head`, and `markdown` slots. It lets the Host distinguish “delegate to sandbox” from “use trusted Base fallback.”                                    | Produced by compartment type introspection.                                                                                                                    | Used by the parent before choosing/starting the child.                                                                                                          | Not an authored CardDef API and must not be serialized.                                                                                                                                 |
| `static prefersFullSandbox = true`                    | New opt-in authored API  | One-way request for the strongest available renderer boundary. It forces iframe-capable authored formats (`isolated`, `embedded`, and `edit`) into an origin-isolated Sandbox, but can never select Direct or weaken Host policy. | Captured as strict per-CardDef metadata. Dense formats that intentionally cannot compose as iframes remain in their confined Capsule or trusted Base fallback. | The Host routes eligible authored formats to the iframe even when source analysis would otherwise allow Capsule.                                                | Only literal/inherited value `true` enables it. It belongs to the rendered CardDef, does not propagate merely through imports, and URL state cannot override it.                        |

`Format` also contains internal/specialized values such as `metadata` and
`form`, but the authored static slot inventory currently captured by the
sandbox is the seven-format list above. Adding a format requires updating the
Base format contract, metadata capture, Host fallback selection, iframe
presentation protocol, prerender rules, and tests together.

For reference, the existing type-level presentation API looks like this:

```gts
export class ExampleCard extends CardDef {
  static displayName = 'Example Card';
  static icon = ExampleIcon;
  static headerColor = '#101828';
  static prefersWideFormat = true;
  static prefersFullSandbox = true;

  static isolated = ExampleIsolated;
  static embedded = ExampleEmbedded;
  static fitted = ExampleFitted;
  static edit = ExampleEdit;
  static atom = ExampleAtom;
  static head = ExampleHead;
  static markdown = ExampleMarkdown;
}
```

These values describe type presentation and format renderers. None grants
authority, chooses Direct/Capsule/Sandbox execution, or exposes Host objects.

### Existing author hooks that are not presentation metadata

These hooks are easy to miss because they are not static format slots. Their
status is explicit here so a future compatibility fix cannot silently turn an
executable hook into “just data.”

| Existing hook                                                     | Native semantics                                                                                                                                           | Sandboxed status                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[getMenuItems](params)`                                          | Instance hook returning menu descriptors whose actions may use `canEdit`, CRUD functions, tool context, format, menu context, and standard-template state. | The Host-owned opaque CardDef currently inherits trusted Base default menu items; Host may append diagnostic items such as `Execution: Capsule`. An authored realm override is **not executed in the Host and is not yet tunneled**. Preserving custom realm menus needs a data-only menu-descriptor plus named-effect design; callbacks and ToolContext must not cross directly. |
| `FieldDef.static configuration` and per-field-use `configuration` | Supplies presentation/edit configuration, optionally as a function of the parent instance.                                                                 | Trusted Base FieldDefs retain it. `SandboxCardTypeMetadata` currently records field kind/type/display name but not arbitrary authored configuration providers. Plain resolved configuration may cross as a template argument; executable provider parity is a documented gap requiring compartment evaluation plus data validation.                                               |
| `FileDef.extractAttributes()`                                     | Server/indexer hook that converts file bytes into serialized FileDef attributes.                                                                           | It is not a card-render tunnel. It remains a Realm Server/indexing concern and must not be invoked in the browser Host merely to render a sandboxed FileDef.                                                                                                                                                                                                                      |
| File-type presentation such as `acceptTypes`                      | Static hint used by trusted file/image UI.                                                                                                                 | Trusted Base definitions retain it. A user-authored override is not currently part of `SandboxCardTypeMetadata`; add a bounded static metadata field only when a concrete Host consumer and compatibility test require it.                                                                                                                                                        |
| `computeVia`, prototype getters, and component action methods     | Executable card behavior evaluated with the instance.                                                                                                      | Runs inside Capsule or iframe local runtime. Only computed/action results and the two named Capsule effects cross; functions and prototypes do not.                                                                                                                                                                                                                               |

The rule for extending this table is: if native Host code reads a realm
constructor, instance method, symbol hook, or framework object, the sandboxed
path must either reproduce its inert result explicitly or record the behavior
as a compatibility gap. Direct reflection across the boundary is not an
acceptable fallback.

## Complete cardInfo, theme, and instance-presentation ledger

`cardInfo` is an existing contained Base field, not a set of extra top-level
files or a new sandbox schema. Its standard shape is:

```ts
CardInfoField {
  name: StringField;
  summary: StringField;
  cardThumbnail: linksTo(ImageDef);
  cardThumbnailURL: MaybeBase64Field;
  theme: linksTo(Theme);
  notes: MarkdownField;
}
```

| Value                                                           | Existing semantics                                                                                        | Boundary behavior                                                                                                                                                                                                                                     |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cardInfo.name`                                                 | Instance title input. Base `cardTitle` returns the trimmed name or `Untitled ${constructor.displayName}`. | Remains JSON in the stable opaque snapshot. The Host recreates the same fallback getter without evaluating the authored constructor, so headers can title before an iframe is ready and react to edits.                                               |
| `cardInfo.summary`                                              | Instance summary/description input. Base `cardDescription` delegates to it.                               | Data projection only; it crosses with the card snapshot/document and is updated through the ordinary write path.                                                                                                                                      |
| `cardInfo.cardThumbnail`                                        | Link to an `ImageDef`.                                                                                    | Relationship identity crosses as data; trusted relationship hydration or delegated rendering resolves it. It does not give the sandbox arbitrary media fetch authority.                                                                               |
| `cardInfo.cardThumbnailURL`                                     | Inline/remote thumbnail URL value; Base `cardThumbnailURL` delegates to it.                               | Data projection only. Actual media loading in an iframe uses the bounded media-fetch broker and Host URL policy.                                                                                                                                      |
| `cardInfo.theme` / computed `cardTheme`                         | Link to a Theme card whose `cssVariables` style the CardContainer.                                        | The Host resolves the linked Theme with authenticated realm access, validates/confines its CSS, creates an opaque `{ id, css, scope }` presentation, and injects it at the trusted container. The Theme object, credentials, and loader do not cross. |
| `cardInfo.notes`                                                | Markdown notes rendered/edited by trusted Base Markdown field components.                                 | The value is ordinary data. CodeMirror, KaTeX, and Mermaid load only through the private trusted-UI portal described below.                                                                                                                           |
| `cardTitle`, `cardDescription`, `cardTheme`, `cardThumbnailURL` | Existing Base computed aliases derived from cardInfo.                                                     | Capsule projection computes pure values in the compartment. For iframe-only/root startup, the Host uses serialized/indexed values and the explicit title fallback rather than opening an iframe merely to introspect them.                            |

Theme `cssVariables` and authored `<style scoped>` content are two different
channels. Theme CSS belongs to Host presentation and follows the linked Theme.
Authored scoped CSS is extracted with the selected component, validated,
namespaced, ref-counted, and mounted with the rendered island. Neither channel
may contain a network-bearing value or escape its compiled selector/keyframe
scope. CSS confinement remains a merge gate, not a reason to add a new card
API.

## Complete template argument and context ledger

| Existing template input                                                            | Capsule semantics                                                                                                                                                                                        | Iframe Sandbox semantics                                                                                                                                                                                      | Authority rule                                                                                                                                                   |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@model`                                                                           | Stable JSON-shaped projection. Computed getters are materialized in the compartment; Host/framework prototypes are removed. A non-enumerable inert `constructor` exposes only display name/icon helpers. | The child deserializes the supplied canonical card document with its detached loader.                                                                                                                         | No Store, card loader, Host constructor, DOM object, or credential crosses with the model.                                                                       |
| `@cardOrField`                                                                     | Inert type/presentation identity sufficient for template behavior; never the executable Host opaque constructor.                                                                                         | Child-local definition loaded inside the iframe.                                                                                                                                                              | Must not become a way to call Host static methods.                                                                                                               |
| `@fields`                                                                          | Host-owned contextual FieldDef components. Invoking one delegates rendering back through the correct card/field boundary.                                                                                | Normal child-local components for the complete field tree: trusted Base editors and authored FieldDef editors remain in the root surface's one iframe; root edits return through the document-update channel. | Field lookup is explicit and may include inherited `cardInfo`; it must not expose unrelated parent-card state. Field cardinality must not increase iframe count. |
| `@format`                                                                          | Plain format string for the current render.                                                                                                                                                              | Sent in `presentation.format`; the persistent child can switch presentation without replacing the iframe.                                                                                                     | A format does not select its own trust tier.                                                                                                                     |
| `@fieldName`, field type/configuration                                             | Bounded identity/configuration required for contextual FieldDef rendering.                                                                                                                               | `presentation.fieldName` tells the child which field to resolve.                                                                                                                                              | Field identity is checked against the selected card schema.                                                                                                      |
| `@canEdit`                                                                         | Derived from Host permissions for presentation.                                                                                                                                                          | Derived from the Host-sent `canWrite` permission.                                                                                                                                                             | Informational UI input; every mutation is independently authorized.                                                                                              |
| `@set(value)`                                                                      | Reified as a `set` effect carrying JSON-shaped data; Host applies it through the canonical opaque card/Store path.                                                                                       | Root child edits produce a serialized card-document update rather than exposing Store.                                                                                                                        | Cyclic/non-data values are rejected; read-only writes fail at the Host.                                                                                          |
| `@viewCard(target, format, options)`                                               | Reified as a navigation effect. Target is normalized and confined to the owning principal/realm path before Host navigation.                                                                             | No broad Host router is exposed; any equivalent bridge must remain bounded to validated card identity and options.                                                                                            | Navigation authority is narrower than arbitrary URL/open/window authority.                                                                                       |
| `@createCard`, `@editCard`, `@saveCard`                                            | Supplied only to trusted Base fallback templates. They are not cloned into user Capsule code.                                                                                                            | Not projected as arbitrary functions into authored iframe code.                                                                                                                                               | Existing edit UI is preserved through trusted Base portals and explicit document updates, not raw CRUD authority.                                                |
| `@context.mode`, `@context.submode`                                                | JSON-shaped runtime hints may cross.                                                                                                                                                                     | Child currently provides `mode: 'host'`, `submode: 'host'`.                                                                                                                                                   | Hints only; never authorization.                                                                                                                                 |
| `@context.store`, `getCard`, `getCards`, `getCardCollection`                       | Omitted from user Capsule args. Trusted Base/search portals receive realm-scoped Host implementations.                                                                                                   | Omitted from the child CardContext.                                                                                                                                                                           | A card cannot use `@context` to recover the canonical Store or query arbitrary realms.                                                                           |
| `@context.toolContext` / legacy `commandContext`                                   | User Capsule code currently receives only a frozen empty presence token (`{}`), never the Host `ToolContext`; non-JSON Host objects are omitted.                                                         | Not transported through the iframe protocol.                                                                                                                                                                  | Each executable command needs a separately reviewed named effect; the context is not a bag of Host services.                                                     |
| `@context.searchResultsComponent`, `cardComponentModifier`, `markdownEmbedChooser` | References exist only at the trusted Host/Base portal. JSON cloning omits component classes and functions from user Capsule instances.                                                                   | Not transported.                                                                                                                                                                                              | These are compatibility seams for trusted UI, not realm authority.                                                                                               |

## Sandbox-scoped Store authorization

The Store remains the canonical owner of card documents and relationships, but
canonical ownership does not grant a sandbox visibility into everything the
Store can access. Any future Store-backed API offered to authored code must be
a scoped facade or capability broker, never the live Store.

The effective grant for a sandbox request is:

```text
current user authority
  ∩ sandbox/app policy
  ∩ installed app realm and explicitly selected records
  ∩ requested operation
```

The default should permit an installed app to operate only within its granted
app realm. Cross-realm access should be record-scoped: a trusted Host chooser
lets the user select exact cards or resources, then records a revocable grant
and returns inert links or opaque handles. This is the selected-photo model,
not the whole-library model. A card cannot create a grant by guessing a URL,
serializing a card id, following an ungranted relationship, or opening an
iframe on a particular origin.

A grant needs to bind at least the current user session, app/module identity,
app installation, sandbox instance, allowed card ids or relationship roots,
operations (`read`, `search`, `write`), and its lifetime/revocation state. An
iframe origin is a transport boundary, not sufficient application identity;
`prefersFullSandbox` is an execution preference, not authorization.

The Store/query layer must enforce the grant before materializing documents,
relationships, result counts, or metadata. Relationship traversal does not
implicitly grant the target's whole realm, reverse traversal, or global search.
Writes are separately authorized even when reads are allowed. Every grant is
also intersected with the user's current server-side permissions, so it can
never amplify the user's authority.

This is a required authorization improvement, not a shipped claim. Today the
boundary prevents broad access by omitting `@context.store`, `getCard`,
`getCards`, and `getCardCollection` from user Capsule and iframe contexts. A
future selected-content API must first add the scoped principal/grant checks at
all Store load, search, relationship-hydration, and mutation entry points.

Action event arguments are also a tunnel. Capsule actions receive a frozen,
plain event/target snapshot containing only approved values such as event type,
keyboard/pointer coordinates, form `value`/`checked`, selected index, and
dataset. They do not receive `Event`, `Element`, `Window`, `document`, or live
methods such as `preventDefault`, focus, selection, and pointer capture. A
legacy behavior that needs one of those operations requires a reviewed shim,
`safeModifier`, or iframe classification.

## Complete internal tunnel ledger

These are implementation protocols, not imports for card authors.

| Tunnel                            | Direction                                                              | Payload and lifecycle                                                                                                                                                                                                                    | Security/compatibility semantics                                                                                                                                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Opaque card state                 | Store/Host -> trusted renderer                                         | Stable type ref, principal, canonical document, tracked JSON snapshot, presentation, and Host-only field/relationship callbacks; lives with the Store card identity.                                                                     | User code sees the snapshot, not the state object or callbacks. Reconciliation mutates the stable projection so mounted DOM is not discarded.                                                                                                |
| Sandbox Store grant               | Host authorization -> scoped Store facade/broker                       | Immutable sandbox execution identity, app installation/realm scope, exact user-selected card ids or relationship roots, allowed operations, and expiry/revocation state. The Host attaches it to every sandbox-originated Store request. | Internal authorization context, not a mutable card value or bearer token exposed to authored code. Guessed URLs and relationship ids cannot extend it; Store loads, searches, hydration, and writes enforce it before materializing results. |
| Type metadata                     | Capsule introspection -> Host opaque type                              | Definition kind, ancestors, field kinds/trusted type identities, display name, icon identity, header color, authored formats, custom-template flags, and wide-format hint. Cached per type/module and updated by targeted revision.      | Data only. It replaces direct Host introspection of the user constructor.                                                                                                                                                                    |
| Iframe type presentation          | Child -> Host, on `ready`                                              | `{ displayName, headerColor, prefersWideFormat }` for the loaded definition/revision.                                                                                                                                                    | Bounded strings/boolean only. It may update presentation; it cannot send a constructor, component, CSS, icon, or sandbox-policy choice.                                                                                                      |
| Render presentation               | Host -> iframe child                                                   | `{ format, heightMode, fieldName?, codeRef?, displayContainer }`; updated on a persistent MessagePort when compatible presentation changes.                                                                                              | Controls rendering/sizing only. `codeRef` and field are resolved inside the child; no Host object crosses.                                                                                                                                   |
| Initial iframe connection         | Host -> child                                                          | Exact-origin bootstrap followed by a per-render `MessageChannel`; sends card document or draft, root module URL, render presentation, and `canWrite`. Ends when the iframe renderer is destroyed.                                        | The unguessable bootstrap id and exact origin bind the port. Realm credentials, Store, Host Loader, and parent DOM are excluded.                                                                                                             |
| Readiness/generation result       | Child -> Host                                                          | `ready` with card id, optional draft revision/error, and optional type presentation after authored DOM commits.                                                                                                                          | Loading clears only on terminal ready/error; revision associates the result with the correct code generation. Last-known-good UI may remain visible after a failed draft.                                                                    |
| Height service                    | Child -> Host                                                          | Bounded finite width/height from `ResizeObserver` and font/viewport changes.                                                                                                                                                             | Used only in `intrinsic` mode and clamped by the Host (currently 40–2,400 px height). `fitted` defaults to `allocated`, where reports do not resize the iframe.                                                                              |
| Safe modifier                     | Authored template -> trusted modifier -> optional Capsule callback     | A named operation plus inert inputs/results. Current operations cover focus, scroll, and size observation; size callbacks receive frozen finite `{ width, height }` data and teardown disconnects observers.                             | New optional `safeModifier` author API. It never exposes an element, observer, `document`, or `window`; each additional operation requires separate review.                                                                                  |
| Surface presentation              | Capsule DOM event or child -> Host                                     | `{ containerBackground }` for the current mounted surface/generation. Removed when the modifier unmounts.                                                                                                                                | New optional `surfacePresentation` author API. Only transparent/validated solid color/resolved `match`; no selector, gradient, image, variable, URL, DOM, or arbitrary CSS.                                                                  |
| Permission update                 | Host -> child                                                          | `canWrite: boolean`, sent initially and whenever realm authority changes.                                                                                                                                                                | Presentation hint plus defense in depth. Host rechecks permission on every update; URL/query params and child state never grant it.                                                                                                          |
| Card update                       | Child -> Host -> child acknowledgement                                 | Monotonic revision plus bounded `LooseSingleCardDocument`; coalesced once per animation frame; Host replies with matching revision/error.                                                                                                | Child may update only the card it is rendering. Host validates envelope, id, permission, canonical Store ownership, and persistence. Computed values are excluded from serialization.                                                        |
| Capsule `set`/`view-card` effects | Capsule action -> Host                                                 | JSON-shaped effect queue returned after an action; applied in order, then a render is requested if local state changed.                                                                                                                  | Only the two named effects exist today. Unknown/cyclic authority is not cloned.                                                                                                                                                              |
| Module fetch broker               | Child -> Host -> child                                                 | Correlated read-only `GET` request/response for purpose `module`; URL and an allowlisted header subset in, bounded status/headers/body/final URL out. In-flight identical requests are deduplicated.                                     | Host enforces the declared module graph, final-response URL, response-size limit, and credential use; child never receives credentials or Host fetch. Code-preview draft source can be fulfilled from the active generation before network.  |
| Image fetch broker                | Child -> Host -> child                                                 | Same correlated transport with purpose `media`; the current child media bridge discovers declarative `<img src>` values and requires an `image/*` response before replacing the URL with a child-local object URL.                       | Own-realm images may use Host authentication; public images remain credentialless. This does not yet claim general audio/video transport. Response bodies are data/transferables, not network authority.                                     |
| Draft/HMR                         | Monaco/AI/out-of-band source -> Host -> active Capsule/iframe          | Source URL, source text (bounded to 2 MB in iframe protocol), and monotonic revision. A volatile module keeps a dedicated runtime/loader; matching Realm SSE echoes acknowledge rather than replace the newer local generation.          | Classification/transpilation is keyed by source hash. Errors report against their generation and retain last-known-good rendering. A manual Reload Card intentionally advances the reload identity.                                          |
| Stylesheet tunnel                 | Compiled Capsule component -> Host style registry                      | Validated, scoped stylesheet strings associated with the captured template and stable render island.                                                                                                                                     | Network-bearing declarations, document-global rules, escaped selectors, and escaped keyframes are rejected. Ref-counting prevents per-card duplication.                                                                                      |
| Theme tunnel                      | Authenticated Host fetch -> trusted CardContainer                      | Validated linked-theme CSS plus generated scope/id. Cached with a bounded LRU.                                                                                                                                                           | Theme credentials and Theme instance never cross; only confined CSS is mounted by Host.                                                                                                                                                      |
| Prerender handoff                 | Realm index/endpoint -> Host iframe placeholder                        | Inert HTML for the exact requested format when available; visible until child ready and first intrinsic size.                                                                                                                            | Visual replacement, not DOM adoption across origins. It has no event handlers or capability. A temporary embedded fallback is explicitly marked and cannot claim readiness.                                                                  |
| Relationship/delegated render     | Trusted Base `getComponent()` -> Host synthetic type -> owning sandbox | Host synthetic static format slot returns `RealmSandboxDelegatedRender`; contextual identity chooses the linked card/field boundary.                                                                                                     | Compatibility shim for existing Base code. Child/parent state stays opaque; no new Base symbol or card-source change.                                                                                                                        |
| Trusted UI portal                 | Trusted Base FieldDef <-> Host                                         | Private `CardContext.requestRender`, `trustedUI.loadCodeMirror/loadKatex/loadMermaid`, and `validateCodeRef`.                                                                                                                            | Never projected into user Capsule/iframe code. It lets trusted Base UI use Host bundles and realm validation without handing those capabilities to the card.                                                                                 |
| Execution status                  | Host classifier/runtime -> trusted menu UI                             | `Direct`, `Capsule`, or `Sandbox` for the module serving the **current format**.                                                                                                                                                         | Diagnostic only. Cards cannot select Direct, and the label is not a control or source-trust claim.                                                                                                                                           |

The iframe protocol is versioned as `boxel-realm-iframe-v1`; every message is
schema checked before dispatch. Protocol names, hidden capability marker args,
opaque symbols, revisions, and MessagePorts are private implementation details.
Realm source must never rely on them.

An existing card that renders on staging must not need a source edit merely
because the Host starts evaluating it in an SES compartment or a sandboxed
iframe. The sandbox owns the compatibility work. It must either:

1. provide a confined implementation of an API the card already imports;
2. project an existing template argument or context capability across the
   boundary; or
3. select an iframe when the card genuinely requires browser authority that an
   SES compartment cannot safely receive.

Playback synchronization and viewport coordination are deliberately outside
this ledger. They are new, opt-in product features rather than prerequisites
for rendering existing cards. The small presentation value below is included
because it now crosses both sandbox transports.

The `surfacePresentation` capability follows the existing
`headerColor` presentation boundary rather than inventing a second transport.
`headerColor` remains type-level title-bar metadata;
`surfacePresentation(containerBackground=...)` is per-render-generation
placement metadata for the Host container behind an SES or iframe surface.
It is optional and does not become a prerequisite for unchanged staging cards.

## Bottom line

For ordinary CardDef and FieldDef source, the target number of required new
card-facing APIs is **zero**. Existing cards should continue to import the same
Base, Catalog, Boxel UI, icon, Ember, and Glimmer modules they import today.

The branch currently has two genuinely new card-facing APIs. `safeModifier`
lets newly authored code request a small DOM operation while remaining in SES.
`surfacePresentation` publishes bounded presentation metadata for the current
render surface, following the existing `headerColor` boundary. Both are
optional. Existing cards that import an ordinary DOM modifier should instead
be classified into the iframe tier, or receive a compatible Host shim when the
operation can be expressed safely. They must not be rewritten just to render.

The branch also has several internal Host/Base runtime bridges. Cards do not
import them, and core rendering no longer requires a separately deployed Base
realm to recognize a new hook. They are still listed because future changes to
these bridges must not become staging card API dependencies.

## Exact inventory: what did this branch add?

There are two different questions hiding behind “new API,” and they need
different answers:

1. **Must an existing realm card import or call something new?** No.
2. **Does the current branch add bundled Host/Base runtime behavior?** Yes, but
   none of it requires a staging card source change or a separately deployed
   Base recognition hook for core rendering.

| Branch addition                                                                                     | Imported by authored realm cards? | Does an unchanged staging card fail to render without it?                                                                                                                                                                                 | Disposition                                                                                                                        |
| --------------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `safeModifier`                                                                                      | Only when a new card opts in      | **No.** Existing DOM-dependent source must be classified into an iframe or supported by a shim.                                                                                                                                           | Keep optional; never use it as the compatibility fix for an existing card.                                                         |
| `surfacePresentation`                                                                               | Only when a new card opts in      | **No.** It provides per-render-surface placement metadata and follows the same bounded presentation precedent as `headerColor`.                                                                                                           | Keep optional and data-only; never expose Host DOM or arbitrary CSS through it.                                                    |
| Host-owned static format-slot shim for opaque synthetic definitions                                 | No                                | **No.** Existing trusted Base code continues calling its ordinary `getComponent(opaqueLinkedCard)`. The synthetic type exposes the Host delegate through the same `isolated`/`embedded`/etc. static slots Base already reads.             | Implemented without a new symbol or coordinated Base deployment. Unauthored slots retain their trusted Base fallback template.     |
| `CardContext.requestRender`                                                                         | No                                | No. It restores dynamic local-state rerenders inside a trusted Base component portal; basic card rendering does not depend on it.                                                                                                         | Keep optional. It is a renderer capability supplied by the Host, not realm card API.                                               |
| `CardContext.trustedUI`                                                                             | No                                | Rich Markdown and other trusted Base field components need Host-bundled CodeMirror, KaTeX, and Mermaid without receiving `window`, a Loader, or arbitrary imports. Existing deployed Base modules continue through compatibility globals. | Keep private to Host-owned Base/catalog portals. Never project this object into a user component's SES context or iframe document. |
| `CardContext.validateCodeRef`                                                                       | No                                | No. It preserves CodeRef edit validation without importing user modules into the trusted Host graph.                                                                                                                                      | Keep optional and limited to trusted Base edit UI.                                                                                 |
| `createFromSerialized(..., { loader })`                                                             | No                                | Not as an authored API. Without loader preservation, cross-realm materialization can resolve a definition through the wrong Loader and produce incorrect identity or behavior.                                                            | Keep internal. Host and its bundled Base/runtime must agree, but realm source and realm data do not change.                        |
| Loader `ModuleEvaluator` / module delegation                                                        | No                                | No new source requirement; the sandbox cannot evaluate ordinary existing ESM graphs correctly without an equivalent internal mechanism.                                                                                                   | Keep internal and test through existing card imports.                                                                              |
| Inherited captured-template lookup                                                                  | No                                | Yes, as a Host compatibility behavior: a subclass with no new template must inherit its parent's captured template while keeping leaf getters/actions. No author should copy the template into the subclass.                              | Keep internal to the compartment runtime and cover with inheritance tests.                                                         |
| Exact-format prerender placeholder and iframe readiness/height protocol                             | No                                | No source change. It makes an iframe-routed card immediately visible from indexed HTML while the interactive child loads, then swaps only after readiness and the first intrinsic size.                                                   | Keep renderer-owned. The card receives neither the prerender fetch capability nor the MessagePort protocol.                        |
| Format-only import lifting                                                                          | No new symbol                     | No. It recognizes ordinary ESM imports used exclusively as direct static values of iframe-capable format slots. Unchanged unsplit modules still work through the iframe tier.                                                             | Keep as conservative source analysis; ambiguity preserves ordinary eager ESM semantics.                                            |
| Opaque-card state, type, field, theme, stylesheet, generation, iframe, height, and effect protocols | No                                | No new source requirement; missing projections can make cards render incorrectly, but the correction belongs in the Host protocol.                                                                                                        | Keep internal. Never serialize these symbols into card data or expose them as realm imports.                                       |

Therefore, if “API” means an API an existing card author must adopt for
compatibility, the list is empty. Newly authored cards may opt into the three
bounded APIs above to avoid broader browser authority, improve Host
presentation, or request stronger isolation. The previous paired Base/Host
dependency for opaque linked-card
`getComponent()` delegation has also been removed. The compatibility shim now
lives entirely in the Host's synthetic opaque card definition.

## What a card author may choose

The sandbox tier is a Host decision, but an author can structure source so the
Host can choose the least expensive safe tier:

| Author need                                                                             | Recommended source                                                                                                                     | Result                                                                                                                                                                  |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary CardDef/FieldDef, templates, fields, actions, computed values, Boxel UI, icons | Write the same card source used today.                                                                                                 | Host selects Direct for trusted code or Capsule for user code.                                                                                                          |
| A small reviewed DOM operation                                                          | Opt into `safeModifier` with a named operation and inert arguments/results.                                                            | The renderer can remain in Capsule.                                                                                                                                     |
| Three.js or another package that genuinely needs `window`/`document`                    | Put that renderer in a separate module and use its import only as the value of `static isolated`, `static embedded`, or `static edit`. | Only those formats select Sandbox; compact formats can remain Capsule or use indexed HTML.                                                                              |
| Browser-dependent code mixed into schema, module initialization, or compact renderers   | No special syntax is required.                                                                                                         | The dependency remains an eager graph edge and the Host conservatively selects Sandbox where supported.                                                                 |
| An explicit request for the strongest available isolation                               | Set literal `static prefersFullSandbox = true` on the CardDef.                                                                         | `isolated`, `embedded`, and `edit` use an iframe Sandbox; dense formats retain their confined Capsule or trusted Base fallback. The request can only strengthen policy. |

There is intentionally no `cardSandbox` URL switch and no card-controlled API
that selects Direct execution. Source analysis may choose a stronger container;
only Host policy can grant authority.

## Existing card contract that the sandbox must shim

These are not new card APIs. A staging card already depends on them, so the
sandbox runtime must preserve their observable behavior.

| Existing contract                                                                                                                                                                                               | Sandbox implementation                                                                                                                                                                                                                                                   | Source change?                                       | Current status                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CardDef`, `FieldDef`, `Component`, `@field`, `contains`, `containsMany`, `linksTo`, `linksToMany`, and `getFields` from either Base card-api spelling                                                          | The compartment installs a realm-local card-api facade. Schema decorators record inert metadata; they do not expose the trusted Host Base classes. Unknown type-only exports become inert trusted-export tokens.                                                         | No                                                   | Implemented in `RealmCompartmentModuleRuntime.cardAPIFacade()`; covered by compartment runtime tests and the compatibility corpus.                                                                                                                                |
| Base and Catalog modules imported by package name, canonical URL, or resolved trusted-realm URL                                                                                                                 | Import policy canonicalizes the specifier and delegates trusted modules without granting their Loader or network authority to user code.                                                                                                                                 | No                                                   | Implemented. The allowlist is URL/principal based, not chosen by a card or query parameter.                                                                                                                                                                       |
| Boxel icons, approved Boxel UI presentation exports, and the small Ember/Glimmer import vocabulary already used by cards                                                                                        | The compartment supplies explicit facades or inert trusted-export tokens.                                                                                                                                                                                                | No                                                   | Implemented, with import-policy and runtime tests. The exported surface must remain an audited allowlist.                                                                                                                                                         |
| Static formats and metadata: `isolated`, `embedded`, `fitted`, `edit`, `atom`, `head`, `markdown`, `displayName`, `icon`, `headerColor`, `prefersWideFormat`, `prefersFullSandbox`, and theme/cardInfo metadata | The compiler captures static descriptors as data. The Host chooses the render container and injects theme variables/cardInfo presentation outside the compartment. `prefersFullSandbox` is the sole new opt-in in this row and only strengthens eligible format routing. | No for existing cards; opt-in for the new preference | Implemented as detailed in the complete ledger, including strict metadata capture, HMR refresh, eligible-format routing, and one-way policy tests.                                                                                                                |
| `@model`, `@fields`, `@format`, `@context`, `@set`, and `@viewCard`                                                                                                                                             | The Host passes data-only projections and narrow callbacks. `@set` becomes a delegated effect that the Host applies to the canonical Store card; `@viewCard` becomes a navigation effect.                                                                                | No                                                   | SES `@set` is wired and browser-verified to persist. Iframe edit events serialize a plain root-card document through MessageChannel; writable and forged read-only transport cases are covered. Delegated primitive `@set` still needs an end-to-end corpus case. |
| Nested field rendering such as `<@fields.cardInfo.name />`, contains/containsMany FieldDefs, links, and polymorphic fields                                                                                      | The Host exposes contextual field components by lookup without making them enumerable schema. Rendering re-enters the owning realm sandbox with the field/card identity and format.                                                                                      | No                                                   | Implemented for lookup and schema enumeration; browser persistence was verified for cardInfo. Broader delegated-field coverage remains in the corpus matrix.                                                                                                      |
| Template actions receiving browser events                                                                                                                                                                       | The Host projects a frozen data snapshot (`type`, keys, pointer coordinates, form value/checked state, and dataset) instead of passing an `Event`, `Element`, or `Window`.                                                                                               | No                                                   | Implemented for data reads. Imperative effects such as `preventDefault()`, focus, blur, pointer capture, and selection require explicit Host effects if existing cards depend on them.                                                                            |
| `computeVia`, getters, and BXL-backed materialized values                                                                                                                                                       | SES evaluates pure card computation in the realm compartment. Iframe rendering should consume the Realm Server/indexed materialized value rather than opening an iframe merely to compute data.                                                                          | No                                                   | Partially implemented and represented in the corpus. The iframe rule is architectural guidance and still needs complete enforcement/coverage.                                                                                                                     |
| Default Base isolated/edit templates when a card supplies no custom format                                                                                                                                      | The trusted Host/Base renderer uses the opaque card projection and contextual fields. No user module or iframe is needed for the fallback template.                                                                                                                      | No                                                   | Implemented for the core fallback path; new-file and broken-source/last-known-good behavior still require parity tests.                                                                                                                                           |
| Realm readability/writability and Store save semantics                                                                                                                                                          | Permissions stay in the Host. Mutations name a card/field/value; the Host validates the principal, updates the canonical Store identity, and saves through the Store.                                                                                                    | No                                                   | SES editing persists. Iframe transport distinguishes received from persisted updates and forged read-only messages are rejected. A live authenticated edit-and-reload check remains required before the iframe write row is green.                                |
| Scoped card CSS and theme CSS variables                                                                                                                                                                         | The compiler/Host owns selector confinement, stylesheet identity, ref-counting, and theme variable injection.                                                                                                                                                            | No                                                   | Theme projection exists. Hostile CSS confinement is explicitly unfinished and must not be papered over with a new authored API.                                                                                                                                   |

## New card-facing APIs

### `safeModifier`

```gts
import { safeModifier } from '@cardstack/boxel-ui/modifiers';

<section {{safeModifier 'observe-size' this.receiveSize}}></section>
```

Supported operations currently include `focus`, `scroll-into-view`, and
`observe-size`. The modifier executes in the trusted renderer and returns only
plain data (for example `{ width, height }`) to SES. It never gives the card an
`Element`, `ResizeObserver`, `document`, or `window`.

This API is **not required for existing staging cards**:

- A new card may opt into it to remain in SES.
- An existing card using a modifier that requires raw DOM authority may run in
  an iframe unchanged.
- For a common legacy modifier operation, the preferred compatibility solution
  is a Host shim keyed by the existing import/export, not a card rewrite.
- Adding another safe operation requires a threat review of its arguments,
  return value, lifetime, cleanup, and authority—not merely adding the method to
  an allowlist.

### `surfacePresentation`

```gts
import { surfacePresentation } from '@cardstack/boxel-ui/surface';

<article {{surfacePresentation containerBackground='match'}}>...</article>
```

This optional capability follows the existing `headerColor` precedent.
`headerColor` remains type-level metadata for the title bar;
`containerBackground` belongs to the current mounted format and colors only
the Host container behind it. The card publishes either `transparent`, a
validated solid color, `match`, or no value. The trusted modifier resolves
`match` to the attached surface root's computed solid background and sends only
that inert color through the SES event or iframe MessageChannel boundary.

It does not expose the Host element, copy iframe `body` markup or styles, accept
selectors, or transport gradients, images, CSS variables, and URL-bearing CSS.
Invalid or missing values leave the normal Host container background intact.

The iframe height service itself is transport owned by the renderer. Cards do
not import it. Height ownership is explicit in the private protocol:

- `intrinsic`: the child reports measured content size and the Host sizes the
  iframe. This is the default for embedded, atom, edit, and isolated formats.
- `allocated`: the Host supplies a viewport and ignores child resize reports;
  the card controls internal overflow and docked panels. This is the fitted
  default.

The child only runs its document observer in intrinsic mode. In allocated mode
the iframe viewport itself communicates the Host allocation without exposing
the parent DOM, `window`, or `MessagePort` to authored code.

Iframe startup uses the Realm index's prerendered HTML as an inert visual
handoff. The Host prefers the exact card/format rendering, marks the header as
loading, and reveals the iframe only after the child reports both runtime
readiness and (for intrinsic formats) its first safe height. This is visual
replacement, not cross-origin DOM hydration: the iframe remains the only
interactive authority.

During the rolling deployment of authenticated isolated prerenders, an
isolated sandbox may temporarily show the card's indexed `embedded` rendering
when the Realm Server cannot return `isolated`. That fallback remains inert,
is explicitly marked `data-card-sandbox-prerender-format="embedded"`, and
never clears the loading state. It is therefore a placeholder rather than an
assertion that the requested format has hydrated. Once the authenticated
isolated endpoint is deployed everywhere, this compatibility fallback should
be removed so exact-format handoff is the only path.

## Runtime bridges that cards do not import

### Execution vocabulary

User-facing execution status describes mechanics, independently of source or
trust provenance:

- **Direct** runs in the Host JavaScript and DOM environment with no sandbox
  boundary.
- **Capsule** runs inline through an SES/Endo compartment with explicit
  capabilities and no unrestricted browser globals.
- **Sandbox** runs in a separate iframe document and communicates through the
  controlled Host bridge.
- **Private** is a protection modifier, not a fourth execution mode. It is not
  implied merely by choosing Sandbox and must only appear when the separate
  data-flow protections are actually enforced.

The status applies to the **currently rendered format module**, not to the
card, realm, or card definition forever. The Host classifies the GTS module
selected for the current format (including its import graph) and reports the
execution boundary actually used for that module. Switching formats can
therefore legitimately change the status: a trusted format module can be
Direct, a format implemented by SES-compatible realm code can be Capsule, and
a format whose module requires browser authority can be Sandbox.

Low-level implementation names such as `iframe`, `MessageChannel`, and
`compartment` remain appropriate in protocol and transport code. Product UI
uses `Execution: Direct`, `Execution: Capsule`, or `Execution: Sandbox` and
does not conflate those modes with Official, Community, or Third-party source.

These changes may ship with the Host/runtime, but they must not appear in realm
card source or serialized card data.

| Internal bridge                                                                          | Why it exists                                                                                                                                                                                                                                            | Does current staging card source need it?                                                | Recommendation                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loader `ModuleEvaluator`, `ModuleRegistration`, and module delegation                    | Allows the same Loader graph to evaluate user modules through SES while sharing trusted Base/Catalog module identities and caches.                                                                                                                       | No                                                                                       | Keep. This is the runtime seam that makes the shim strategy possible.                                                                                                                                                      |
| `createFromSerialized(..., { loader })` and definition-loader preservation during update | Materializes a canonical Store card while resolving its authored definition in the correct realm loader.                                                                                                                                                 | No                                                                                       | Keep as an internal deserialization option. Test identity across Store, Base, and realm loaders.                                                                                                                           |
| Native `instanceof` fast path before code-ref identity walking                           | Lets a Host-created opaque adapter retain legitimate subclass behavior without pretending to be an exported realm definition.                                                                                                                            | No                                                                                       | Keep if tests demonstrate the opaque adapter case; otherwise narrow it further.                                                                                                                                            |
| `CardContext.requestRender`                                                              | Lets trusted Base FieldDefs whose local state lives behind a delegated render root request a rerender.                                                                                                                                                   | No; only branch-updated trusted Base modules call it.                                    | Keep optional and Host-provided. It is a Base/Host context capability, not an authored-card requirement. Prefer ordinary tracked invalidation whenever it crosses correctly.                                               |
| `CardContext.validateCodeRef`                                                            | Lets the trusted Base CodeRef editor validate a reference through the owning realm sandbox without importing user code into the Host graph.                                                                                                              | No; only the trusted Base CodeRef editor calls it.                                       | Keep optional and capability-scoped. It belongs to edit behavior, not core rendering.                                                                                                                                      |
| Opaque synthetic type static format-slot shim                                            | Existing trusted Base Markdown rendering calls `getComponent(linkedCard)`. The linked user card remains opaque, but its Host-created synthetic type exposes `RealmSandboxDelegatedRender` through the ordinary static format slot Base already resolves. | No. Older deployed Base code uses its unchanged `getComponent(instance)` implementation. | Keep Host-owned. Do not add delegation symbols to Base, the opaque instance, authored source, or serialized data. A focused browser test invokes ordinary Base `getComponent()` and verifies the delegated format renders. |

## Accidental Base APIs removed or forbidden

During the cardInfo/edit investigation the branch temporarily added
`setCardFieldValue()` to Base and considered calling an internal
`notifyCardTracking()`. That was the wrong boundary: the staging Base realm did
not export those functions, and a Host sandbox must not make card rendering
depend on deploying them.

The Host now updates the opaque projection, invalidates its targeted data
revision, and saves the canonical card through the Host Store. The unused
`setCardFieldValue()` and `waitForCardLoads()` additions have been removed from
Base. `notifyCardTracking()` remains an internal Base implementation detail and
is not a sandbox ABI.

The same rule applies going forward: a missing Base export is evidence to add a
Host adapter or use an existing public contract, not evidence that all staging
cards should wait for a new Base deployment.

## Known compatibility gaps—not invitations to add card APIs

1. The existing `@set` contract is working for SES delegated FieldDef rendering.
   Iframe root edits now cross as a bounded serialized card document, but the
   same unchanged delegated primitive field still needs an authenticated
   edit-and-reload corpus test in both automatically selected tiers.
2. DOM actions beyond safe event data need a small effect vocabulary or iframe
   classification. Raw browser objects must never cross into SES.
3. CSS confinement is incomplete. Fix compiler/Host scoping; do not require
   cards to adopt a new stylesheet API.
4. Iframe fetch, origin, height, and lifecycle are renderer responsibilities.
   They must not become card arguments or URL-selected policy.
5. Surface/playback/viewport coordination remains opt-in and is not part of the
   core card compatibility bar.

## 2026-08-04 real-card review

The shared capability vocabulary, legacy-adapter policy, and iframe decision
boundary are specified in
[`realm-sandbox-surface-capabilities.md`](./realm-sandbox-surface-capabilities.md).

Five recently authored staging cards exposed places where the first-pass
classifier chose an iframe even though only a small part of the card needs
browser or Host authority. None should require a source migration. The target
is an SES-rendered card plus compatibility shims that preserve the APIs the
card already uses.

| Card                 | Why the root belongs in SES                                                            | Existing behavior to preserve                                                                                                  | Host compatibility work and classification rule                                                                                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scrabble Stream      | The board and Yjs-backed state are ordinary shared-DOM Glimmer UI.                     | `ember-modifier` lifecycle setup, timer cleanup, and an authenticated Realm/AI request.                                        | Reify lifecycle-only modifiers without exposing an element; provide a confined scheduler and authenticated proxy effect. Remove blanket `ember-modifier`/`window` escalation when static analysis proves only those supported operations are used.                       |
| Tier Maker           | The tier board must compose in fitted galleries and uses normal card markup.           | Root-scoped pointer/focus behavior, restartable work, view transitions, clipboard/vibration, and computed presentation styles. | Add an existing-`ember-modifier` compatibility adapter whose element facade is confined to the render root, a task/scheduler facade, Host effects for clipboard/vibration, and per-value CSS validation. Escalate only unsupported DOM operations, not the whole import. |
| Assistant Run        | The run document and controls are ordinary card UI.                                    | A helper currently finds Host chrome and mounts a worker toolbar there.                                                        | Replace implicit Host-document traversal with a Host-owned toolbar-slot effect. Keep the card body in SES. Scope-aware global analysis must ignore local data variables named `document`; that classifier fix is implemented and tested.                                 |
| Signet Proposal      | The proposal is declarative CardDef data, Markdown, scoped CSS, and explicit commands. | Base `enumField()` specializations and a signature canvas.                                                                     | The compartment now supplies an authority-free `enumField()` facade that preserves the trusted primitive FieldDef identity. Delegate the signature control through a confined canvas field/effect; do not iframe the proposal.                                           |
| Invoice Billing Form | The invoice is a composed Base/Boxel UI form.                                          | Due-date, priority, and score FieldDefs compute color-only inline styles.                                                      | Route dynamic style attributes through a Host validator at assignment time and keep the form in SES. The classifier should escalate only when a style value cannot be proven or validated safe.                                                                          |

This implies a more precise rule than “an import is safe” or “an import needs an
iframe.” Classification should name the operation requested by that import.
Known confined operations stay in SES; an unsupported operation selects an
iframe only for formats that support it. The compatibility adapter remains
Host-owned, so an unchanged staging realm gets the safer behavior when the Host
is upgraded.

## Format-only import splitting

A card may keep its schema, computed data, and compact renderers in an SES-safe
module while importing a browser-dependent component module only for
`isolated`, `embedded`, or `edit`:

```gts
import { PlanetEditor, PlanetScene } from './planet-3d';

export class PlanetCard extends CardDef {
  static isolated = PlanetScene;
  static embedded = PlanetScene;
  static edit = PlanetEditor;

  static atom = class Atom extends Component<typeof PlanetCard> {
    <template>
      <span>{{@model.name}}</span>
    </template>
  };
}
```

There is no privileged filename, package-name assertion, or card-selected
sandbox tier in this convention. The classifier analyzes each module normally.
The Host's module graph may defer an import behind inert format references only
when every runtime use of every imported binding is the direct value of an
eligible static format slot. This is scheduling metadata, not a classifier
exception: the target module still receives the same ordinary source
classification as any other module. Its independently classified requirement
then applies only to those slots. Native/trusted execution retains ordinary ESM
behavior.

If the imported binding is also read by schema code, a compact renderer, a
module-scope initializer, or any other executable path, the import is not
format-only. The Host conservatively treats it as an ordinary eager ESM edge.
Mutable object identity, closures, DOM nodes, and renderer instances never
cross between SES and an iframe; shared state belongs in canonical card data or
an explicit Host capability.

When an unsplit module needs browser authority, `isolated`, `embedded`, and
`edit` use the iframe tier. `fitted`, `atom`, `head`, and Markdown composition
do not create inline iframe farms: they use a safe SES renderer when one can be
proven, otherwise they remain inert using the Realm's preindexed HTML and open
the full iframe surface on activation.

## Boundary proof map

| API, shim, or convention                                                                    | Focused proof                                                                                                                                        |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `safeModifier` exposes inert results and cleans up trusted DOM work                         | `packages/boxel-ui/test-app/tests/integration/modifiers/safe-modifier-test.gts`; `packages/host/tests/unit/realm-compartment-module-runtime-test.ts` |
| Format-only imports are lifted only from direct eligible static slots                       | `packages/host/tests/unit/lib/realm-sandbox-source-policy-test.ts`; `packages/host/tests/unit/realm-compartment-module-runtime-test.ts`              |
| Inherited templates keep the leaf component's behavior                                      | `packages/host/tests/unit/realm-compartment-module-runtime-test.ts` (`inherits a captured template while preserving the leaf component behavior`)    |
| Trusted Rich Markdown portal loads CodeMirror and Mermaid without giving them to realm code | `packages/host/tests/acceptance/code-submode/sandbox-live-reload-test.gts` (`CORPUS-02`)                                                             |
| Iframe prerender stays visible until interactive readiness and intrinsic size               | `packages/host/tests/integration/components/realm-sandbox-iframe-test.gts`; `packages/host/tests/unit/realm-sandbox-iframe-draft-test.ts`            |
| Exact isolated HTML is queryable as an indexed prerender format                             | `packages/realm-server/tests/card-html-endpoints-test.ts`                                                                                            |
| Runtime/compile failure overlays the last-known-good preview                                | `packages/host/tests/acceptance/code-submode/sandbox-live-reload-test.gts` (`HMR-05`)                                                                |

The proof map is intentionally composed of behavior tests. It is not enough to
assert that a facade property or protocol message exists; the unchanged card
must render or edit through the full boundary.

## Merge gate

Before calling the sandbox source-compatible, the compatibility corpus must
prove all of the following using unmodified staging card source:

- custom and default formats render in SES;
- delegated FieldDefs and linked cards render and update;
- cardInfo, themes, icons, `prefersWideFormat`, and CSS match the non-sandboxed
  staging Host;
- `computeVia`/BXL values match indexed staging values;
- existing `@set`, `@viewCard`, query, command, and edit flows work through Host
  capabilities;
- DOM-dependent cards are automatically assigned to an iframe or handled by a
  reviewed compatibility shim;
- no test fixture imports `safeModifier` merely to make an existing staging
  card pass.

Any red corpus row should first be classified as a missing shim, projection,
or tier-selection bug. Adding a new card-facing API is the last resort and
requires an explicit compatibility rationale in this ledger.
