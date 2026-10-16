# Architecture Decision Records

An ADR records one architectural decision: the rules it sets, why, and the
options it rejected. Skills and `AGENTS.md` say _how_ to work in this
codebase. ADRs say _why_ it has its shape, so that people and agents can tell
a deliberate choice from an accident before they change it.

[ADR 001](001-record-architecture-decisions.md) defines the format, the
lifecycle, and enforcement. Start a new ADR from [`template.md`](template.md),
and load the `adr` skill (`.claude/skills/adr/SKILL.md`) to write, supersede,
or backfill one.

## Index

| ADR                                                                  | Title                                                                                     | Status   |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------- |
| [001](001-record-architecture-decisions.md)                          | Record architecture decisions as short, normative ADRs                                    | proposed |
| [002](002-keep-identifiers-canonical-resolve-at-network-boundary.md) | Keep identifiers as canonical RRIs, and resolve them to URLs only at the network boundary | proposed |
