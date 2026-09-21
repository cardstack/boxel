# An AI assistant tool that invokes card operations — plan

## Goal

One tool the assistant calls to invoke a card's declared operations — "add this
comment to that report" — through the same `operations()` client a card or the
host uses, instead of hand-assembling a `PATCH` document.

## What exists already

- `operations()` (`packages/base/operations.ts`) builds a bucket of callable
  members from what a def carries, and `buildOperations`
  (`runtime-common/card-operations/client.ts`) decides which names a bucket
  holds: instance scope gets `read`/`update`/`delete`/`appendLine`/
  `appendContainsMany` plus every declared operation; type scope gets the base
  `create` plus declared creates and queries.
- `OperationsService` (`packages/host/app/services/operations.ts`) is the
  transport, armed on the global bridge by the
  `register-operations-transport` instance initializer at boot.
- `HostBaseTool` + `tools/index.ts` are the tool surface; the tool service
  validates the input card, runs the tool, and posts the result into the room.

So the tool is a thin adapter: card id + name + payload in, lean result out.

## Design

### Cards (`packages/base/command.gts`)

```ts
InvokeCardOperationInput  { cardId, operation, payload, realm }
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
3. Build the instance bucket. If the name is not carried there, fall back to
   the bucket for the card's _class_, which is where the base `create` lives;
   `realm` names where that create lands.
4. An unknown name is refused with every name both buckets carry.
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

## Assumptions

- The instance's class is how a class-scoped `create` names its type: the input
  carries a card id, not a code ref, so "create another one of these" is the
  reading a single `cardId` supports. Named in the tool description.
- Supplying `realm` for an operation that runs against the instance is refused
  rather than ignored — the instance's own realm is where it runs, and a
  silently dropped `realm` would put a card somewhere the caller did not ask
  for.

## Testing

`packages/host/tests/integration/tools/invoke-card-operation-test.gts`,
following `execute-atomic-operations-test.gts`:

- a declared `transform` mutates the card and returns the lean result
- an unknown name is refused, and the message lists the available names
- a payload missing a required `params` key is refused before any request
  (asserted against a transport that records what it was sent)
- a declared `query` is refused
- `realm` alongside an instance-scoped operation is refused

## Out of scope

Existing tools and their registration are untouched. Batches (`atomic`) are not
reachable from this tool: one call, one operation.
