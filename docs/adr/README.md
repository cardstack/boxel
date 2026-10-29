# Architecture Decision Records

An ADR records one architectural decision: the rules it sets, why, and the
options it rejected. Skills and `AGENTS.md` say _how_ to work in this
codebase. ADRs say _why_ it has its shape, so that people and agents can tell
a deliberate choice from an accident before they change it.

[ADR 001](001-record-architecture-decisions.md) defines the format, the
lifecycle, and enforcement. Start a new ADR from [`template.md`](template.md),
and load the `adr` skill (`.claude/skills/adr/SKILL.md`) to write, supersede,
or backfill one. A proposed ADR's known gaps are listed in
[`remediation/`](remediation/), one file per ADR.

## Index

| ADR                                                                                             | Title                                                                                     | Status   |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------- |
| [001](001-record-architecture-decisions.md)                                                     | Record architecture decisions as short, normative ADRs                                    | proposed |
| [002](002-keep-identifiers-canonical-resolve-at-network-boundary.md)                            | Keep identifiers as canonical RRIs, and resolve them to URLs only at the network boundary | proposed |
| [003](003-reach-cloud-services-through-adapters.md)                                             | Reach proprietary cloud services only through adapters                                    | proposed |
| [004](004-federate-realm-servers-each-paired-with-its-own-homeserver.md)                        | Federate realm servers, each paired with its own Matrix homeserver                        | proposed |
| [005](005-authorize-key-changes-only-with-a-session-card-code-cant-reach.md)                    | Authorize changes to a user's keys only with a session that card code can't reach         | proposed |
| [006](006-grant-realm-permissions-per-realm-and-widen-them-only-with-a-policy.md)               | Grant realm permissions per realm, and widen them only with a realm policy                | proposed |
| [007](007-keep-motion-a-reactive-layer-that-state-never-waits-on.md)                            | Keep motion a reactive layer that application state never waits on                        | proposed |
| [008](008-build-the-secure-origins-pages-as-their-own-ember-app.md)                             | Build the secure origin's pages as their own Ember app                                    | accepted |
| [009](009-build-new-ui-with-pret-ui-not-boxel-ui.md)                                            | Build new UI with Pret UI, and deprecate boxel-ui                                         | proposed |
| [010](010-give-loaded-modules-native-esm-semantics.md)                                          | Give the modules the Loader loads native ES module semantics                              | proposed |
| [011](011-reveal-a-users-matrix-id-only-to-users-who-share-a-realm-with-them.md)                | Reveal a user's Matrix id only to users who share a realm with them                       | proposed |
| [012](012-hold-one-scroll-anchor-per-change-chosen-by-priority-and-read-from-layout.md)         | Hold one scroll anchor per change, chosen by priority and read from layout                | proposed |
| [013](013-settle-a-transcripts-scroll-anchor-in-the-render-pass-before-motion-measures.md)      | Settle a transcript's scroll anchor in the render pass, before motion measures            | proposed |
| [014](014-beacon-the-secure-origins-telemetry-to-the-realm-server-and-let-no-secret-into-it.md) | Beacon the secure origin's telemetry to the realm server, and let no secret into it       | proposed |
