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

| ADR                                                                          | Title                                                                             | Status   |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------- |
| [001](001-record-architecture-decisions.md)                                  | Record architecture decisions as short, normative ADRs                            | proposed |
| [003](003-reach-cloud-services-through-adapters.md)                          | Reach proprietary cloud services only through adapters                            | proposed |
| [005](005-authorize-key-changes-only-with-a-session-card-code-cant-reach.md) | Authorize changes to a user's keys only with a session that card code can't reach | proposed |
| [007](007-keep-motion-a-reactive-layer-that-state-never-waits-on.md)         | Keep motion a reactive layer that application state never waits on                | proposed |
| [009](009-build-new-ui-with-pret-ui-not-boxel-ui.md)                         | Build new UI with Pret UI, and deprecate boxel-ui                                 | proposed |
