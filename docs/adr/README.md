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
| [005](005-authorize-key-changes-only-with-a-session-card-code-cant-reach.md) | Authorize changes to a user's keys only with a session that card code can't reach | proposed |
| [007](007-authorize-external-clients-through-boxel-oauth.md)                 | Authorize external clients through Boxel OAuth                                    | proposed |
