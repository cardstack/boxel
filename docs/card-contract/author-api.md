# The author API

This chapter states what a card author writes, and what a person using the card
sees as a result. It is written as obligations on the runtime: what a runtime
MUST make true for an author who writes only what this chapter describes.

The signatures are in `packages/base/card-api.gts` and
`packages/base/operations.ts`. This chapter says what they mean.

## 1. What an author writes

A card author writes **definitions**: classes exported from modules, plus the
templates and functions those classes declare.

**§1.1** A definition MUST be a class exported under a name from a module the
runtime can load. A definition the runtime cannot name is a definition no
document can adopt.

**§1.2** A definition MUST extend `CardDef`, `FieldDef`, `FileDef`, or a
subclass of one.

**§1.3** A definition's module and export name are part of its identity. An
author MAY rename a definition only with a migration that carries the instances
that already adopted it.

### The source language

**§1.4** Card source MUST be TypeScript that is erasable — syntax that vanishes
once type annotations are stripped — with the exception of the decorators this
API provides (`@field`, `@operation`). A runtime MAY compile card source, but a
card MUST NOT need a compiler to be understood.

This is a portability requirement, not a build preference. Card source is read
by tools that do not run the card pipeline: Node directly, editors, linters,
the AI assistant's file tools, and anyone's `tsc`. Non-erasable TypeScript
(`enum`, `import =`, `export =`, a value `namespace`) is source those tools
cannot read.

**§1.5** Card source MUST be ordinary ES modules. A card MAY use static imports,
dynamic `import()`, and top-level `await` where the runtime supports them. A
runtime that does not support one MUST fail loudly rather than substitute.

**§1.6** A card MUST NOT import a CommonJS package. A runtime MAY present one as
a shim, and MUST say which modules are shims.

**§1.7** A card MUST NOT read the clock directly with `Date.now()` or a
zero-argument `new Date()`. It reads the current instant through the clock seam
the platform provides (`@cardstack/base/helpers/clock`'s `now()` / `nowDate()`).

The reason is a user-visible property, not a testing preference: a card that
renders "3 days ago" renders differently each time it is indexed, so a visual
comparison of it over unchanged data is meaningless, and a person editing a card
sees its age change for a reason they cannot see. Reading through the seam lets
a runtime pin the instant.

**§1.8** A card's templates MUST NOT select on `data-test-*` attributes, in
styles or in code. `data-test-*` is a test hook. A runtime strips it from what
it serves in some contexts and keeps it in others, so a card that selects on it
behaves differently in two runtimes. A card that selects on something at runtime
uses a plain `data-*` attribute. See finding [B-02](boundary-findings.md#b-02).

## 2. Fields

An author declares a field with `@field` and a field-kind call:

```typescript
class Booking extends CardDef {
  @field title = contains(StringField);
  @field guests = containsMany(StringField);
  @field venue = linksTo(() => Venue);
  @field relatedBookings = linksToMany(() => Booking);
}
```

**§2.1** Field names MUST be strings. `@field` on a computed property name or a
symbol is an error.

**§2.2** Field names MUST NOT be one of the names the runtime provides. Today
those are `captureURLs` and `capturesMeta`. A runtime MUST reject a field that
shadows a provided member at definition time, not at render time.

**§2.3** A field's name is part of the card's data contract. Renaming a field
changes what stored documents mean. A runtime MUST NOT rename a field on an
author's behalf without carrying its values.

### Field kinds

| Kind          | Value                           | Declared with                  |
| ------------- | ------------------------------- | ------------------------------ |
| Contains      | One value, inside the owner.    | `contains(FieldDefClass)`      |
| Contains many | A list, inside the owner.       | `containsMany(FieldDefClass)`  |
| Links to      | One saved card or file.         | `linksTo(CardOrFileClass)`     |
| Links to many | A list of saved cards or files. | `linksToMany(CardOrFileClass)` |

**§2.4** A contained value MUST be a field def. A card def or file def MUST be
linked, not contained. This is not a limitation of the serializer; it is the
distinction the whole model rests on: a contained value has no identity of its
own, and a linked value does. An author who wants a card inside a card links to
it.

**§2.5** A link's target type MAY be given as a thunk (`() => Venue`) to express
a self-referential or forward reference. A runtime MUST treat a thunk and the
class it returns as the same declaration.

### Field options

Every field kind takes an options object.

| Option          | Kind  | Meaning                                                                              |
| --------------- | ----- | ------------------------------------------------------------------------------------ |
| `computeVia`    | All   | The value is derived. See §3.                                                        |
| `description`   | All   | A short human-facing description of the field.                                       |
| `configuration` | All   | Per-usage settings, merged with the field def's own defaults.                        |
| `searchable`    | All   | Which links this field pulls into the search document. See §8.7.                     |
| `query`         | Links | A declared query that resolves the link's targets. See §4.                           |
| `eager`         | Links | Whether the query resolves with the owner or on first read. Default: with the owner. |

**§2.6** Every option an author may write MUST have stated semantics and a
runtime that produces them. An option that a runtime ignores is a defect, not a
roadmap item ([ADR 032 §1.3](../adr/032-define-the-card-contract-as-the-boundary-between-card-code-and-its-runtime.md)).

**§2.7** `configuration` MUST be the only per-usage customization an author
needs to change how one field of one card renders. A runtime MUST NOT require an
author to subclass a shared field def to change one usage.

## 3. Computed fields

A field with `computeVia` derives its value from the owner's other fields.

**§3.1** A computed value MUST NOT be stored. A runtime MUST derive it when the
value is read, and MUST NOT write it into a document.

**§3.2** A computed MAY be declared on any field kind, including `linksTo` and
`linksToMany`. A computed link returns a card instance or a list of them.

**§3.3** A computed MUST re-evaluate when a field it read changes, including a
read immediately after the write.

**§3.4** Within one microtask, repeated reads of one computed MUST share one
evaluation, and every reader in that window MUST see the same value. A runtime
MUST NOT let one computed return two values in one turn.

This is a user-visible guarantee: a template that reads `fullName` in a title
and in a heading shows the same name twice, and a card that reads a computed and
then mutates the copy it got is not surprised by another reader's mutation.

**§3.5** A computed MUST NOT be assumed to run eagerly. A runtime MAY evaluate a
computed before anything reads it, and MUST NOT let that change what any reader
observes. An author MUST NOT rely on a computed having run.

**§3.6** A computed whose inputs include a value the runtime does not track —
the clock, a plain object, a value read from outside the card — MAY be served
from an earlier evaluation until the next microtask. An author who needs a fresh
read MUST make the input tracked.

**§3.7** Overriding an inherited field with a computed MUST NOT break the
inherited field's contract for readers that expect to write it. A runtime MUST
either keep the field writable or make it read-only for every reader of the
subclass, and MUST report which.

## 4. Query-backed relationships

A `linksTo` / `linksToMany` field MAY declare a `query`. Its targets are then
whatever the query matches, not what an author picked.

```typescript
class Venue extends CardDef {
  @field upcomingBookings = linksToMany(() => Booking, {
    query: { filter: { eq: { venue: '$this' } }, sort: [{ startTime: 'asc' }] },
  });
}
```

**§4.1** A query-backed relationship's membership MUST be re-derived when a card
it matches changes. A runtime that cannot invalidate a query-backed relationship
MUST NOT serve its resolved value from an index.

**§4.2** A query-backed relationship's resolved value MUST NOT be stored in the
owner's search document. Its membership is recorded; its field values are not.

**§4.3** `eager` states when the query runs: with the owner by default, or on
first read when `eager: false`. A runtime MUST honor the author's choice, and
where it cannot, MUST fall back to the author's default rather than to the
runtime's convenience. See finding [B-14](boundary-findings.md#b-14).

**§4.4** A query-backed relationship's page ceiling is the runtime's, and the
fact that it clamped is the author's to see. A runtime MUST expose the total
match count and whether the list it gave is partial.

## 5. Templates and formats

A definition declares a template per format by assigning a component to a static
named after the format:

```typescript
class Booking extends CardDef {
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1>{{@model.cardTitle}}</h1>
      <p><@fields.venue /></p>
    </template>
  };
}
```

### The format list

| Format     | Card | Field | File | What it is for                                                   |
| ---------- | ---- | ----- | ---- | ---------------------------------------------------------------- |
| `isolated` | ✓    | —     | ✓    | The card as a root, on its own.                                  |
| `embedded` | ✓    | ✓     | ✓    | The card or field inside another one.                            |
| `fitted`   | ✓    | ✓     | ✓    | A sized tile or badge, for grids and captures.                   |
| `atom`     | ✓    | ✓     | ✓    | The smallest readable form: a title.                             |
| `edit`     | ✓    | ✓     | —    | Controls for changing the value.                                 |
| `head`     | ✓    | —     | ✓    | A document head contribution.                                    |
| `markdown` | ✓    | ✓     | ✓    | The card's content as markdown, for embedding outside a browser. |
| `metadata` | —    | —     | ✓    | A file's metadata inspector.                                     |

**§5.1** This table is the contract. A runtime MUST NOT accept a format name it
is not in, and MUST NOT silently map an unknown format to a default one. See
finding [B-03](boundary-findings.md#b-03).

**§5.2** A family MUST have a default for every format in its column. A
definition that does not declare one gets the family default, and the family
default MUST render something honest rather than nothing.

**§5.3** Format resolution walks the adoption chain. A definition inherits an
ancestor's template for a format it does not declare, and MUST NOT inherit one
it declares.

**§5.4** A field's format defaults from its owner's: an `isolated` card renders
its fields `embedded`; an `edit` card renders them `edit`; a nested plural
contained or linked value renders `atom`. A runtime MAY let a caller override
this, and MUST NOT make an author compute the default themselves.

**§5.5** A computed field MUST render read-only in the default edit template,
whatever the field kind.

### What a template may use

A format component receives a fixed set of arguments.

| Argument                                             | Meaning                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| `@model`                                             | The instance being rendered.                                              |
| `@fields`                                            | The instance's fields, each renderable as `<@fields.name />`.             |
| `@set`                                               | Writes a field's value.                                                   |
| `@fieldName`                                         | The name this instance is being rendered under, when it is a field value. |
| `@context`                                           | The environment's services. See §10.                                      |
| `@canEdit`                                           | Whether this viewer may edit.                                             |
| `@configuration`                                     | This usage's configuration.                                               |
| `@createCard`, `@viewCard`, `@editCard`, `@saveCard` | Ask the environment to move the person to another card.                   |

**§5.6** A template MUST reach its data through `@model` or `@fields`, and MUST
write through `@set`. A runtime MUST NOT require a template to use a runtime-
internal class to read or write a field. See finding [B-06](boundary-findings.md#b-06).

**§5.7** A runtime MUST provide `@model` and `@fields` in every context,
including a prerender. The optional arguments MAY be absent, and a template MUST
tolerate their absence.

**§5.8** A definition's styles MUST be scoped to it. A runtime MUST NOT let one
card's styles reach another card, and MUST NOT require a card to write a
selector that names a runtime-generated class.

**§5.9** A runtime MAY rewrite a card's selectors when it scopes them. A card
MUST NOT depend on its own class names surviving, and MUST NOT depend on them
being rewritten. Selectors a card relies on for behavior use the card's own
`data-*` attributes.

## 6. Editing

**§6.1** Whether a person may edit is the environment's answer, not the card's.
A card MUST render a read-only form when the answer is no, and MUST NOT treat
`@canEdit` as authorization.

**§6.2** A field an author did not declare editable MUST still render a control
in the default edit template when its kind and format allow one. An author opts
out by declaring a template, not by configuring the runtime.

**§6.3** A per-instance field override is a supported author-visible feature: an
instance MAY declare that one of its fields has a different type than its
definition says. A runtime MUST carry that override in the document, MUST apply
it to every reader, and MUST apply it to search as well as to rendering.

**§6.4** A field override MUST NOT delete a field. It changes a field's type,
not its existence.

## 7. Identity and links in author code

**§7.1** An instance's id is an RRI, which is either prefix form
(`@cardstack/catalog/Listing/blog-app`) or URL form
(`https://app.boxel.ai/catalog/Listing/blog-app`). A card MUST treat both as the
same kind of value and MUST NOT assume which form it was handed.

**§7.2** A card that needs a URL a browser can open MUST ask the environment for
one, and MUST NOT call `new URL()` on an id.

**§7.3** A card that needs to compare two references MUST canonicalize them
first, and MUST NOT compare the spellings it was handed.

**§7.4** A card that needs to know which realm a reference belongs to MUST ask
the environment. It MUST NOT infer a realm root from a path.

**§7.5** A link stored in a document MAY be relative to the document that stores
it. A runtime MUST resolve it against the primary resource of the document that
carried it, and MUST give the resulting instance the same base.

**§7.6** A field value of an unsaved instance MUST NOT be given an id it does not
have. A runtime MUST distinguish "no link authored" from "a link to something
that could not be found", and MUST show a broken link as broken rather than as
empty.

## 8. What a card exposes to search

**§8.1** Every card instance is searchable within its realm and across realms.
A card author MUST NOT have to opt in for their card to be found.

**§8.2** A card's title and its type's display name are searchable under names
that do not depend on the card's own field names. A runtime MUST offer one
title key and one type key that work across every type.

**§8.3** A field is searchable when its def family and declaration make it so.
A runtime MUST NOT require an author to know the index's key layout to filter
by a field.

**§8.4** A runtime's synthetic search keys — the keys the index adds that are
not card fields — MUST NOT be part of the query grammar an author writes. Where
an author needs what a synthetic key provides, the runtime MUST offer the
concept directly. See finding [B-11](boundary-findings.md#b-11).

**§8.5** A card's computed values are searchable as the values they had when the
card was indexed. A runtime MUST say, in the same terms it uses for any field,
how stale a computed search value can be.

**§8.6** A query-backed relationship contributes membership to the index, not
field values. An author who filters on a query-backed relationship's targets
filters on membership.

**§8.7** `searchable` decides which linked cards a card's search document
includes, and so which linked values a query can filter on:

- With no `searchable`, a link appears as its target's id only.
- `true` includes the field's own link target.
- A dotted path (`'venue.owner'`) includes a link reached through the field's
  target, one hop per segment. A segment MAY name a contained field, to reach a
  link beneath it.
- An array combines paths.

`searchable` governs links only. A contained value is always in the search
document once its owner is, so a path on a `contains` field is meaningful only
to reach a link beneath it.

Depth is decided by the card being indexed, and only by it. A card pulled into
the search document as a link target does not apply its own `searchable`; only
the indexed card's path continues into it. A path is rooted at the field's
target type. A runtime MUST report a path that does not resolve in the
definition graph as an issue when it indexes the definition, and MUST NOT fail
the definition because of one: the bad path may come from an edit to a
different module than the one being indexed. A link along a path
that cannot be loaded appears as its id, as an unfollowed link does. See
finding [B-01](boundary-findings.md#b-01).

## 9. Presentation an author declares

| Declaration                | Meaning                                                             |
| -------------------------- | ------------------------------------------------------------------- |
| `static displayName`       | The type's friendly name, shown wherever the type is named.         |
| `static icon`              | The type's icon, shown wherever a card of the type appears.         |
| `static prefersWideFormat` | The card wants a full-width container in a stack.                   |
| `static headerColor`       | The color of the card's container header.                           |
| `cardTitle`                | The instance's title. Defaults from `cardInfo.name`, else the type. |
| `cardDescription`          | The instance's one-line summary.                                    |
| `cardThumbnailURL`         | The instance's thumbnail.                                           |
| `static captures`          | Named images the runtime renders of each instance at index time.    |

**§9.1** A runtime MUST show a card's declared presentation consistently across
contexts. A presentation static that one context ignores is a defect.

**§9.2** A declared capture is a durable URL the runtime serves for that
instance. A runtime MUST give the same URL for the same declaration and
instance, and MUST signal absence with `undefined` rather than a placeholder.

**§9.3** A capture's dimensions are the rendered image's intrinsic size. A
runtime MUST NOT expose a capture pipeline's internals (device scale factor,
render format, pool identity) as the author-facing meaning of a capture. See
finding [B-17](boundary-findings.md#b-17).

**§9.4** An icon MUST be declared as something the environment renders, not as
a component an author imports from one icon package. Today `static icon` is a
Glimmer component type, which ties every card in every realm to the host's icon
library. See finding [B-23](boundary-findings.md#b-23).

## 10. What a card may ask the environment for

`@context` carries the environment's services. The contract splits them by
whether a card is entitled to them.

**§10.1** A service a card MUST have in every render — the store, the search
results component — MUST be present, not optional.

**§10.2** A service only some contexts provide MUST be optional, MUST be named
in this contract, and MUST say what a card should do without it. A card MUST
test for the service, not for the identity of the context.

**§10.3** A service that answers a question the context cannot answer MUST return
_unknown_, not a default answer. `canInvoke` and `keyReadiness` return
`undefined` while the realm is being asked, and are absent where nothing can
answer. A card MUST treat `undefined` as "not known yet", never as "no".

**§10.4** A card MUST NOT use an advisory answer as authorization. `canInvoke`
and `keyReadiness` hide a control; the realm decides again when the operation
runs. A runtime MUST enforce at invocation whatever these answers predict.

**§10.5** A context MUST NOT hand a card a runtime object it can drive: not the
module loader, not the realm-mapping network, not the index. A card gets values
and answers, never the machinery. See finding [B-07](boundary-findings.md#b-07).

**§10.6** A context MUST NOT require a card to branch on which host UI is
showing it. A card MAY be told the presentation intent it should honor — whether
it is being edited, whether it is the focus of a workspace — and MUST NOT be
given a runtime's internal mode names as the thing to branch on. See finding
[B-04](boundary-findings.md#b-04).

## 11. Operations

An operation is an action the environment carries out. Some every card has;
some an author declares.

**§11.1** Every def family carries a fixed set of operations without an author
declaring them, and a runtime MUST make these available:

| Family | Implied operations                                                                             |
| ------ | ---------------------------------------------------------------------------------------------- |
| Card   | `read`, `readSource`, `create`, `update`, `delete`, `query`, `transform`, `appendContainsMany` |
| File   | `read`, `readSource`, `update`, `appendLine`                                                   |
| Base   | `read`, `readSource`                                                                           |
| Field  | None. A field is not addressable ([vocabulary §2.1](vocabulary.md)).                           |

`explain`, `validate`, and `callApi` are implied by no family. A def has one
only when an author declares an operation built on it.

**§11.2** An author declares an operation with `@operation` and a declaration
object naming a `base`. The declaration describes the program the runtime runs;
the runtime executes it.

**§11.3** An operation's name is what a caller invokes; its `base` is the
behavior that carries it out. A runtime MUST NOT infer one from the other.

**§11.4** A declaration MUST be data. A runtime MUST be able to lower a saved
declaration and dispatch it without executing the definition's module.

**§11.5** An operation name MUST NOT be a name the invocation surface already
owns, and MUST NOT be `readSource`, which serves stored bytes without reading a
definition. A runtime MUST reject these at declaration time.

**§11.6** A `label` is the human-facing phrase shown wherever the operation is
offered. It takes no part in what the operation does. A runtime MUST show it
wherever it asks a person to agree to the operation.

**§11.7** A read's link strategy (`full`, `ids`, `none`) is a property of the
operation, not of the caller. The same request MUST get the same document shape
from a realm writer and from a caller reached by a grant.

**§11.8** A link strategy governs assembly, not derivation. A computed value
that reads a card the caller could not fetch on its own MUST still carry its
value under every strategy — the value was computed under the realm's own
authority when the card was indexed.

**§11.9** `nonGrantable` keeps an operation out of every policy's reach. A
runtime MUST honor it on every subclass, including one that redeclares the
operation without it.

## 12. Files

**§12.1** A file instance is created by writing bytes at a URL. A runtime MUST
NOT require an upload UI, a browser, or a person for a file instance to exist.

**§12.2** A file's metadata is derived from its bytes. A runtime MUST treat a
file's metadata fields as read-only, and MUST derive them rather than accept
them from a caller.

**§12.3** A file def family MAY declare a preview component. A family without
one MUST still render an honest generic pane rather than a broken one.

**§12.4** A file def MUST NOT be `edit`-rendered. It has no editable value, only
bytes. See finding [B-13](boundary-findings.md#b-13).

## 13. What an author may not rely on

These are implementation, and a card that depends on them is not portable:

- Which process or service rendered or indexed a card.
- Which format a runtime prerendered, or when.
- The order two unrelated loads resolved in, or how long either took.
- A class's identity across two loader universes that are not the same loader.
- Any member of the runtime's diagnostic surface.
- A runtime's internal mode, submode, or context names.
- A stored document's field ordering, key ordering, or which optional keys it
  chose to omit.
- That a value the runtime did not track has not changed since the last read.
