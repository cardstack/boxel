---
status: proposed
date: 2026-10-15
scope: [docs/adr/**, .claude/skills/adr/**]
---

# 0001. Record architecture decisions

## Context

Much of the work in this repository is done by AI agents. Each session starts
without the team's memory of why the codebase is shaped as it is. Skills and
`AGENTS.md` encode many rules ("never add a copy to `packages/base`", "put
drops in `migrations-removal/`"), but rarely the reasoning behind them or the
alternatives already rejected. Without that reasoning, an agent cannot tell
whether a rule applies to an unusual case. Agents also re-propose rejected
designs and "fix" deliberate choices, and reviewers have to explain the same
history again.

Design docs in `docs/` describe how subsystems work, and implementation plans
live on the issue tracker. Neither is a durable, indexed record of individual
decisions.

## Decision

Record architecture decisions as Markdown files in `docs/adr/`, numbered
sequentially and following the template in `docs/adr/template.md`. The template
is a condensed form of MADR. Each ADR declares `scope` globs for the code it
governs. Agents draft ADRs through the `adr` skill. A person accepts them.

## Considered options

- **ADRs in the repository (MADR-style)**: versioned with the code, reviewed in
  PRs, and readable by agents with plain file tools. "Considered options" keeps
  rejected alternatives on record.
- **Nygard's original template**: shorter, but has no place for rejected
  alternatives.
- **Decisions on the issue tracker or a wiki**: the tracker is private while the
  repository is public, and agents working in a checkout cannot reach it
  reliably.
- **Extending skills with rationale**: skills are procedures loaded on demand.
  Mixing in history makes them longer and blurs which parts are rules.

## Consequences

- Architectural PRs gain a step: decide whether the change warrants an ADR, and
  draft one if so.
- Because drafting is cheap for agents, the bar in `docs/adr/README.md` keeps
  the log small enough to read. ADRs nobody reads are worth nothing.
- Skills can link to the ADR behind a rule, rather than restating the
  reasoning.
- Retroactive ADRs need a person to confirm any rationale no source records.
  Writing down a plausible but invented reason would be worse than having no
  ADR.
- Revisit if the log grows past what people read, or if accepted ADRs drift
  out of date with the code.
