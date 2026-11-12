# The Card Contract

This is the specification of what a card is.

It has two purposes:

1. **To card authors.** It says what a card may depend on, so a card written
   today still works after the runtime underneath it changes.
2. **To runtime implementers.** It says what a card runtime environment must
   provide, so a new implementation can run cards written for this one.

Those two purposes are served by one document because they are the same
boundary seen from each side. Everything the runtime promises a card belongs to
the contract; everything the runtime does to keep the promise belongs to the
implementation.

## Chapters

| Chapter                                     | What it answers                                                             |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| [Vocabulary](vocabulary.md)                 | What a card is: definitions, instances, documents, renderings, and realms.  |
| [The author API](author-api.md)             | What a card author writes, and what a user sees as a result.                |
| [The runtime contract](runtime-contract.md) | What the enclosing card runtime environment must provide.                   |
| [Conformance](conformance.md)               | What a new runtime must implement, and what it may leave out.               |
| [Boundary findings](boundary-findings.md)   | Where the boundary is currently blurred, with proposals and open questions. |

## Normative language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" are to be interpreted as
described in BCP 14 (RFC 2119, RFC 8174) when, and only when, they appear in
all capitals. This is the same convention [ADR 001 §1](../adr/001-record-architecture-decisions.md)
uses. Each chapter numbers its own requirements, so a citation names the
chapter: "Card Contract author API §4.2", "Card Contract runtime §6.5",
"Card Contract conformance §3", the way an ADR requirement is cited as
"ADR 004 §1.2".

A requirement here is binding on new code in the same way a `proposed` ADR's
is. [ADR 032](../adr/032-define-the-card-contract-as-the-boundary-between-card-code-and-its-runtime.md)
records that decision and names the code this document governs.

### Requirement status

The contract states the boundary as it is meant to be, which the reference
runtime does not yet fully meet. A requirement that links a finding in the
[register](boundary-findings.md) is not met today; the finding says how far off
it is. Every other requirement is believed to hold of the reference runtime,
and a counterexample is a new finding. [remediation/032.md](../adr/remediation/032.md)
lists, by file, the code that does not meet the contract yet.

## The boundary test

Every claim in this document is a decision about which side of a line it is on.
Two tests decide the line.

### The replacement test

Imagine replacing one piece of the runtime with a different one: a different
renderer, a different index, a different storage layout, a different module
loader, a different host UI. Now ask whether anything a card author wrote
changes — the code they wrote, or what their card looks like, or what their
card can do.

- If nothing they wrote changes, that piece was **implementation**. The runtime
  is free to change it.
- If something they wrote changes, it was **interface**, whether or not anyone
  wrote it down.

Apply it honestly and some pieces come out as interface even though they feel
like implementation. The clearest is the component model: every card's
templates are Glimmer components, so a runtime with a different renderer cannot
run them, and the contract says so ([author API §5.11](author-api.md)) rather
than listing "the renderer" as replaceable. What stays replaceable is
everything around it: template compilation, render scheduling, style scoping,
and the host UI.

### The promise test

The interface is everything a card can depend on. It is not only the documented
API. A card that renders differently because the prerenderer always runs before
a live view depends on a scheduling detail; a card that reads
`context.canInvoke` depends on an API. Both are promises the runtime has made,
and an undocumented promise is the harder kind, because nobody decided it.

A promise becomes interface in three ways, and the contract treats them
differently:

| Kind                | Meaning                                                                  | What the contract does                                              |
| ------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| **Stated contract** | The runtime promises it, on purpose, in this document.                   | States it as a requirement, and tests it.                           |
| **Leak**            | Cards depend on it today, but it is a detail of how we keep the promise. | Names it, and proposes either a real contract or a way to hide it.  |
| **Unstated gap**    | Cards need to know something, and nothing says it either way.            | Names it as an open question with the options and a recommendation. |

Something may also be deliberately **frozen**: the contract says nothing on
purpose, so the runtime keeps the freedom. "No promise is made here" is a
decision, and the contract says so where the freedom matters.

### What the test is not

The test does not say that a card must be unaffected by every change. A card
that depends on its own realm's URL is affected when that realm moves, and that
is fine — the contract says which identities are durable and which are not. The
test asks whether the thing a card depends on is a **decision the runtime makes
on purpose** or an **accident of how it currently works**.

## Shrink, then state

The contract is the smallest surface that makes a coherent card model. It is
not a transcription of what the reference runtime exposes today, and where the
two differ, the contract argues for removal before it codifies anything.

- **One route per job.** Where a card can get one answer two ways, such as a
  permission, a query, a write, or a realm's address, the contract keeps one
  and the register records the other for removal
  ([runtime contract §1.4](runtime-contract.md)).
- **Use earns a place.** A member no card uses is the cheapest one to remove,
  and the register looks for those first. A member that only one host reads
  belongs to that host.
- **Aliases end.** A renamed member keeps its old name only with a sunset: a
  date, and a count of the realms still reading it.
- **The lists are the contract.** The modules a card may import
  ([author API §1.9](author-api.md); third-party packages are open-ended, and
  wait on package management), the instance surface (§7.8), the template
  arguments (§5), and the context members (§10) are enumerated. A name a card
  can reach that is not on a list is a leak (ADR 032 §1.2).

[The register's summary table](boundary-findings.md#what-the-register-proposes-to-remove)
collects what this stance removes.

## The base realm

`@cardstack/base` holds two kinds of module, and the contract treats them
differently ([B-33](boundary-findings.md#b-33)):

- **Author API modules** are part of the runtime: `card-api`, `operations`,
  `helpers/`, the primitive field defs and file-def families, and the default
  templates. They implement the contract, so they MAY use platform-only
  members. They MUST NOT depend on one host, because every runtime ships them.
- **Library cards** (`cards-grid`, `workspace`, `spec`, `skill`, `theme`, and
  the rest) are cards. They get exactly what any card gets. A library card that
  reaches past the contract is a finding, not a precedent.

## What this document is not

- It is not an API reference. The authoritative signatures are in
  `packages/base/card-api.gts` and `packages/base/operations.ts`. This document
  states what those signatures mean and which parts of them a card may rely on.
- It is not a design history. Decisions with rejected alternatives belong in
  [ADRs](../adr/README.md).
- It is not a plan. Each finding in [Boundary findings](boundary-findings.md)
  that gets accepted becomes an ADR and a ticket; the finding itself stays here
  as the record of the boundary.
- It is not a replacement for the concept docs in [`docs/`](../README.md). Those
  explain how a feature works. Where one of them states something the contract
  now states better, the finding register says so.

## Naming

This document is called a _contract_, not a _spec_, on purpose. `Spec` in this
codebase already names a card type — the card that documents an exported
definition ([docs/spec.md](../spec.md)). "Card spec" would mean two different
things in one repository.
