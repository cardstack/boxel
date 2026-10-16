---
status: proposed
date: 2026-10-15
scope:
  - docs/adr/**
  - .claude/skills/adr/**
---

# 001. Record architecture decisions as short, normative ADRs

We record each architectural decision as an Architecture Decision Record (ADR)
in `docs/adr/`. An ADR states its decision as checkable requirements, explains
why, and lists the options it rejected. Each ADR declares the code it governs,
so agents and reviewers can find the decisions a change must keep. This ADR
defines the format, the lifecycle, and how ADRs are enforced.

## 1. Decision

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in BCP 14 (RFC 2119, RFC 8174) when,
and only when, they appear in all capitals, as shown here.

### 1.1. When to write an ADR

An ADR SHOULD record a decision that is hard to reverse, constrains more than
one package or subsystem, chooses between viable alternatives, or is one a
reviewer would defend against a later change. A decision that matters only to
one PR SHOULD stay in that PR's description.

### 1.2. File and frontmatter

An ADR MUST be a file at `docs/adr/<number>-<slug>.md`. The number MUST have
three digits and MUST be the next unused number after the highest assigned
one. ADR numbers MUST NOT change or be reused. The slug is the title in kebab
case.

The frontmatter MUST contain:

- `status`: `proposed`, `accepted`, `superseded`, or `deprecated`.
- `date`: the date of the decision.
- `scope`: a YAML list of globs for the code the decision governs, one glob
  per line. `scripts/adr-for.mts` reads it.

A superseding ADR MUST set `supersedes`, and the ADR it replaces MUST set
`superseded-by`. A retroactive ADR (§1.7) MUST set `retroactive: true` and
`recorded`.

Each new ADR MUST add a row to the index in `docs/adr/README.md`.

### 1.3. Structure

The title MUST state the decision as an imperative. A one-paragraph summary
MUST follow the title directly. Sections MUST be numbered, in this order:

| Section            | Presence                                                 |
| ------------------ | -------------------------------------------------------- |
| Decision           | REQUIRED. Includes the BCP 14 boilerplate above.         |
| Rationale          | REQUIRED.                                                |
| Considered options | REQUIRED when viable alternatives existed.               |
| Consequences       | OPTIONAL. Omit unless it adds value beyond the Decision. |
| Open questions     | Retroactive ADRs only, while any question remains.       |
| Sources            | REQUIRED for retroactive ADRs. OPTIONAL otherwise.       |

Section numbers follow the order of the sections present.

### 1.4. Language

The Decision MUST state requirements with the BCP 14 key words. An ADR SHOULD
follow the principles of ASD-STE100 Simplified Technical English:

- Use plain language.
- Use short, direct sentences in active voice.
- State one main idea or requirement per sentence.
- Use one term for each concept.
- Keep established technical terms, code identifiers, commands, quotations,
  and literal output as they are.

Clear, natural writing takes priority over strict ASD-STE100 compliance.

### 1.5. Concision and citation

An ADR SHOULD NOT exceed two pages. The author MUST make a separate pass after
drafting that only deletes text. An ADR MUST NOT restate content the reader can
get from a document it references. Tables and lists SHOULD hold only short,
enumerable facts. Reasoning SHOULD be prose.

Other documents (skills, `AGENTS.md`, code comments, reviews) SHOULD cite a
requirement by ADR and section number, for example "ADR 001 §1.6", instead of
restating it.

### 1.6. Lifecycle

Anyone, including an agent, MAY propose an ADR. Only a person MAY set
`accepted`. An agent MUST NOT.

The Decision of an accepted ADR MUST NOT be edited. A changed decision MUST be
a new ADR that supersedes the old one. Fixes to typos, links, and `scope` globs
after a file moves MAY be made in place. An ADR that no longer applies, with
nothing to replace it, is `deprecated`.

### 1.7. Retroactive ADRs

A retroactive ADR records a decision made before it was written down. Its
`date` MUST be the date of the original decision, and `recorded` the date the
ADR was written.

Each claim about why the decision was made MUST cite a source in Sources: a
commit, a PR in this repository, a file, or an answer from a named person with
its date. A reason that no source states MUST go under Open questions, with the
people to ask. When a person answers an open question, the answer MUST move
into the ADR and be cited in Sources. Considered options MUST
list only alternatives that a source shows were considered.

### 1.8. Public repository

This repository is public. An ADR MAY cite commit SHAs, PR numbers in this
repository, and file paths. An ADR MUST NOT contain private-tracker IDs,
production or staging data, or user data.

### 1.9. Enforcement

A change that breaks a MUST or MUST NOT of an accepted ADR, without a
superseding ADR, is a blocking review finding. A change that departs from a
SHOULD or SHOULD NOT needs a stated reason, and a missing reason is a
non-blocking review finding.

## 2. Rationale

Much of the work in this repository is done by AI agents. An agent starts each
session without the team's memory of why the code has its shape. Skills and
`AGENTS.md` hold many rules, but rarely the reasons behind them or the
alternatives already rejected. Without those, an agent cannot tell whether a
rule applies to an unusual case. It re-proposes rejected designs and "fixes"
deliberate choices.

Requirement key words make each decision something a reviewer or an agent can
check, and they map directly to review severity (§1.9). Numbered sections let
skills and reviews cite one rule precisely. The summary lets a reader decide
quickly whether the rest is relevant. Agents make drafting cheap, so the
concision rules keep the log small enough for people to read. The retroactive
rules exist because an invented reason misleads more than a missing ADR.

## 3. Considered options

- **Short normative ADRs with rationale and rejected options (chosen).** This
  combines a short-RFC style with the parts that record why.
- **Short-RFC ADRs only, with Context and Consequences optional.** These are
  checkable and concise. They have no place for rejected alternatives and no
  rules for sourcing retroactive reasons, which are what agents most need.
- **MADR or Nygard templates.** These are rationale-heavy prose with no
  requirement key words, so compliance is harder to check. Nygard's template
  also has no place for rejected alternatives.
- **Decisions on the issue tracker or a wiki.** The tracker is private while
  the repository is public, and agents in a checkout cannot reach it reliably.
- **Rationale inside skills.** Skills are procedures loaded on demand. History
  makes them longer and blurs which parts are rules.
