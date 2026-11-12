# Conformance

A runtime conforms to this contract by implementing profiles. Each profile is a
complete promise: it either holds end to end or it does not hold. A runtime
MUST name the profiles it implements, and MUST NOT claim one it fails.

**§1** A runtime that implements no profile is not a card runtime. It is a card
reader.

**§2** A runtime MUST say, per profile, which requirements it does not meet,
and MUST make that visible to a card author — because an author's choice of
runtime is a choice about which promises their card gets.

## The profiles

### P1 — Definitions

_Can load a card definition and say what it declares._

Must provide:

- Module loading with native ESM semantics ([runtime contract §2](runtime-contract.md)).
- Definition identity that survives a realm move (§3).
- Field enumeration: name, kind, target def, computed or not, searchable
  declaration, query declaration.
- Format component resolution up the adoption chain.
- Operation declaration enumeration and lowering, with issue codes.

May omit: rendering, indexing, storage, permissions.

A P1 runtime is what an editor, a linter, a documentation generator, or an AI
tool needs.

### P2 — Instances and documents

_Can turn a document into a live card and back._

Requires P1. Must provide:

- The document shape and its media types ([runtime contract §4](runtime-contract.md)).
- Serialize / deserialize round-trip fidelity (§5).
- Broken links as broken links.
- Sparse and withheld documents marked, and never deposited as instances.
- The identity boundary (§7).
- The instance store and the card-facing store (§6).
- Reactivity and settle (§9).

May omit: rendering, search, operations beyond read.

A P2 runtime is what a server-side tool, a CLI, or a migration needs.

### P3 — Rendering

_Can show a card, in every format its family has, in a context with no UI._

Requires P1 and P2. Must provide:

- The format table ([author API §5](author-api.md)) and the family defaults.
- The template arguments, present or honestly absent.
- Scoped styles that do not leak, and travel with a captured rendering.
- Render in a no-service context (§8.3).
- Error renderings.

May omit: interactivity, prerendering, captures.

### P4 — Search

_Can index cards and answer a query the same way the index and a local pass
would._

Requires P1 and P2. Must provide:

- A search document per card, derived from field values including computeds.
- The query grammar, addressed by card field names.
- Client/server parity for one filter (§10.3).
- Dependency recording and invalidation.
- Result completeness reporting.

May omit: federated search, prerendered renderings, captures.

### P5 — Operations

_Can dispatch an operation a card declared, with the realm's decision._

Requires P1, P2, and P4 for `query`. Must provide:

- The implied operations per def family.
- Declaration lowering and execution.
- Names the runtime reserves, refused at declaration time.
- Authorization decided at invocation.
- Batches that commit once.
- Failure codes a card can branch on.

May omit: every operation an author may declare, if it says which it omits.

### P6 — Realm

_Can serve the storage a card runtime and another realm both speak to._

Requires P1–P5. Must provide [runtime contract §12](runtime-contract.md) in
full.

## The conformance corpus

**§3** Conformance MUST be checked with a corpus of cards, not with a description
of them. The corpus MUST be portable: no card in it may name a deployment URL, a
host component, or a runtime-internal name. It imports only realm modules, the
author API, the component model, and icons ([author API §1.9](author-api.md)
items 1–4): no third-party package, since how a runtime obtains one is not yet
stated.

**§4** The corpus MUST cover, at minimum:

| Area         | What a corpus card must exercise                                              |
| ------------ | ----------------------------------------------------------------------------- |
| Fields       | Each field kind; a primitive and a composite field; a plural contained value. |
| Computeds    | A computed read twice in one turn; a computed over a link; a computed link.   |
| Links        | A self-referential link; a relative link; a link to a missing card.           |
| Query fields | A query-backed relationship, `eager: false`; a clamped page.                  |
| Formats      | A card with only defaults; one that overrides `atom` only; a field def.       |
| Overrides    | A per-instance field override, checked in a render and in a search.           |
| Documents    | A sparse document; a withheld-relationships document; a round trip.           |
| Identity     | A prefix-form reference and a URL-form reference for the same card.           |
| Operations   | A declared `transform`; a `read` with `links: 'ids'`; a refused invocation.   |
| Files        | A file def created by writing bytes, not by upload.                           |
| Errors       | A card whose render throws; a card whose link is broken.                      |

**§5** Each corpus card MUST have assertions written as card tests against the
testing API ([author API §15](author-api.md)), so the corpus and an author's own
tests are one language. A runtime MUST be able to run them without the
reference implementation present. Assertions for P1, P2, P4, and P5 MUST NOT
need a DOM; P3's render assertions do. A runtime that passes them all conforms
to the profiles it claims.

**§5.1** Running card tests is not a profile of its own. A runtime MAY run no
card tests. A runtime that runs them MUST implement author API §15 in full, so a
card's tests pass or fail for the card's reasons, not the runner's.

**§6** A corpus card MUST NOT assert an implementation detail. If an assertion
would break when a runtime changes something §16 of the runtime contract lists,
the assertion is wrong, not the runtime.

## Non-conformance

**§7** A runtime MUST NOT extend the contract by adding a name a card can depend
on without adding it here first, and a name a card can reach that this contract
does not list is a leak. [ADR 032 §1.2 and §1.8](../adr/032-define-the-card-contract-as-the-boundary-between-card-code-and-its-runtime.md)
state both rules; this chapter does not restate them.

**§8** A runtime MAY add a name it will not let cards use, on a type a card
cannot import (ADR 032 §1.5). That is how a runtime keeps its own surface out of
the contract.
