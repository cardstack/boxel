---
status: proposed
date: 2026-11-11
scope:
  - packages/base/**
  - packages/runtime-common/**
  - packages/host/app/**
  - eslint/**
---

# 032. Define the card contract as the boundary between card code and its runtime

A card is durable when it keeps working after the runtime underneath it changes.
That durability depends on a boundary nobody has written down: what the runtime
promises a card, versus what it does to keep the promise. This ADR fixes the
boundary at five channels, makes [docs/card-contract/](../card-contract/README.md)
the normative statement of what sits on each side, and treats an author-facing
name with no stated semantics as a defect.

## 1. Decision

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" are to be interpreted as
described in BCP 14, as in ADR 001 §1.

### 1.1. Five channels

A card and its environment communicate through five channels: modules,
definitions, instances, documents, and context. Card Contract
[runtime contract §1.1](../card-contract/runtime-contract.md) states them.

A runtime MUST make each channel complete. A card MUST NOT need a sixth.

### 1.2. Anything else is a leak

A card that reaches a runtime subsystem directly has made that subsystem
interface. A runtime MUST NOT require it, and MUST NOT rely on a card not doing
it.

A name a card can reach that Card Contract does not list is a leak. A review of
a change that adds one is a blocking finding.

### 1.3. No author-facing name without semantics

Every option, static, format name, field option, and context member an author
may write MUST have stated semantics, and a runtime that produces them.

An author-facing option a runtime ignores is a defect, not a roadmap item. A
runtime MUST either implement it or remove it from the author API.

### 1.4. A runtime's own vocabulary stays out of the author API

A runtime MUST NOT name these in what a card sees: its host UI modes and
submodes, its index's synthetic keys, its module loader, its storage layout, its
render or capture pipeline parameters, and its diagnostic surface.

Where a card genuinely needs what one of them provides, the runtime MUST offer
the concept instead, in terms that survive replacing the thing that provides it.

### 1.5. Platform-only members are typed separately

A runtime keeps its own surface out of the contract by giving it a separate type
a card cannot import. A runtime MUST NOT mark a member platform-only by
convention while leaving it on the interface a card reads.

### 1.6. A rule a card must follow is stated in the contract

A rule that decides whether card code is correct MUST be stated in Card
Contract, not only in a lint rule, a code comment, or an example an author
happens to copy. A lint rule then enforces a contract; it MUST NOT be the only
place the rule lives.

### 1.7. Card Contract is normative over the concept docs

Where a doc in `docs/` states a card semantic that contradicts Card Contract,
the doc MUST be corrected to match, or MUST say that it describes one runtime's
behavior rather than the contract.

### 1.8. A new author-facing name is added to the contract first

A change that adds a format name, a field option, a context member, an operation
name, or an instance member that a card can use MUST add it to Card Contract in
the same change. A name a runtime adds for itself, which a card may not use, is
not covered by this requirement.

### 1.9. Each finding gets a decision

Each entry in the [boundary findings register](../card-contract/boundary-findings.md)
SHOULD end as a contract edit, an ADR, or a code change that closes it. An entry
SHOULD NOT be closed by deleting it from the register without one.

## 2. Rationale

Cards are the public surface of this product, and they outlive the runtime that
first ran them. A card written today is read next year by a runtime we have not
built, in a host whose UI we have not designed.

Most of what a card depends on today was never decided. The prerenderer renders
before a live view, so a card that reads a capability answer as "no" when it
means "not yet" renders wrong; nobody chose that. `form` is in the `Format` type
a card's templates are keyed by because one host chooser needed a value for its
menu; nobody chose that either. `_cardType` appears
in card-authored filters because the index stores a card as two rows; that is a
storage decision leaking into a query grammar.

Each of these is cheap to fix while it is one card and cheap to leave alone
while it is one card. It stops being cheap when a second runtime, a second host,
or a second index has to honor it. The boundary test in Card Contract decides
each case once, in writing, so the next person does not decide it again by
accident.

The five channels are the ones that already exist. Nothing here adds a channel;
the decision is that they are the only ones, which is what makes §1.2 checkable.

## 3. Considered options

- **Fix each leak as it is found, with no boundary document (rejected).** Each
  fix is defensible alone and the set has no shape. A later change re-introduces
  a fixed leak because nothing records why it was hidden.
- **Make the current `packages/base/card-api.gts` exports the contract (rejected).**
  That is the interface we have, including the parts that are mechanism: `Box`,
  the store's diagnostics, `import.meta.loader`, host mode names. It freezes the
  implementation.
- **Freeze the contract now and version it (rejected for now).** The boundary is
  not yet stable enough to version, and a frozen contract would block the fixes
  this ADR asks for.
- **Keep the concept docs as the normative source (rejected).** They describe how
  one feature works today and already contradict the code in three places a card
  author would act on.
- **Let lint rules carry these rules (rejected).** A lint rule says a thing is
  disallowed and gives a reason tuned to one build. It cannot say what a card
  may rely on, and a runtime that cannot compile non-erasable syntax would look
  broken rather than conforming.

## 4. Consequences

Card Contract becomes the place a review cites. A change that adds an
author-facing name without a contract edit is a finding, and a change that
removes one without a sunset plan is one too.

The findings register is a finite list of work. Each entry that becomes a code
change leaves the code and stays in the register, so the boundary it protects is
not re-broken.

## 5. Remediation

Known gaps are listed in [remediation/032.md](remediation/032.md).
