# The runtime contract

This chapter states the contracts between a user-authored card and the card
runtime environment around it. It is written for someone implementing a runtime:
each section says what the environment MUST provide, what it MAY decide for
itself, and what a card is allowed to observe.

A contract here is a two-sided obligation. The environment MUST make it true; a
card MUST NOT reach past it.

## 1. The boundary

**§1.1** A card and its environment communicate through exactly five channels:

| Channel     | Card side                                 | Environment side                     |
| ----------- | ----------------------------------------- | ------------------------------------ |
| Modules     | Imports and exports.                      | Resolution and fetch.                |
| Definitions | Classes, fields, templates, declarations. | Loading, tagging, lowering.          |
| Instances   | Reading and writing fields.               | The store, reactivity, settle.       |
| Documents   | Nothing directly.                         | Serialization, the realm's HTTP API. |
| Context     | Asking for a service or an answer.        | Providing it, or answering unknown.  |

**§1.2** Anything a card reaches through another channel is a leak. The test is
§1.1: if card code can observe a runtime subsystem directly, that subsystem has
become interface.

**§1.3** A runtime MUST make each channel complete. A card that stays inside a
channel MUST NOT need a second, undocumented way to finish the job.

## 2. The module contract

A card's source is loaded as an ES module. [ADR 010](../adr/010-give-loaded-modules-native-esm-semantics.md)
governs this in full; this section states the parts that are card-facing.

**§2.1** A module the environment loads MUST behave as a native ES module: one
instance per module map key, live bindings, cycles, hoisted function exports,
evaluation order, and error propagation.

**§2.2** Resolution MUST follow the HTML algorithm for a module specifier, with
an import map for bare specifiers. A runtime MUST NOT discover a module by
probing for files during resolution.

**§2.3** A module's base URL, and its `import.meta.url`, MUST be the URL the
environment fetched it from.

**§2.4** Every spelling of one module — a realm prefix, an alias, the real URL —
MUST resolve to one URL, so one module has one set of classes.

**§2.5** A runtime MAY answer a module URL with a pre-evaluated module (a shim).
A shim MUST be identifiable as a shim.

**§2.6** A runtime MUST NOT let card code reach the loader as an object. The
loader's observation APIs, its module map, and its dependency tracking are for
the platform. Where card code needs a dynamic import, it uses `import()`. See
finding [B-07](boundary-findings.md#b-07).

**§2.7** A runtime MUST NOT support CommonJS as a module format a card writes.

**§2.8** The loader is not a security boundary. A runtime MUST NOT claim that a
card is isolated because the loader ran it.

## 3. Definition identity contract

A runtime MUST be able to answer, for any value a card hands it: _which
definition produced this?_

**§3.1** A class a card module exports MUST carry its definition identity: the
canonical identifier of its module and the name it is exported under. A runtime
MUST read this identity rather than infer it from a class name, a constructor's
source text, or the URL a value happened to be fetched from.

**§3.2** A definition a module produces by calling a factory — not by writing a
class — MUST be tagged by an explicit call the author makes. A runtime MUST NOT
recognize such a definition by keeping a list of factories it knows.

**§3.3** A definition's identity MUST NOT depend on the URL a client reached its
realm by. A realm is given its canonical name when it is mounted, and that name
is compiled into the identity.

**§3.4** Two runtimes MUST be able to exchange a definition reference as data: a
code ref of `{ module, name }`. A runtime MUST NOT require both sides to share a
loader.

**§3.5** A runtime MUST NOT tag a value with which runtime produced it. Code
that needs the runtime reads the runtime.

## 4. The document contract

A card document is a JSON:API resource. This is the format a realm stores, an
HTTP response carries, and one runtime hands another.

### Shape

```json
{
  "data": {
    "type": "card",
    "id": "https://example.com/realm/Booking/1",
    "attributes": {
      "title": "Gore Mountain Ski Trip",
      "hosts": [{ "name": "Hassan" }]
    },
    "relationships": {
      "venue": { "links": { "self": "../Venue/gore" } },
      "sponsors.0": { "links": { "self": "../Sponsor/burton" } }
    },
    "meta": {
      "adoptsFrom": { "module": "../booking", "name": "Booking" },
      "fields": {
        "venue": {
          "adoptsFrom": { "module": "./special-venue", "name": "SpecialVenue" }
        }
      }
    }
  },
  "included": [
    { "type": "card", "id": "https://example.com/realm/Venue/gore", "…": "…" }
  ]
}
```

**§4.1** A card resource MUST have `meta.adoptsFrom`, naming the definition it
adopts. A runtime MUST be able to build the instance from the document and the
definition alone.

**§4.2** `contains` and `containsMany` values appear in `attributes`. `linksTo`
and `linksToMany` values appear in `relationships`. A runtime MUST NOT put a
link's target value in `attributes`, and MUST NOT put a contained value in
`relationships`.

**§4.3** A plural link is expressed as one relationship entry per position, with
the position in the key (`sponsors.0`, `sponsors.1`). A runtime MUST preserve
order, and MUST preserve a gap in the positions if the document has one.

**§4.4** A relationship names its target either by `links.self` (a URL, possibly
relative) or by `data` with `id` or `lid`. A runtime MUST accept both and MUST
say which it produced.

**§4.5** A relative `links.self` MUST be resolved against the `links.self` of
the document's primary resource. This is a deliberate narrowing of JSON:API,
which does not define it.

**§4.6** A computed field's value MUST NOT appear in a stored document. A
runtime MAY include a computed's value in a served document, and MUST label it
as such where its absence would be mistaken for emptiness.

**§4.7** A document's `meta.fields` records per-instance field overrides. A
runtime MUST apply them to every reader of the instance, including search.

**§4.8** A document MAY be **sparse**: it carries only some fields. A sparse
document MUST be marked as sparse, and a runtime MUST NOT deposit one into a
store as the instance. The same rule applies to a document whose relationships
were withheld: it says nothing about links, which is not the same as linking to
nothing.

**§4.9** A document MAY carry server-owned `meta`: realm identity, modification
times, the index generation it was read at, a content fingerprint of its source
bytes, its captures, and an error entry. A runtime MUST strip server-owned meta
from an incoming write and MUST NOT persist it into the source file.

**§4.10** A runtime MUST distinguish three things a document can mean, and MUST
make each visible: a field that is empty, a field that was not loaded, and a
field whose links were withheld.

### Media types

**§4.11** A realm serves and accepts card documents under media types it
declares. A runtime MUST treat the media type as part of the contract: a request
for a card's source, its data, its rendering, and its file metadata are four
different resources, and each has its own type.

**§4.12** An operation invocation is a JSON:API document extended with an
`invoke` verb and an operations member, named by a media type extension. A
runtime MUST validate the extension before treating a plain JSON:API body as an
invocation.

## 5. Instance ↔ document contract

**§5.1** Deserializing a document MUST produce an instance whose fields read the
document's values, and whose computed fields evaluate on read.

**§5.2** Serializing an instance MUST produce a document that, deserialized,
reads the same. A runtime MUST NOT lose a field value through a round trip, and
MUST NOT invent one.

**§5.3** A runtime MUST give every instance in a document the same base
(`relativeTo`) as the primary resource, so a field value's own relative links
resolve.

**§5.4** A runtime MUST represent a link to a resource it could not load as a
broken link, carrying the reference it tried to resolve. A card MUST be able to
detect it and MUST be able to show the reference.

**§5.5** A runtime MUST NOT silently replace a broken link with an empty field.

## 6. The store contract

The store is the environment's answer to "what cards are there, and what do they
say?". A card reaches it through the context, never through a network object.

### What a store MUST provide

**§6.1** A store MUST resolve a reference to a fetchable URL, canonicalize an
id to its portable form, name the realm a reference belongs to, and give the
URL a browser can open. These four complete the identity boundary described in
§7.

**§6.2** A store MUST load a card document and a file-meta document by
reference, and MUST return an error resource rather than throwing when the
reference cannot be fetched.

**§6.3** A store MUST let a card ask whether it is done: whether every load the
card started has resolved. A card MUST be able to await that.

**§6.4** A store MUST track a load a card started, including one the card starts
and abandons, so "the card is up to date" has one meaning.

**§6.5** A store MAY hand back an instance it already holds in place of a fresh
load. It MUST do so only when it can promise that what it holds still reflects
the realm — because it drops what it holds when its view moves, or reloads it
when the realm says the file changed. A store with no opinion MUST say so, and
the caller loads.

**§6.6** A store MUST honor a caller's request not to be tracked, and MUST treat
declining as harmless — an extra settle pass, nothing else.

### What a store MAY add

**§6.7** A store's diagnostic surface — what is in flight, what was slow, which
queries are outstanding — is platform-facing, not card-facing. A runtime MUST NOT
require a card to read it, and a card MUST NOT depend on it being there. See
finding [B-10](boundary-findings.md#b-10).

## 7. The identity boundary

**§7.1** Identifiers travel in canonical form (an RRI, prefix or URL). A runtime
resolves them to real URLs only at the network boundary.

**§7.2** A card MUST NOT construct a URL from an identifier. A runtime MUST
provide the four operations in §6.1 so the card never needs the mapping table.

**§7.3** A runtime MUST NOT require a card to know which realms are registered,
or which prefix maps to which URL. A runtime that has no mappings MUST still
answer §6.1 — with the reference unchanged, or with `undefined` — rather than
throw.

**§7.4** A realm with no registered prefix is named by the URL it is served at.
Nothing in this contract requires a realm to have a prefix.

## 8. The rendering contract

**§8.1** A runtime renders an instance by resolving its format component up the
adoption chain and instantiating it with the arguments in
[author API §5](author-api.md). A runtime MUST cache the component for one
instance and format, so a reactive re-render does not remount the card's tree.

**§8.2** A runtime MUST render a card's fields through the field's own format
resolution, and MUST pass the field's name to the field's template.

**§8.3** A runtime MUST render in a context that provides no interactive
services. A prerendered rendering MUST be a complete, valid rendering of the
card with those services absent — not a degraded one the card apologizes for.

**§8.4** A runtime MAY serve a captured rendering instead of rendering live, and
MUST NOT require a card to know which it got. A card that must know — because it
offers an edit control — MUST learn it from an answer the environment gives, not
from timing or from which component it was handed.

**§8.5** A runtime that serves a captured rendering MUST keep the card's scoped
styles with it, as first-class resources, and MUST give them stable identities.

**§8.6** A runtime MUST render a card that failed as an error rendering, carrying
the error, and MUST NOT render it as an empty card.

## 9. The reactivity and settle contract

**§9.1** Writing a field MUST invalidate every reader of that field, including a
reader that reached it through a computed or a link.

**§9.2** Reading a field MUST register the read, so a later write to it
re-invalidates the reader.

**§9.3** A runtime MUST define "settled": every load the render started has
resolved, and every invalidation those loads caused has been applied. A runtime
MUST let a caller await settled, and MUST NOT let a caller mistake a quiet moment
for settled.

**§9.4** A runtime MUST bound a settle wait that cannot complete — a link to a
realm that will not answer — and MUST report what it was waiting on.

**§9.5** A runtime MUST NOT require a card to signal that it is done loading.
The card's reads are the signal.

## 10. The index and search contract

**§10.1** A runtime indexes a card by rendering it and deriving a search
document from the instance's field values. A card MUST NOT have to declare
anything to be indexed.

**§10.2** A search document holds the card's queryable values under field
names, plus the runtime's synthetic keys. A query grammar an author writes MUST
address fields by the card's own names.

**§10.3** A runtime MUST keep the client-side matcher and the index query
engine in parity: a filter written once MUST match the same cards whether the
index answered it or a local pass did.

**§10.4** A runtime MUST record what a render depended on — the instances and
modules it touched — and MUST invalidate the card when a dependency changes.

**§10.5** A query names: the realms to search, a filter tree, a sort, a page,
and optionally which fields to return. A runtime MUST reject a malformed query
with an error that names the offending part.

**§10.6** A search result is delivered as entries, each able to reference the
card's data (`item`), its renderings (`html`), and its type descriptor (`icon`).
A runtime MUST let a caller ask for data only, and MUST say what a data-only
result withheld.

**§10.7** A runtime MUST say when a search result is incomplete — a realm that
failed, a merge that gave up — and MUST NOT present a partial result as a whole
one.

**§10.8** A runtime MAY cache a search. A cache hit MUST report the same result
shape as a miss, or MUST say that it reported none.

**§10.9** A runtime MAY narrow the link shape a result carries, based on the
load it is under. It MUST record that it did, and MUST record why.

## 11. The operations contract

**§11.1** An operation is dispatched by name against a target, by an actor. A
runtime MUST resolve the target's def family, its adoption chain, and the
operations it carries — implied and declared — before running anything.

**§11.2** A runtime MUST lower a saved declaration into an executable program at
index time, and MUST record any lowering issue with a code a caller can read.

**§11.3** A runtime MUST decide authorization before running, and MUST run the
decision against the state as it is then — not against what an earlier advisory
answer predicted.

**§11.4** A runtime MAY answer a capability question ahead of an invocation so a
UI can hide a control. Such an answer MUST be advisory, MUST be able to say
unknown, and MUST NOT be the enforcement.

**§11.5** A runtime MUST be able to run a batch of operations as one commit, so
a card's multi-step write either all happens or none does.

**§11.6** An operation that writes MUST answer once the write is durable, and
MUST give back the document the write produced.

**§11.7** A runtime MUST refuse an invocation with a code, not a status alone.
A card MUST be able to branch on the code.

## 12. The realm contract

A realm is the environment's storage. A compatible runtime implements this to
interoperate with existing cards and existing realms.

**§12.1** A realm MUST serve, for one card: its data, its source, and its
renderings, as three resources with three media types.

**§12.2** A realm MUST support create, read, update, and delete of a card
document, and MUST reject a write that would corrupt the document's shape.

**§12.3** A realm MUST serve a search over its cards, and MUST support a
federated search across realms.

**§12.4** A realm MUST report its own identity and its registered prefixes, so
a client with no mapping table of its own can build one.

**§12.5** A realm MUST broadcast the changes it made, so a live runtime can
invalidate what it holds.

**§12.6** A realm MUST enforce permissions at the request boundary, and MUST
distinguish "you are not signed in", "you may not do this", and "this realm is
closed".

**§12.7** A realm MUST report indexing errors and the state of indexing work it
has accepted.

**§12.8** A realm MUST serve a card's declared captures at durable URLs.

**§12.9** A realm MUST NOT serve a resource that reveals another realm's data
because a path happened to reach it. URL routing is the server's rules, not
realm code ([ADR 015](../adr/015-express-realm-url-routing-as-rules-the-server-interprets-never-as-realm-code.md)).

## 13. The error contract

**§13.1** A failure to load a card MUST be a value a runtime can carry, not an
exception a caller must catch at every level. A runtime MUST be able to render
the failure in the card's place.

**§13.2** A failed card MUST keep its last known-good rendering where one exists,
and MUST mark it as stale rather than present it as current.

**§13.3** An error resource MUST carry enough to explain the failure to a person
who cannot see the runtime: what was tried, and what went wrong.

**§13.4** A runtime MUST NOT put secrets, credentials, or another realm's data
in an error it serves.

**§13.5** A runtime MUST distinguish a card that failed to render from a card
that does not exist, and MUST NOT let one stand in for the other in search.

## 14. The authority contract

**§14.1** A card is not a security boundary. A card's templates, computeds, and
operations run with the environment's authority, and a runtime MUST NOT treat a
card's own checks as enforcement.

**§14.2** A runtime MUST NOT hand a card a credential it could send. Where an
operation needs one, the environment attaches it after it has checked where the
request is going.

**§14.3** A runtime MUST keep the secrets a card declares unreachable from the
card's code, including from a template and a computed.

**§14.4** A card MAY be told whether a person may act, and MUST be told that the
answer is advisory. A runtime MUST decide again at invocation.

## 15. The determinism contract

**§15.1** A runtime MUST give the same card, the same data, and the same instant
the same rendering. Where a runtime cannot — because the card read the clock or
the realm's state — it MUST make that the card's only way to be non-deterministic.

**§15.2** A runtime MUST provide a clock seam a caller can pin, and MUST make a
card's clock reads go through it.

**§15.3** A runtime MUST NOT let one render observe two different values for one
field.

**§15.4** A runtime MAY reorder or coalesce loads. It MUST NOT let that change
what a settled render contains.

## 16. What a runtime decides for itself

The contract makes no promise about any of these, and a runtime is free to
change all of them:

- Whether a card is rendered live, prerendered, or both, and when.
- Which process renders, which pool it came from, and which browser ran it.
- How the index is stored, and how it is invalidated.
- How modules are compiled, cached, and discarded.
- How a search is cached, and how a load's shape is narrowed under pressure.
- How a document is stored on disk or in a table.
- How a card's styles are scoped and rewritten.
- Which host UI surrounds a card, and what its modes are called.
- Every diagnostic the runtime records about its own work.
