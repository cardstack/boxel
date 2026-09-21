# An AI assistant tool that invokes card operations — plan

## Goal

One tool the assistant calls to invoke a card's declared operations — "add this
comment to that report" — through the same `operations()` client a card or the
host uses, instead of hand-assembling a `PATCH` document.

## What exists already

- `operations()` (`packages/base/operations.ts`) builds a bucket of callable
  members from what a def carries, and `buildOperations`
  (`runtime-common/card-operations/client.ts`) decides which names a bucket
  holds: for a card, instance scope gets `read`/`update`/`delete`/
  `appendContainsMany` plus every declared operation, and type scope gets the
  base `create` plus declared creates and queries.
- `OperationsService` (`packages/host/app/services/operations.ts`) is the
  transport, armed on the global bridge by the
  `register-operations-transport` instance initializer at boot.
- `HostBaseTool` + `tools/index.ts` are the tool surface; the tool service
  validates the input card, runs the tool, and posts the result into the room.

So the tool is a thin adapter: card id + name + payload in, lean result out.

## Design

### Cards (`packages/base/command.gts`)

```ts
InvokeCardOperationInput  { cardId, operation, payload, realm, relationships }
InvokeCardOperationResult { cardId, version, generation, lastModified, document }
```

`id` is a `ReadOnlyField` on `CardDef`, so the written card's id is spelled
`cardId` on the result — the same spelling `CardIdCard` and the input use.

A write fills the four lean members; a `read` fills `document`; a `delete`
answers `null` and so fills nothing.

### The tool (`packages/host/app/tools/invoke-card-operation.ts`)

1. Load the target through the store; a card error is raised as the tool's
   failure.
2. Load `@cardstack/base/operations` through the loader — a host module cannot
   statically import a base-realm module.
3. Resolve the name against the instance bucket, falling back to the bucket for
   the card's _class_, which is where the base `create` lives. The class's
   bucket is built only on that miss: naming the class is a question a card
   whose type no module exports cannot answer, so asking eagerly would refuse
   an instance-scoped call that never needed a class.
4. Invoke only what a type's author declared, plus the plain `create`. An
   unknown name is refused with the list of those; a behavior every card
   carries is refused by name, pointing at the tool that does it.
5. A declared `query` is refused: it answers a live entries resource rather
   than a value, and the search tools are how the assistant reaches one.
6. Params the declaration requires are checked before the call, mirroring the
   realm's own `assertParamsSupplied` — every key of `params` needs a value —
   **except** when the declaration carries an `input` program, because `input`
   runs before the realm's check and is what supplies a param the caller left
   out.
7. Invoke, and shape the answer into the result card.

### Registration

`shimHostToolModule(virtualNetwork, 'invoke-card-operation', …)` plus the
default export in the tool list, beside the existing entries.

## Decisions

- **The offered set is what a type declares, plus `create`.** The behaviors
  every card carries are left out although `operations()` offers them: each is
  already the job of a tool that describes its own payload, and one of them
  removes a card. A tool's approval is decided once for every operation it
  carries rather than per invocation, so offering the base `delete` would put
  a delete of any card behind a name the caller supplies. A `delete` an author
  declared stays reachable — a named action its type published is what this
  tool is for.
- **A `create` with no realm lands beside the card that named its type.** The
  caller named one card and asked for another of its type; that card's realm is
  the only one they said anything about. `realm` remains an explicit override.
- **`realm` and `relationships` are refused, not ignored, everywhere else.**
  Both describe a card being minted. Silently dropping either would write to a
  realm nobody named, or create a card without the link that was asked for.
- **The instance's class is how a `create` names its type.** The input carries a
  card id rather than a code ref, so "create another one of these" is the
  reading a single `cardId` supports.

## Testing

`packages/host/tests/integration/tools/invoke-card-operation-test.gts`, driven
against the in-browser realm, whose `_operations` endpoint is the one a
deployed realm serves and whose indexer lowers the fixture's real `@operation`
declarations:

- a declared `transform` writes the card and answers the lean result
- a declared `read` answers the document rather than a lean result
- a declared `delete` answers nothing, and the card is gone
- a `create` mints a card in the realm it is given, and holds the links it was
  given
- a `create` with no realm is sent to the realm holding the target card — with
  the session default deliberately set to another realm, so the assertion can
  fail
- an unknown operation is refused, naming the ones the card carries
- a behavior every card carries is refused by name
- a payload missing a declared param is refused before any request, and the
  same omission on a declaration carrying an `input` runs
- a query is refused
- `realm` and `relationships` are refused where they have nothing to describe
- a card that does not load is reported as the reason the operation did not run

## Out of scope

Existing tools and their registration are untouched. Batches (`atomic`) are not
reachable from this tool: one call, one operation.
