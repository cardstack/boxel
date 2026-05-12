---
name: boxel-command
description: Use when running a Boxel host command via the realm server's prerenderer — invoking commands like `get-card-type-schema`, `evaluate-module`, `instantiate-card`, or any other module exposed at `@cardstack/boxel-host/commands/.../default`. Documents `boxel run-command` and the matching `client.runCommand()` method.
---

# Boxel Host Commands

Some Boxel operations only exist inside the host app's prerendered runtime — there's no realm-server HTTP endpoint for them, and they can't be reimplemented in plain Node. The realm server's `/_run-command` endpoint forwards a job to the prerenderer (a headless Chrome instance that has the full host runtime loaded), executes the named command there, and returns the serialized result. Schema introspection, module evaluation, card instantiation, transpiled-module fetches — all of these go through `run-command`.

This skill documents how to invoke that flow.

## When to use it

- **Card type schema lookup.** Get the live `{ attributes, relationships }` JSON Schema for a `CardDef` by introspecting its real class at runtime — not by reading the `.gts` source.
- **Module evaluation.** Load a `.gts` / `.ts` module in the prerender sandbox to surface broken imports, circular references, or top-level runtime errors before they hit a real consumer.
- **Card instantiation.** Construct a card instance from a JSON document inside the prerender — exercises the `CardDef` class against the document shape.
- **Anything else exposed at `@cardstack/boxel-host/commands/<name>/default`.** Each module is its own host command.

## CLI

```
boxel run-command <command-specifier> --realm <realm-url> [--input '<json>'] [--json]
```

- `<command-specifier>` — the module path of the command (e.g. `@cardstack/boxel-host/commands/get-card-type-schema/default`).
- `--realm` — the realm URL the command runs against. Required.
- `--input` — JSON string passed as the command's input. Optional; some commands take no input.
- `--json` — emit the raw response instead of the formatted summary.

### Example

```
boxel run-command @cardstack/boxel-host/commands/get-card-type-schema/default \
  --realm http://localhost:4201/my-realm/ \
  --input '{"codeRef":{"module":"http://localhost:4201/my-realm/sticky-note","name":"StickyNote"}}'
```

## Programmatic

```ts
import { BoxelCLIClient } from '@cardstack/boxel-cli/api';

let client = new BoxelCLIClient();

let result = await client.runCommand(
  realmServerUrl,
  realmUrl,
  '@cardstack/boxel-host/commands/get-card-type-schema/default',
  { codeRef: { module: '<absolute-module-url>', name: 'StickyNote' } },
);
```

Returns `{ status: 'ready' | 'error' | 'unusable', result?: string | null, error?: string | null }`. `result` is the command's serialized output (a JSON string — parse it yourself). `error` is set when `status !== 'ready'`.

## How it works under the hood

`/_run-command` enqueues a job for the realm worker. The worker hands it to the prerenderer (which has the host app, the realm's Loader, the CardAPI, and all field serializers loaded). The command module is imported, called with the input, and its result is serialized back through the queue to the HTTP response.

Three failure modes you'll see:

- `status: 'unusable'` — the prerender pool is broken (e.g. "No standby page available for prerender"). Not retryable from the caller's side; usually a sign the realm-server worker / prerender pool itself is unhealthy.
- `status: 'error'` with `error: "module URL not found"` — the realm's in-memory module map hasn't indexed the file yet. Common right after a `/_atomic` write; caller can retry briefly or use `client.sync(..., { waitForIndex: true })` upstream.
- `status: 'error'` with any other message — the command threw inside the prerender. The `error` is the thrown error's message; the original stack is usually in the worker logs.

The realm server itself enforces auth (server JWT via `BoxelCLIClient`); the prerender executes inside the realm's sandbox with the realm's permissions.

## What this skill is **not** for

- **Realm-side HTTP endpoints** (search, file read/write, atomic batches) — those are direct `BoxelCLIClient` methods. See the `boxel-api` skill.
- **Programmatic in-memory validators** (`runLintInMemory`, `runEvaluateInMemory`, `runParseInMemory`, `runInstantiateInMemory`) — those wrap `runCommand` internally but expose a flatter result shape; consumers usually want those, not raw `runCommand`. They live in the software-factory package.
- **Defining new host commands.** That's host-app development (`packages/host/app/commands/`).
