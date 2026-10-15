# Architecture Decision Records

An ADR records one architectural decision: the context that forced it, what we
chose, the options we rejected, and the consequences. Skills and `AGENTS.md`
say _how_ to work in this codebase; ADRs say _why_ it is shaped the way it is,
so that people and agents can tell a deliberate choice from an accident before
they change it.

Load the `adr` skill (`.claude/skills/adr/SKILL.md`) to write, supersede, or
backfill an ADR.

## When to write one

Write an ADR when a decision is any of:

- hard or expensive to reverse,
- cross-cutting (it constrains more than one package or subsystem),
- a choice between viable alternatives, or
- something a reviewer would push back on if a later change violated it.

Most PRs need none. A PR's "Key decisions" section explains choices local to
that PR; an ADR is for the ones that outlive it.

## Lifecycle

- `proposed`: drafted, usually in the PR that makes the decision. Anyone,
  including an agent, can propose.
- `accepted`: a maintainer has reviewed it and agrees. Only a person moves an
  ADR to `accepted`.
- `superseded`: a later ADR replaced it. Set `superseded-by`; the new ADR sets
  `supersedes`.
- `deprecated`: no longer applies and nothing replaced it.

An accepted ADR's decision is not edited. To change a decision, write a new ADR
that supersedes it. Fixing typos, broken links, and `scope` globs after a file
move is fine.

Retroactive ADRs record decisions made before this log existed. They carry
`retroactive: true`, the original decision `date`, and the `recorded` date.

## Conventions

- File name: `NNNN-kebab-case-title.md`, numbered sequentially from `0001`.
  Copy [`template.md`](template.md).
- `scope` lists the globs a decision governs. Before changing code in an area,
  check for ADRs that cover it:
  `grep -l 'packages/postgres' docs/adr/[0-9]*.md`.
- This repository is public. ADRs cite commit SHAs, PR numbers in this
  repository, and file paths. They never cite private-tracker IDs, production
  data, or user data.

## Index

| ADR                                           | Title                         | Status   |
| --------------------------------------------- | ----------------------------- | -------- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | proposed |
