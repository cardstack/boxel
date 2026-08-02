# Realm Script Notebooks

Realm Script Notebooks let an LLM alternate between reasoning and isolated
Realm Script cells without repeating expensive work or relying on a long-lived
JavaScript heap. The same protocol is used by a Matrix room, `boxel realm
script`, and the workspace `run-realm-script` tool.

## What we borrow from Jupyter

| Jupyter concept         | Realm Notebook equivalent                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Notebook document       | A durable session containing named cell definitions                                                                      |
| Code cell source        | Saved Realm Script source, mode, and input bindings                                                                      |
| Cell output             | An immutable execution record and output reference                                                                       |
| Execution count         | A monotonically increasing cell revision                                                                                 |
| Run cell                | Execute saved or supplied source as a new revision                                                                       |
| Run all / run from here | A client can replay saved cells in dependency order; a server-side batch replay command is a later orchestration feature |
| Restart kernel          | Start a new session or clear aliases without changing saved source                                                       |
| Clear output            | The model separates definitions from executions; a user-facing clear-history operation is still to be added              |
| Autosave/checkpoint     | Storage-adapter writes after definition and execution transitions                                                        |
| Parameterized notebook  | Explicit `realm.input` bindings sourced from earlier cells or caller JSON                                                |

We deliberately do **not** borrow Jupyter's implicit mutable kernel heap.
Every Realm Script still runs in a fresh QuickJS context. Cross-cell state is
JSON data with recorded lineage, which avoids execution-order bugs and works
after a server restart.

The implemented MVP covers saved source, stable cell ordering, immutable output
history, explicit input lineage, retry reuse, explicit rerun, stale-output
status, TTL sessions, and encrypted durable storage. Batch "run all/from here"
and clear-history controls belong in a subsequent orchestration/UI layer; they
do not require a change to the storage or execution model below.

## Data model

A notebook has two distinct layers.

### Cell definition (mutable, saved)

```ts
interface RealmNotebookCellDefinition {
  cellId: string;
  code: string;
  mode: 'preview' | 'commit';
  inputs: Record<string, RealmNotebookInputReference>;
}
```

Editing a cell replaces its saved definition. A failed cell still retains its
definition so it can be fixed or rerun.

### Cell execution (immutable)

```ts
interface RealmNotebookExecution {
  executionId: string;
  cellId: string;
  revision: number;
  codeHash: string;
  resolvedInputs: Record<string, { executionId: string; pointer: string }>;
  status: 'pending' | 'succeeded' | 'failed' | 'indeterminate';
  result?: RealmProgramResult;
}
```

Input aliases such as `{ cellId: "search" }` are resolved to concrete
execution IDs before the cell runs. The immutable execution stores those IDs,
so its provenance never changes when an upstream cell is rerun.

## Run versus retry

These are different operations:

- A transport retry or repeated LLM tool call reuses an already-succeeded
  execution with the same code, mode, and resolved input references.
- An explicit rerun (`force: true` or CLI `--rerun`) creates a new revision,
  even when its definition is unchanged. This is how a search cell refreshes
  data from a changing Realm index.
- A saved run (`runSaved: true` or CLI `--saved`) loads source and bindings
  from the notebook instead of requiring the LLM to reproduce the script.
- A downstream saved run resolves cell aliases again. If an upstream cell has
  a newer successful execution, the changed concrete input reference produces
  a new downstream revision automatically.

An indeterminate commit execution is never retried implicitly. The caller must
inspect its effects and explicitly create a new revision.

## Example: search, inspect, grep, transform

First save and run a federated search cell:

```json
{
  "sessionId": "!room:matrix.example",
  "cellId": "search",
  "persistence": "ephemeral"
}
```

```js
const candidates = await realm.search(query, { realms: 'all' });
return { candidates };
```

The grep cell records a declarative binding:

```json
{
  "sessionId": "!room:matrix.example",
  "cellId": "grep",
  "inputs": {
    "candidates": {
      "cellId": "search",
      "pointer": "/result/value/candidates"
    }
  }
}
```

```js
return realm.fs.grep(/three(?:\.js)?/i, {
  files: realm.input.candidates,
  glob: '**/*.gts',
});
```

Later, rerun `search`, then rerun the saved `grep` cell. The second operation
uses the new search execution without issuing another search itself.

## Persistence adapters

`MemoryNotebookStorage` is the default for room and ad-hoc sessions. Records
have a sliding TTL (one hour by default, bounded to one minute through 24
hours) and disappear on Realm Server restart.

`RealmFileNotebookStorage` persists records beneath
`.boxel/realm-notebooks/`. It is opt-in and requires write permission. The
server wraps it with authenticated AES-GCM encryption because a federated
output may contain data from a Realm whose readers differ from the storage
Realm's readers. The Realm secret is never exposed to QuickJS or clients.

Storage adapters implement the small async contract:

```ts
interface NotebookStorageAdapter {
  get(key: string): Promise<unknown | undefined>;
  set(
    key: string,
    value: unknown,
    options?: { expiresAt?: number | null },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}
```

Notebook references are data, not authority. Each execution still uses the
caller's current authenticated Realm capabilities.

## LLM interleaving and status

Every successful cell response includes a bounded `notebook.snapshot`. It is
the handoff to the next LLM turn and contains, in stable cell order:

- saved source (with an explicit truncation flag), mode, and input bindings;
- latest successful revision, execution ID, and output reference;
- the status of the last attempt (`pending`, `succeeded`, `failed`, or
  `indeterminate`); and
- a `stale` flag when a referenced upstream cell has advanced since this
  cell's latest execution.

Failures attach the same snapshot to structured error details. An LLM edits a
later step by supplying revised source with the same `cellId`; the definition
is updated and a new immutable revision is recorded. It can instead set
`runSaved: true` to replay the existing definition unchanged.

Inside a running cell, `realm.notebook` exposes the current session, cell,
revision, execution ID, and persistence kind. Runtime discovery reports
`realm.apiVersion === "2"` and `realm.features.notebooks === true`, so an agent
can distinguish a deployed notebook build from the legacy one-shot runtime.

Live progress is separate from cell output. `realm.activity()` and automatic
capability instrumentation flow through the activity stream without becoming
part of the immutable result. This keeps “what is it doing?” visible to CLI
agents without copying code, queries, paths, or results into logs.

## CLI

Save and run a cell:

```sh
boxel realm script --realm @cardstack/my-workspace/ \
  --file search.js --session research --cell search
```

Run a dependent cell:

```sh
boxel realm script --realm @cardstack/my-workspace/ \
  --file grep.js --session research --cell grep \
  --input-ref 'candidates=cell:search#/result/value/candidates'
```

Refresh the saved search and replay saved grep source:

```sh
boxel realm script --realm @cardstack/my-workspace/ \
  --saved --rerun --session research --cell search

boxel realm script --realm @cardstack/my-workspace/ \
  --saved --session research --cell grep
```

Use `--persistence realm` to make a session survive process restarts. Omit the
notebook flags entirely for a one-shot workspace command.
