# Boxel execution runtime: mutation protocol

## Status and scope

This is a proposed companion contract for the Boxel execution runtime. It
describes how edits originating in Direct, Capsule, or Sandbox rendering become
canonical Store mutations without sending a rendered projection back as card
JSON:API.

In this document, **Boxel means Box Element**: a CardDef, FieldDef, FileDef, or
future compatible visual building block. Realm remains the server-side data and
module location.

This proposal covers:

- editable projections and bounded write grants;
- serialization of primitive, contained, and linked changes;
- optimistic state, validation, acknowledgement, and rollback;
- typed Commands and long-running effects; and
- identical mutation behavior across Direct, Capsule, and Sandbox execution.

It does not define BXL policy evaluation, provider credentials, collaborative
text internals, or the complete Realm Server authorization model. BXL
projection is specified separately in
[boxel-execution-runtime-authorization-projection.md](boxel-execution-runtime-authorization-projection.md).

## Why mutation is not render transport in reverse

A render record may contain computed values, expanded linked resources,
side-loaded data, presentation metadata, authorization decisions, and resolved
FieldDef state. None of those facts makes them writable card JSON:API.

The failure mode already has a concrete signature: a UI edits a projected
record and submits the entire object, then the server rejects it because
side-loaded data is not a valid card resource. A more dangerous implementation
could silently persist presentation or foreign relationship data.

Mutation therefore starts with a named semantic change, not a modified render
snapshot:

```text
rendered projection
  -> named field/relationship/Command intent
  -> current write grant
  -> serializeCardPatch()
  -> canonical JSON:API attributes + relationship identifiers
  -> Host admission
  -> Realm Server authorization and validation
  -> Store acknowledgement or bounded refusal
```

## Invariants

1. The Store owns canonical card documents and relationship identity.
2. Receiving a document, render record, component handle, or Surface capability
   grants no mutation authority.
3. A rendered projection is never submitted as a PATCH body.
4. Every change names its target Boxel, path, expected revision, and write
   grant.
5. Computed, presentation-only, authorization, side-loaded, unknown, and
   foreign values are rejected before network IO.
6. Linked relationships serialize identifiers, never expanded child records.
7. Contained values serialize only through their declared field schema.
8. Writability is stable while the same edit session and authorization
   generation remain valid; the UI does not flash read-only while metadata
   settles.
9. Optimistic state never becomes authority. The server independently
   authorizes and validates every operation.
10. A matching SSE/index event acknowledges the active mutation; it does not
    reload an older snapshot or remount the renderer.
11. A stale, denied, invalid, or conflicting mutation preserves the last known
    good canonical document and returns a structured result.
12. Direct, Capsule, and Sandbox use the same mutation request and result
    semantics.

## Ownership

| Concern                             | Owner                              | Boundary representation                          |
| ----------------------------------- | ---------------------------------- | ------------------------------------------------ |
| canonical document and revision     | Store                              | stable Boxel id and document revision            |
| server authorization and validation | Realm Server                       | admitted receipt or structured refusal           |
| client authorization projection     | `BoxelAuthorizationService`        | available Commands and writable paths            |
| edit session and optimistic overlay | Host mutation coordinator          | edit-session id and generation                   |
| semantic PATCH serialization        | trusted Boxel runtime/Base schema  | canonical JSON:API patch                         |
| authored edit UI                    | Direct/Capsule/Sandbox renderer    | named mutation intent                            |
| persistence and acknowledgement     | Store + Host mutation coordinator  | mutation id, canonical revision, changed paths   |
| long-running effects                | Host capability broker/Run records | typed Command request and durable Run/Job result |

Mutation is not a `surface*` capability. Surface capabilities coordinate a
mounted visual root. Mutation authority is scoped to principal, target Boxel,
document revision, semantic path, operation, and authorization generation.

## Protocol records

The transport is cloneable and descriptive. It contains no Store method,
component callback, or ambient service.

```ts
export interface BoxelWriteGrant {
  id: string;
  principal: string;
  target: CardIdentifier;
  documentRevision: string;
  authorizationRevision: string;
  writablePaths: string[];
  availableCommands: string[];
  expiresAt?: string;
}

export type BoxelMutationIntent =
  | {
      kind: 'set-field';
      path: string;
      value: JSONValue;
    }
  | {
      kind: 'set-relationship';
      path: string;
      value: CardIdentifier | null;
    }
  | {
      kind: 'set-relationships';
      path: string;
      value: CardIdentifier[];
    }
  | {
      kind: 'invoke-command';
      command: string;
      input: Record<string, JSONValue>;
    };

export interface BoxelMutationRequest {
  protocolVersion: number;
  mutationId: string;
  editSessionId: string;
  generation: number;
  target: CardIdentifier;
  expectedRevision: string;
  writeGrantId: string;
  intent: BoxelMutationIntent;
}

export type BoxelMutationResult =
  | {
      status: 'accepted';
      mutationId: string;
      canonicalRevision: string;
      changedPaths: string[];
    }
  | {
      status: 'rejected';
      mutationId: string;
      reason:
        | 'unauthorized'
        | 'read-only'
        | 'stale-revision'
        | 'invalid-value'
        | 'invalid-relationship'
        | 'unknown-path'
        | 'conflict';
      safeMessage?: string;
      currentRevision?: string;
    };
```

The exact public names can be revised during implementation, but these facts
must remain explicit. An opaque `set(model)` callback does not carry enough
identity, revision, or authority to be a safe cross-boundary mutation API.

## Canonical patch serialization

`serializeCardPatch()` is a trusted semantic operation. It resolves the target
field against the same Boxel description used to build the render record, then
emits the smallest canonical patch.

It must distinguish:

| Field shape         | Canonical write                                                    |
| ------------------- | ------------------------------------------------------------------ |
| primitive           | declared JSON value under the canonical attribute path             |
| compound/FieldDef   | schema-validated contained attribute object                        |
| contains            | contained data owned by the parent field                           |
| containsMany        | ordered contained values with stable identity where needed         |
| linksTo             | one relationship identifier or null                                |
| linksToMany         | ordered relationship identifiers                                   |
| computed/computeVia | rejected; no canonical write path                                  |
| query field         | rejected; query definitions/results are not persisted as card data |
| presentation        | rejected unless separately declared canonical card data            |

Field configuration can affect parsing, validation, labels, and controls, but
does not create a write path that the underlying schema lacks.

## Edit-session behavior

An edit session binds:

- target Boxel and canonical revision;
- authorization/write-grant generation;
- projected editable fields and relationships;
- optimistic overlay generation; and
- pending mutation ids.

The Host can show the editor as soon as source/data and the last valid grant are
available. It should not toggle writable/read-only state because a redundant
card load, template load, or sandbox classification completes. Writability
changes only when the authoritative permission, target, revision/conflict
state, or explicit mode changes.

Local edits update an optimistic overlay immediately. Lint, server save,
indexing, Matrix acknowledgement, and SSE are separate phases. A matching
server echo settles the pending mutation and advances the canonical revision
without replacing the optimistic generation. An older or non-matching echo
cannot overwrite it.

## Execution-tier behavior

### Direct

Trusted components emit the same named intent through the Host mutation
coordinator. Direct execution does not get a privileged Store-write shortcut.

### Capsule

Authored code sends a cloneable mutation request keyed to its execution
identity and write grant. The Host validates identity, target, path, revision,
and grant before calling trusted serialization or persistence.

### Sandbox

The iframe sends the same request over the versioned protocol. It receives only
the structured result and any subsequently projected canonical state. Guessing
a field path, relationship id, command name, or mutation id grants nothing.

Nested delegated rendering does not inherit ambient write authority. Each child
slot receives only the grant appropriate to its target and projected semantic
path. A writable parent cannot mutate a linked child unless a distinct grant
permits it.

## Commands and asynchronous work

A Command is used when the operation is more than a canonical field or
relationship PATCH. Examples include approval transitions, image generation,
provider calls, file writes, and workflow advancement.

The render projection exposes a descriptive Command name and input schema. On
invocation, the Host capability broker checks execution identity and the
current authorization projection; the Realm Server checks again. Long-running
work creates or updates canonical Run/Job cards. Component lifetime is not the
job lifetime.

Partial success, progress, retry, cancellation, timeout, and duplicate
acknowledgement are durable state transitions. Remounting a card or destroying
an iframe cannot cancel or erase already admitted work unless an explicit
authorized cancellation Command does so.

## Authorization interaction

Authorization projection controls whether an edit affordance, writable path,
or Command is presented. Mutation admission controls whether an attempted
operation may execute now.

Revocation between display and invocation is expected. The Host rejects the
stale write grant and the server rejects the operation. The UI refreshes the
authorization projection and retains user input as a non-authoritative draft
when it is safe to do so; it never retries under broader authority.

## Acceptance coverage

The cumulative composition suite must prove:

- primitive, compound, contained, contained-many, linked, and linked-many
  edits in Direct, Capsule, and Sandbox;
- null, empty, zero, false, ordering, deletion, and replacement semantics;
- read/write parity with Direct rendering and no transient read-only flash;
- computed, query, presentation, unknown, and side-loaded values are excluded;
- the exact JSON:API body contains only the intended canonical change;
- nested delegated children cannot borrow a parent or sibling grant;
- stale revision, conflict, invalid value, invalid relationship, and
  authorization revocation have structured outcomes;
- optimistic UI is immediate and matching acknowledgement does not remount;
- an older SSE/index echo cannot restore old data or code;
- Command invocation is independently authorized and returns durable state;
  and
- teardown releases edit sessions and protocol handles without discarding
  admitted server work.

## Implementation sequence

1. Define mutation intent, write-grant, request, and result records.
2. Implement `serializeCardPatch()` against the canonical Boxel description.
3. Add a Host mutation coordinator with edit-session and generation identity.
4. Route existing Direct edits through it without changing visible behavior.
5. Add Capsule and Sandbox protocol adapters for the same requests.
6. Separate optimistic application, validation, persistence, indexing, and
   acknowledgement state.
7. Treat matching SSE/index events as acknowledgements rather than reloads.
8. Integrate BXL authorization projection and reauthorization.
9. Add the cross-tier mutation matrix and browser interaction tests.
10. Remove whole-snapshot PATCH paths only after unchanged-card parity passes.

## Open design decisions

- the stable identity model for members of `containsMany` fields;
- whether simple field intents are batched per animation frame or edit
  transaction;
- conflict UX for independent fields versus compound/ordered values;
- how collaborative fields publish materialized revisions into the ordinary
  Store acknowledgement stream; and
- how long a safe local draft may survive authorization revocation or target
  navigation.
