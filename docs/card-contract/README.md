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
uses, so a requirement here can be cited as "Card Contract §4.2" the way an ADR
requirement is cited as "ADR 004 §1.2".

A requirement here is binding on new code in the same way a `proposed` ADR's
is. [ADR 032](../adr/032-define-the-card-contract-as-the-boundary-between-card-code-and-its-runtime.md)
records that decision and names the code this document governs.

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
