# Vocabulary: what a card is

A card is not one thing. It is one idea carried in four representations, and
most confusion in this system comes from using one word for all four. This
chapter fixes the terms the rest of the contract uses.

## 1. The four representations

| Representation | What it is                                                        | Where it lives                                | Who owns it                                     |
| -------------- | ----------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| **Definition** | A class exported from a module. It declares fields and templates. | A realm's source file, or a loaded module.    | A card author.                                  |
| **Instance**   | A live object in a runtime: readable, writable, reactive.         | A runtime's memory.                           | The runtime.                                    |
| **Document**   | A JSON:API resource: the card's stored, transferable data.        | A realm file, an HTTP response, an index row. | The runtime, per the shape this contract fixes. |
| **Rendering**  | The HTML a card produces in one format.                           | The index, or a live DOM.                     | The runtime.                                    |

A fifth, the **search document**, is a projection of an instance's field values
into the index's queryable form. It is derived, not stored by an author.

**§1.1** A card author MUST write definitions. Everything else is produced by a
runtime from the definition and the author's data.

**§1.2** A runtime MUST treat these as distinct. A document is not an instance:
it has no computed values until something evaluates them. A rendering is not a
document: it is one format's output at one moment. An instance is not a
definition: two instances of one definition hold different data.

**§1.3** A runtime MUST NOT let one representation stand in for another where
the difference is observable. A card built from a sparse document is not the
same card as one built from a full document (see
[runtime contract §4](runtime-contract.md)).

## 2. Definitions

**Definition** — a class exported from a module, extending one of the base
classes the card API provides. A definition is also called a **card type** when
it is a `CardDef` subclass.

**Def family** — which base class a definition extends. The families are:

| Family | Base class | Addressable? | What it is for                                                     |
| ------ | ---------- | ------------ | ------------------------------------------------------------------ |
| Card   | `CardDef`  | Yes          | A thing with its own identity and URL.                             |
| File   | `FileDef`  | Yes          | A realm file, with content-derived metadata.                       |
| Field  | `FieldDef` | No           | A value inside a card or another field.                            |
| Base   | `BaseDef`  | Yes          | The shared root of all three; a definition of its own only rarely. |

**§2.1** **Addressable** means: the def's instances have an id that a realm
serves, so they can be linked to, fetched, and carry operations. A field is not
addressable. A field value has no URL of its own; it is reached through its
owner.

**§2.2** Addressability is a property of the family, and a runtime MUST NOT
offer an address to a field instance. Where a runtime needs to name a field
value (a search filter path, an operation's field patch), it names it as a path
through its owner, never as a resource.

**Export name** — the name a definition is exported under. Together with its
module, it identifies the definition. A definition with no export name has no
identity a document can record.

## 3. Modules and realms

**Module** — a source file the runtime loads as an ES module. Card definitions
live in modules. See [runtime contract §2](runtime-contract.md).

**Realm** — a URL-addressable store of files: code, card documents, and assets.
A realm serves reads, writes, directory listings, and queries over them. See
[docs/realm.md](../realm.md).

**Well-known realm** — a realm registered under a prefix (`@cardstack/base/`,
`@cardstack/catalog/`) so its resources are named portably instead of by the
URL one deployment serves them at.

**Realm Resource Identifier (RRI)** — the name of any card instance, module, or
file, in either prefix form or URL form. See
[docs/realm-resource-identifiers.md](../realm-resource-identifiers.md) and
[ADR 002](../adr/002-keep-identifiers-canonical-resolve-at-network-boundary.md).

## 4. Instances and identity

**Instance** — one value of a definition, held by a runtime.

**id** — the instance's address: an RRI a realm serves. An instance with no id
is unsaved.

**localId** — a runtime-private tag that distinguishes two unsaved instances.
It is not part of the contract: no document carries it, and no runtime may
assume another runtime assigns the same one.

**Saved** — whether an instance has an id. A runtime MUST answer this from the
instance, not from which store handed it over.

**Adoption** — an instance being a value of a definition. **Adoption chain** —
the definitions from the instance's own type up through its ancestors. A
document records its own type and, through it, the whole chain.

**Field** — a named value slot a definition declares. Four relationships exist
between a def and its field's value:

| Field type     | Value lives            | Value has identity | Serialized as                         |
| -------------- | ---------------------- | ------------------ | ------------------------------------- |
| `contains`     | Inside the owner.      | No                 | `attributes.<name>`                   |
| `containsMany` | Inside the owner.      | No                 | `attributes.<name>`                   |
| `linksTo`      | In a realm, elsewhere. | Yes                | `relationships.<name>.links.self`     |
| `linksToMany`  | In a realm, elsewhere. | Yes                | `relationships.<name>.<i>.links.self` |

**Computed field** — a field whose value a definition derives, with a
`computeVia` function. A computed is never stored.

**Query-backed relationship** — a `linksTo` / `linksToMany` whose targets a
declared query resolves, rather than an author choosing them one at a time.

## 5. Formats

**Format** — which of a definition's templates a runtime renders, and how the
rendering is sized. A definition declares one template per format it customizes;
the family's default covers the rest.

The formats are fixed by family, and the list is the contract — see
[author API §5](author-api.md). A format a runtime accepts but no family lists
is a defect, not an extension point.

**Rendering** — the output of one format for one instance at one moment.
**Prerendered rendering** — a rendering captured by the indexer and served from
the index, inert until a live runtime takes it over.

## 6. Operations

**Operation** — a named action a runtime can carry out on or through a def:
`read`, `create`, `update`, `delete`, `query`, `transform`, and the rest. Some
are implied by the def family; some an author declares.

**Base operation** — a behavior the runtime implements. **Declared operation** —
an author's description of a program the runtime runs as part of one.

**Invocation** — one call of one operation against one target by one actor.

## 7. The environment

**Card runtime environment** (the **environment**, or the **runtime**) —
everything outside a card that makes a card work: the module loader, the store,
the renderer, the index, the realm server, the host UI, and the permissions
system.

**Context** — the set of services one render of one card is given. Different
contexts provide different services; a card MUST be able to render in a context
that provides fewer.

The contexts this contract recognizes:

| Context              | Who drives it                    | What it produces                  |
| -------------------- | -------------------------------- | --------------------------------- |
| **Live host**        | A person in a browser.           | A reactive DOM.                   |
| **Prerender**        | The indexer, headless.           | HTML and a search document, once. |
| **Server-side read** | A runtime assembling a document. | An instance, no DOM.              |
| **Script**           | An automation or tool.           | Writes, results, no DOM.          |

**§7.1** A card MUST render in every context it is asked to render in, and MUST
NOT require a service a context does not provide. A runtime MUST NOT require a
card to know which context it is in.

**§7.2** Where a context genuinely cannot answer something — a prerender cannot
know what a later viewer is permitted to do — the contract fixes the answer as
_unknown_, not as a guess. See [author API §10.3](author-api.md).

## 8. Durable vs incidental

**§8.1** These are durable: an instance's id, a definition's module and export
name, a field's name, a format's name, an operation's name, a realm's prefix.
A runtime MUST NOT change any of them without a stated migration.

**§8.2** These are incidental, and a card MUST NOT depend on them: which realm
serves a well-known prefix in a given deployment, which URL a module was
fetched from, which format a runtime chose to prerender, how long a load took,
which process indexed a card, the order two unrelated instances were loaded in,
and any member of the runtime's diagnostic surface.
