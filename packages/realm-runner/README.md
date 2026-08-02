# Realm Runner

`@cardstack/realm-runner` executes capability-scoped JavaScript programs in
QuickJS. A program has no ambient Node.js, filesystem, process, or network
authority. All Realm access goes through the authenticated Realm server API.

The public guest API is available as the global `realm` object. Call
`await realm.help()` from a program for the current operation list.

Runtime discovery is explicit. Notebook and live-activity builds report
`realm.apiVersion === "2"` and expose:

```js
return {
  apiVersion: realm.apiVersion,
  features: realm.features,
  notebook: realm.notebook,
  help: await realm.help(),
};
```

`realm.notebook` is `null` for one-shot scripts and contains the current
session, cell, revision, execution, and persistence identifiers for notebook
cells.

## Execution modes

- `preview` permits reads and stages mutations. The result includes diffs, but
  does not write them.
- `commit` applies all staged text changes through one `/_atomic` request after
  the program finishes successfully. Immediately before that request, the
  runner re-reads every baseline and aborts with `WRITE_CONFLICT` if another
  actor changed one.

Commit mode also enables authenticated raw `POST`, `PUT`, `PATCH`, and `DELETE`
requests through `realm.api.request` and `realm.server.request`. Raw mutations
run when called so the program can inspect their responses; unlike staged file
changes, separate HTTP operations cannot be rolled back if a later step fails.
Every attempted raw mutation is returned in `effects`, including its scope,
method, path, Realm URL (when applicable), and HTTP outcome. A null outcome
means the transport failed and whether the remote operation completed is
unknown.

Writes, copies, replacements, JSON updates, and removals share the same staged
overlay. The current Realm server has an [open bug for `remove` operations in
`/_atomic`](https://github.com/cardstack/boxel/issues/5665); Realm Runner already
emits the documented operation so removal will work when that server defect is
corrected. Until then, commit-mode `realm.api.request('DELETE', path)` provides
the non-atomic equivalent.

Binary reads are available through `realm.fs.readBase64`. Binary writes are
available in commit mode through `realm.api.request` with `bodyType: 'base64'`.
They remain non-atomic with text changes because of [the Realm server's binary
`/_atomic` limitation](https://github.com/cardstack/boxel/issues/5666).

The Realm endpoint is `/_realm-program`: send a `QUERY` request for preview or
a `POST` request for commit. Both accept `{ "code": "...", "mode": "..." }`.

## Live activity

Realm Runner emits sanitized phase events automatically for capability calls
such as Realm discovery, federated search, grep, reads, BXL, API access, staged
writes, and commit. Events describe the operation but never include its
arguments, paths, source, query, or result.

A Realm Script writer can add semantic phase boundaries with:

```js
await realm.activity('Searching readable realms');
const candidates = await realm.search(query, { realms: 'all' });

await realm.activity({
  phase: 'inspect',
  message: 'Inspecting candidates',
  current: 0,
  total: candidates.length,
});
const matches = await realm.fs.grep(pattern, { files: candidates });

await realm.activity('Transforming matches');
return realm.bxl.jq(expression, matches);
```

Writer rules:

- add checkpoints before expensive semantic phases, not before every line;
- use progress counts only for throttled batches, not per-file messages;
- never interpolate source, paths, query terms, URLs, arguments, or results;
- keep messages stable and action-oriented; and
- always `await` the activity call.

To receive events before completion, add
`X-Boxel-Realm-Program-Stream: activity-v1`. The response is newline-delimited
JSON (`application/x-ndjson`) containing `activity` events followed by exactly
one `result` or `error` event. Without the header, the existing JSON response
is unchanged. `boxel realm script` enables the stream by default and writes
activity to `stderr`, preserving final JSON on `stdout`; pass `--no-activity`
to disable it.

## Resumable Realm Notebooks

Add a `notebook` descriptor to save a named cell, reuse an exact completed
execution, and pass JSON output into later scripts without rerunning the
upstream search:

```json
{
  "code": "return realm.fs.grep(/three/i, { files: realm.input.candidates });",
  "mode": "preview",
  "notebook": {
    "sessionId": "!room:matrix.example",
    "cellId": "grep",
    "inputs": {
      "candidates": {
        "cellId": "search",
        "pointer": "/result/value/candidates"
      }
    }
  }
}
```

Each response includes a bounded notebook snapshot with saved cell source,
execution status, output references, and stale dependency flags for the next
LLM turn. `runSaved: true` reruns saved source without resending it;
`force: true` creates a new revision. The default `ephemeral` persistence has
a sliding session TTL. `persistence: "realm"` stores encrypted records under
`.boxel/realm-notebooks/` and requires write access. See
[`docs/realm-script-notebooks.md`](../../docs/realm-script-notebooks.md) for
the protocol and Jupyter model.

## Search the current Realm

Prefer the full-text index to narrow candidates, then inspect the matching
files. `fs.grep` is available for exact source-level matching when needed.

```js
const indexed = await realm.search({
  filter: { any: [{ matches: 'bxl' }, { matches: 'BXL' }] },
});
const matches = [];

for (const hit of indexed) {
  if (!hit.id.startsWith(realm.current.url) || !hit.id.endsWith('.gts'))
    continue;
  const path = hit.id.slice(realm.current.url.length);
  const source = await realm.fs.readText(path);
  if (/bxl/i.test(source)) matches.push(path);
}

return { candidates: indexed.length, matches };
```

## Federated search and cross-Realm reads

`realms: 'all'` discovers every Realm for which the current user has read
permission, batches a federated full-text query, and de-duplicates its results.
An authorized result can then be inspected through a read-only Realm handle.

```js
const hits = await realm.search(
  {
    filter: {
      any: [
        { matches: 'three' },
        { matches: 'three.js' },
        { matches: 'threejs' },
      ],
    },
  },
  { realms: 'all' },
);

const grants = await realm.listRealms({ permission: 'read' });
const sources = [];
for (const hit of hits) {
  if (!hit.id.endsWith('.gts')) continue;
  const realmURL = grants
    .map((grant) => grant.url)
    .filter((url) => hit.id.startsWith(url))
    .sort((a, b) => b.length - a.length)[0];
  if (!realmURL) continue;
  const path = hit.id.slice(realmURL.length);
  sources.push({
    id: hit.id,
    source: await realm.open(realmURL).fs.readText(path),
  });
}

return { hits: hits.length, sources };
```

## Data transforms

BXL is the jq-like transformation layer:

```js
return await realm.bxl.jq('.items | map(.price) | add', input);
```

The package ships with a vendored, commit-pinned `@cardstack/bxl/runtime-bare`
bundle so Realm Server installs do not require credentials for the private BXL
repository. `BXL_API` can override it with a local `dist/runtime-bare.js` build
while developing BXL. See `vendor/README.md` for provenance and refresh steps.

## Full Realm and Realm-server API

The stable helpers cover common reads. `realm.api.request` targets the current
Realm; `realm.server.request` targets the Realm server. Both accept every HTTP
method used by Boxel: `GET`, `HEAD`, `QUERY`, `POST`, `PUT`, `PATCH`, and
`DELETE`.

```js
const info = await realm.api.request('GET', '_info', {
  accept: 'application/vnd.api+json',
});

const binary = await realm.api.request('GET', 'document.pdf', {
  accept: 'application/octet-stream',
  responseType: 'base64',
});

// commit mode only
const written = await realm.api.request('POST', 'copy.pdf', {
  body: binary.body,
  bodyType: 'base64',
  accept: 'application/octet-stream',
  contentType: 'application/octet-stream',
});

return { info, written };
```

Request options are `{ body, bodyType, responseType, headers, accept,
contentType }`. `bodyType` is `none`, `json`, `text`, or `base64`;
`responseType` is `auto`, `text`, or `base64`. Authorization is always supplied
by the capability host and cannot be overridden. Absolute/escaping paths,
credential-minting endpoints, recursive Realm Programs, hop-by-hop headers,
and internal/impersonation/routing headers are blocked. Cross-Realm handles remain
read-only by default. In commit mode, an explicit
`realm.open(url, { write: true })` handle can issue raw mutations when the
active profile has a write grant for that Realm.
Boxel routes handlers by `Accept`, so source and binary writes must set
`accept` to `application/vnd.card+source` or `application/octet-stream`
respectively; `contentType` describes the request body.

Each raw request and response is stream-bounded, and cumulative request and
response budgets apply to the entire program. Realm HTTP calls have their own
timeout. The QuickJS CPU deadline excludes time suspended on Realm I/O, while
a separate five-minute wall-clock deadline includes both execution and I/O.
