# Documentation about Boxel

## What belongs here

- Durable concept and operations docs, each linked from this README, and the [Architecture Decision Records](adr/README.md) in `adr/`.
- A doc about one package belongs in that package, beside its code.
- Per-ticket plans, investigation notes and status reports do not belong here. Put them on the ticket.
- A decision that outlives its PR goes in an ADR.

CI Lint enforces this with `scripts/check-docs-dir.mts`. It fails on a file named like a ticket or a plan, on a Markdown file that this README does not link to, and on a link in this README to a file that is not there.

## Concepts

The following are important concepts:

- [Card and Field Definition Relationships](card-def-field-def-relationships.md): There is a subtle distinction between card and fields to consider when creating cards.
- [Inheritance](card-inheritance.md): Cards can be extended based upon user's custom needs -- no reinventing the wheel.
- [Rendering](card-rendering.md): Cards can be rendered easily in the browser. Each card renders differently based upon how it is related and what context it exists in.
- [Serialization and Deserialization](card-serialization-deserialization.md): Cards have to be adapted to a consistent JSON format before being sent over-the-wire to other consumers.
- [Computed Fields](computed-fields.md): Computed fields work too! We can compute on the data that is already contained in a card to build more complex logic.
- [Indexing](indexing.md): Indexing powers the re-rendering of cards when it's dependencies get updated.
- [Realm](realm.md): Realms are storage for cards that have their own underlying permissions and indexer.
- [Realm Resource Identifiers](realm-resource-identifiers.md): How cards, modules, and files are named — including the portable `@cardstack/base/` prefix form and how the VirtualNetwork resolves it.
- [Search](search.md): Every Card is searchable within and across realms.
- [Spec](spec.md): A Spec card documents an exported definition through its code ref, with examples, so the definition is searchable and can be packaged in a listing.
- [Commands in headless Chrome](commands-in-headless-chrome.md): how a bot trigger becomes a `run-command` job that the prerenderer runs in a headless host tab through the `command-runner` route.

## The card contract

What a card is, from the point of view of the person who writes one and the
person who implements the environment that runs it:

- [Card Contract overview](card-contract/README.md): the boundary the contract
  is drawn at, the two tests that decide what belongs on which side, and how to
  read the rest.
- [Vocabulary](card-contract/vocabulary.md): the durable nouns, and the four
  representations of one card.
- [The author API](card-contract/author-api.md): what a card author writes and
  what it promises.
- [The runtime contract](card-contract/runtime-contract.md): the lower-level
  contracts between a card and its environment.
- [Conformance](card-contract/conformance.md): the profiles a compatible runtime
  implements, and the corpus that checks them.
- [Boundary findings](card-contract/boundary-findings.md): where the line is
  blurred today, and what to do about each.

## Operations

- [AWS operations](aws-operations.md): runbooks for boxel services on AWS, each with pre-requisites, steps, verification and rollback.
- [Realm-server health signals](realm-server-health-signals.md): which check answers which question, why an event-loop-gated failure is honest, and what to do when the loop saturates.
- Liveness wedge threshold: set `REALM_LIVENESS_WEDGE_MS` (milliseconds) to control how long the realm-server's event loop may go without turning before `/_liveness` reports it wedged; default is 60000 (sized against measured stalls — see the doc), floor 5000. The endpoint is served only when `--livenessPort` is passed.
- From-scratch indexing timeout: set `FROM_SCRATCH_JOB_TIMEOUT_SEC` (seconds) to control the from-scratch indexing job timeout and the queue worker cap; default is 3600.

## Decisions

- [Architecture Decision Records](adr/README.md): why the codebase is shaped as it is. One record per decision, with the alternatives that were rejected.

## Developer tooling

- [Working with parallel Claude sessions](parallel-claude-sessions.md): how sessions on one machine reach each other for free, and the one per-machine setting that extends that to your other machines and the cloud — plus session naming, inbound-message policy, and what the reachability does and does not imply.
