# Boxel local runtime dependency

This package owns Boxel's native bootstrap, local service graph and product
configuration. Boxel Desktop consumes its latest build as a dependency and
injects only OS encryption and a generic process runner. Desktop is the shell,
browser and dev runner; it contains no copy of this implementation.

New desktop installations default to Boxel-hosted inference, with an explicit
Production or Staging account paying Boxel credits. The native Models settings
select optional local inference; bundled Ollama does not imply bundled weights.

`startLocalBoxel` is the native embedding API. Its profile is a JSON object with
`schemaVersion: 1`, absolute `dataDirectory`, `postgresBin`, `tuwunelBinary` and
`chromeBinary` paths, plus `modelIds` and `titleModel`. Choose either an external
`modelBaseURL`, or managed `ollama: { binary, modelsDirectory }` with absolute
paths. Supplying both is rejected. Managed mode starts the staged Ollama binary
with `serve` on an allocated loopback port, uses the selected model directory,
and makes ai-bot depend on its readiness. It uses a separate runtime HOME under
the stack directory and disables cloud features. One loaded model and one
parallel request bound memory use. Ollama and its runners stop with the stack.
The native runtime assets must include the Ollama binary, adjacent libraries,
GPU backend assets and their license notices. The system Ollama app is not used
by managed mode. Model weights must be downloaded or staged into modelsDirectory
before selecting them; an end-user model download UI is not implemented yet.
No credentials belong in the profile. The OS encrypted store supplies generated
stack secrets. The injected host exposes the normal runtime HTTP API, so the
Boxel CLI and SDK control the same stack.

`hostedIdentityIssuers` optionally maps full Matrix server names to their HTTPS
homeserver base URLs. It defaults to
`{ "boxel.ai": "https://matrix.boxel.ai/" }`. Empty maps, plaintext HTTP,
credential-bearing URLs, queries and fragments are rejected. This is trusted
native configuration; the page cannot choose an issuer endpoint.

Startup owns an encrypted device identity store and a private, authenticated
loopback identity listener. Only native realm-server/worker/prerender processes
receive its URL and authority through the existing environment-reference path.
The listener is not a gateway route, rejects browser origins and closes with
the native runtime. For linked accounts, realm sessions carry the hosted full
ID while session rooms target the linked local Matrix account. AI read
delegation resolves the same grant and retains its read-only limit. Expired
grants require online verification instead of falling back to local identity.
The protected Desktop/CLI password frame performs the hosted exchange and
returns a linked local Matrix session. Hosted credentials stay native and the
temporary hosted session is logged out. The native signed grant remains the
authority; Matrix account-data link metadata is informational. This first
version supports hosted passwords, with Google/SSO entry still pending.

Saved local CLI profiles can sign another browser in through `boxel browse`
without re-entering a password. Tuwunel's existing-session token endpoint
requires interactive authentication. The native runtime validates the saved
session with `whoami`, binds it to the requested local account, and supplies a
30-second JWT proof using its existing native signing key. The resulting
single-use token goes directly to the chosen browser or clipboard. The
password and signing key never enter the CLI, Boxel page, or plugin RPC.

Native realm services receive `BOXEL_NATIVE_RUNTIME_URL` and
`BOXEL_NATIVE_MATRIX_PUBLIC_URL` from startup. Only this explicit configuration
enables `GET /.well-known/boxel-runtime`; hosted configurations return 404.
Discovery contains addresses, never credentials. The CLI accepts only a local
realm, a literal `127.0.0.1` controller, and an exact match to the saved Matrix
server. The controller rejects browser-origin requests and verifies the saved
bearer against its fixed local Matrix backend before issuing any proof.
Redirects are forbidden and the native response is not cached. This does not
change hosted Synapse authentication policy or extend the saved session's
permissions.

The current development dependency uses the configured monorepo checkout's
host build and service entrypoints. Build those through Turbo
and record its source revision and working-tree state. A development source
link is not a self-contained installer artifact.

`pnpm exec turbo run build:local --filter=@cardstack/boxel-local-runtime` owns
the gateway origins used by the local host build and typechecks this dependency.
Desktop invokes this task
rather than maintaining Boxel build settings itself.

The owned `public-references` service downloads configured public catalog,
skills, OpenRouter and Pretui responses for offline reuse. It keeps canonical
URLs intact and does not index the catalog. The host, worker, realm server and
ai-bot share its fetch-boundary routing; private traffic keeps its existing
authentication. The native profile enables public metadata snapshots, gated by
the upstream realm's public-read assertion. See `packages/realm-server/LOCAL.md`
for configuration, limits, cold misses and the remaining eviction/snapshot work.

Current limitations: Chrome prerender fallback; Postgres uses the `postgres`
database; base boot indexing is deferred, while catalog content is consumed by
URL; Google/SSO entry and secure-window key reauthentication remain. Hosted
sign-in and Wi-Fi-off acceptance belong to the desktop release checks, not this
package test suite. New hosted
owner paths are server-qualified; existing private ownership is not migrated.
The maintenance secret is domain-separated from the stack's server seed.

The non-federating local Matrix profile uses explicit loopback DNS to avoid
Tuwunel failing to parse macOS scoped IPv6 resolver entries when offline or
networks change. Remote Matrix DNS/federation needs a native resolver adapter.

## Managed environment architecture

Managed source forks use the `ManagedEnvironmentsOptions` host adapter. Read
[ADR 018](../../docs/adr/018-isolate-managed-native-environments.md) before changing
that boundary, and [ADR 003](../../docs/adr/003-reach-cloud-services-through-adapters.md)
before adding cloud providers.

## Development and verification

Use the Node/pnpm versions pinned by the selected source revision. A desktop
managed environment provisions and verifies those versions itself. A conventional
source checkout uses Mise as described in root `AGENTS.md`.

Run checks from the monorepo root through Turbo:

```sh
BOXEL_TEST_POSTGRES_BIN=/absolute/path/to/postgres16/bin \
pnpm exec turbo run test:package lint:js lint:types --filter=@cardstack/boxel-local-runtime
```

The PostgreSQL directory must contain executable `initdb`, `postgres` and
`pg_ctl`. With this variable set, the database fixture starts a fresh cluster,
uses a private Unix socket without a TCP listener, runs real Boxel migrations
and queries, and stops/removes the cluster. Without the variable that fixture
is skipped; a skipped run is not the native acceptance gate. Never supply a
running user's database directory.

`test:package` covers packaging, relocatable native profiles, socket ownership,
hosted model policy, controller authorization, job admission and real PostgreSQL.
It does not replace the owning package's tests for realm-server, Matrix, host,
worker or schema behavior. Add those checks for the feature being changed.
Some conventional suites still require Docker or additional test services.
The managed Test action runs this package's tests and both lint gates before
recording the current source fingerprint.

## Build and package

Use `pnpm exec turbo run build:local --filter=@cardstack/boxel-local-runtime`
for an instance-specific runtime. `BOXEL_NATIVE_INSTANCE` and
`BOXEL_NATIVE_GATEWAY_PORT` select that environment's namespace and gateway.
The `package:runtime` task stages a self-contained runtime at
`BOXEL_RUNTIME_OUTPUT`; `package:native-assets` stages reviewed native binaries
using `BOXEL_NATIVE_PROFILE` and `BOXEL_NATIVE_ASSETS_OUTPUT`.

The desktop release supplies native assets and the source provenance record.
A source checkout alone is not a complete desktop installation. The controller
builds source snapshots into its own environment directories and refuses to run
source without matching successful test and build fingerprints. Stop a fork
before rebuilding it; keep the main runtime and other agents' environments
running.
