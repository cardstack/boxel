# Local stack configuration

## Host-mode publication from Desktop

Desktop enables path-based publication by supplying
`PUBLISHED_REALM_BOXEL_SPACE_BASE_URL`, for example
`http://realm.default.boxel.localhost:4242/sites/`. Host mode's existing
Publish Site dialog, publication checks, copy/index workflow and unpublish
operation remain shared with hosted Boxel. A named publication becomes
`<base>/<owner>/<realm-name>/`; an unlisted publication uses the server-issued
unlisted ID in place of the realm name. Without this setting, hosted domain
publication keeps its existing behavior. Custom domain controls are omitted
when the configured publication base uses paths.

The Desktop transport maps only this publication prefix to a separate viewing
origin. Private realm URLs retain the editor origin. Published HTML uses
`ASSETS_URL_OVERRIDE` for the shared host assets. The CLI uses the same operation:

```sh
boxel realm publish <source-realm-url> <canonical-published-realm-url> --json
```

The native profile's optional `publishedProxyPolicies` maps each allowed source
realm URL to its exact `ownerUserId` and `destinations` of `{ url, methods }`.
The launcher supplies this as `BOXEL_PUBLISHED_PROXY_POLICIES`. Destination URLs
must be HTTPS without credentials, queries or fragments; methods are GET or
POST. The published proxy is disabled when this configuration is absent.

An anonymous proxy request must name a currently published, publicly readable
copy whose source and owner match a policy. Its destination and method must
match that policy and an existing no-credit proxy destination. Only then does
the existing proxy inject the owner's encrypted provider credential. Visitors
receive neither that credential nor an owner session. Keep policies narrow;
requests consume the configured owner's provider quota. Unpublishing removes
this access. Profile files contain policy metadata, never provider keys.

Keep narrated media references relative to the card's realm, and resolve them
against its card ID. Absolute private source URLs embedded in ordinary string
fields do not become public assets when a realm is copied for publication.

## Local data encryption

The native launcher supplies `SECRETS_LOCAL_DATA_KEY` to the realm server and
worker manager through their environment. It is canonical base64 encoding of a
random 32-byte data key, generated once per stack and recovered from the native
secret store on restart. Never put the key in a runtime manifest, command-line
argument, URL or log. The key provider returns only a key fingerprint in
startup diagnostics. Different stack keys cannot open each other's sealed data.

This setting selects the local secrets adapter and cannot be combined with
`SECRETS_KMS_KEY_ARN`, `SECRETS_WRAPPED_DATA_KEY` or
`SECRETS_ADDITIONAL_WRAPPED_DATA_KEYS`, including empty values. It is refused for
a deployed server. Without any secrets settings, the existing public development
key remains available for disposable development and tests; it must not be used
for a persistent user stack. The Desktop Keychain provisioning path is pending.

## Tests with native support services

`test:external-pg` runs the normal QUnit entry without starting Docker or managing
a database. Supply an isolated migrated native Postgres using `PGHOST`, `PGPORT`,
`PGUSER`, and `PGDATABASE`, and a dedicated running Matrix server and registration
secret for tests that use Matrix. `TEST_FILES` narrows the loaded modules.
Builds and typechecks go through Turbo:

```sh
pnpm exec turbo run test:external-pg lint:types --filter=@cardstack/realm-server
```

The secrets-at-rest module uses no database or Matrix calls. Its test-runner
cleanup still imports the Matrix fixture helper, so it needs an explicit dummy
`MATRIX_REGISTRATION_SHARED_SECRET` rather than discovering a running server's
configuration. Set `TEST_FILES=secrets-at-rest-test` for that module alone.

## Hosted identity proof

`BOXEL_HOSTED_IDENTITY_ISSUERS` is a JSON object mapping allowed Matrix server
names (the part after `:` in a full MXID) to their HTTPS homeserver base URLs.
The native `createHostedIdentityVerifier` factory requires this explicit map;
a browser-supplied server name cannot choose an arbitrary network destination.
It verifies only the expected full MXID, disables redirects, limits the response
and suppresses outgoing telemetry through the existing guarded-call context.
The short-lived OpenID proof is the only credential allowed in this native
userinfo query. It is never returned, persisted or attached to an error.
HTTP loopback fixtures are permitted only under `NODE_ENV=test`.

The native identity broker calls this verifier while linking accounts and
persisting durable grants. The protected password frame now calls the native
hosted sign-in adapter when that capability is configured.
Without native identity configuration, paired-homeserver sessions retain their
existing subjects and room destinations.

## Chrome prerender fallback

A native launcher using the approved Chrome for Testing fallback must set
`PRERENDER_CHROME_SANDBOX=true`. It enables Chromium's process sandbox and omits
the container-only `--no-sandbox` and `--disable-setuid-sandbox` flags. Only the
literal strings `true` and `false` are accepted. The default remains `false` for
existing hosted container deployments; this is a deployment setting, not a
browser capability. `PUPPETEER_EXECUTABLE_PATH` selects the pinned downloaded
Chrome executable. The Electron engine adapter remains the intended Desktop
path; its sandboxed standby boot is verified independently.

## Native encrypted secret store

The native launcher calls `createLocalSecretsStore` after its OS encryption
backend is ready. Configuration requires `BOXEL_LOCAL_SECRETS_PROVIDER=keychain`
and an absolute per-stack `BOXEL_LOCAL_SECRETS_DIR`. On this Mac the encryption
backend is Electron `safeStorage`; there is no plaintext or memory-only fallback.
The store generates independent random Postgres, Matrix, realm, bot and data
keys, writes only encrypted bytes with mode 0600, and publishes without replacing
another launcher's store. An existing store that cannot be unlocked fails closed
and is preserved for recovery. The Boxel renderer receives no store handle or
secret paths. Native service environments receive only their required values.

This adapter is implemented in the monorepo. Desktop startup provisioning still
needs to call it and pass each value to its service.

## Native Postgres initialization

`initializeLocalPostgres` initializes a new cluster from a native Postgres 16
asset directory with SCRAM authentication. The launcher supplies a generated
stack password over stdin, never argv or a password file. An existing
`PG_VERSION=16` is reused; another major version fails startup. The runtime
owns the long-running database process, its private socket directory and its
shutdown. This does not perform a major-version upgrade or replace a partially
initialized cluster.

## Native bootstrap and assets

`ensureLocalMatrixAccounts` provisions the realm server, realm users and ai-bot
on the configured local Tuwunel before those services start. It uses the tested
shared-secret registration API, reuses existing accounts and keeps passwords
out of URLs, errors and logs. The native runtime's service preparation hook
runs this monorepo function before spawning the dependent services.

`local/serve-assets.ts` serves an installed asset directory named by
`BOXEL_ASSET_DIR` on the loopback port `BOXEL_ASSET_PORT`. It provides SPA
fallback only for extensionless routes, checks real paths against the asset
root, exposes no directory listings and serves only GET/HEAD. It is an internal
runtime service for the host build and icons; no secrets or user data belong
in its asset root.

The native profile sets `REALM_SERVER_SKIP_BOOTSTRAP_INDEX=true` so the bundled
base realm serves source without a full boot index. Source workspaces still
index on first mount and on edits. The existing `REALM_SERVER_SKIP_BOOT_INDEX`
flag continues to skip every realm and is intended for isolated test harnesses.
Catalog cards and modules resolve by URL at `https://app.boxel.ai/catalog/`;
the native profile does not mount or index a catalog checkout. Offline catalog
responses are retained by the native public-reference service for offline use.

## Native error disclosure

`BOXEL_ERROR_DETAILS=redacted` selects the native error boundary. It requires
`BOXEL_ERROR_PRIVATE_PATH_PREFIXES`, a nonempty JSON list of absolute private
directories. The native launcher supplies the source, data, home, temporary and
asset directories, including canonical temporary paths. No filesystem-root
prefix is accepted. Incomplete or unused configuration fails startup. The
default `full` mode preserves existing hosted behavior.

The realm-server applies this policy at its HTTP boundary, including stored
indexing/render errors carried by successful JSON responses. Stack fields and
frames are removed, private paths and file URLs become `[local file]`, and
unexpected exceptions expose a generic message. Native diagnostics retain the
original error. Tool schemas and ordinary card fields remain intact. Rewritten
payloads have corrected framing and no stale ETag. Error HTTP responses larger
than 1 MiB receive a bounded generic error; successful file metadata does not
inherit that limit. The ai-bot installs the same formatter for Matrix error
messages, and malformed non-string messages use `Unknown error`.

JWT refusal logging no longer prints token values. The native profile clears
both server and bot Sentry DSNs, including prerender. Its host build sets
`CLIENT_TELEMETRY_ENABLED=false`, disabling client collectors and the profiler.
This flag accepts only `true` or `false`; hosted builds retain their previous
enabled default. Tests may explicitly opt into client telemetry under the test
environment. Native telemetry opt-in UI is not implemented.

The native build also sets `BOXEL_PUBLIC_SOURCE_NAMES=true`. A final host
bundling hook replaces checkout-root template source names with virtual names
before asset hashes are calculated. Hosted builds preserve their source names
unless explicitly configured. `test:public-source-names` builds real fixture
bundles to verify native removal, hosted preservation and distinct asset hashes.

## Local assistant file reads

The native launcher configures `AI_BOT_DELEGATION_SECRET` on the local realm
server and ai-bot from a domain-separated HMAC of the Keychain-backed stack
secret. It is passed through native environment references, never command
arguments, browser payloads or the persisted manifest. This enables the existing
`readRealmFile` tool for single-human rooms. Its tokens remain read-only and
scoped to the requesting user's existing realm access. Hosted configuration is
unchanged.

## Public reference downloads and offline reads

`BOXEL_PUBLIC_REFERENCE_CACHE_URL` and `BOXEL_PUBLIC_REFERENCE_REALMS` configure
the fetch-boundary routing in the realm server, worker, and ai-bot. Both must be
present or both absent. The latter is a JSON array of absolute public realm URLs
ending in `/`. The host build takes the same cache URL and derives its allowed
public realms from its configured catalog, skills, OpenRouter and Pretui URLs.
Canonical identifiers and source references keep their original URLs and prefixes.

The native `public-references` service runs `local/serve-public-references.ts`
with `BOXEL_PUBLIC_REFERENCE_CACHE_PORT`, an absolute
`BOXEL_PUBLIC_REFERENCE_CACHE_DIR`, and the public realm list. It serves only
GET/HEAD within those realms and QUERY searches whose entire realm list is
public and configured. No caller credentials, cookies or other request headers
are forwarded except Accept, Content-Type and the Boxel link-shape selector.
Private reads retain their original authenticated transport.

Successful responses are written atomically as private application data, keyed
by URL, content negotiation, link shape and query body. Responses are limited to
10 MiB and query bodies to 64 KiB. Warm reads work after restart without an
upstream connection; a missing offline entry reports an explicit 503. Warm entries
refresh after one minute while the saved version remains available. Redirects,
cookie responses, authenticated variants and private responses are never saved.
Every proxy response has `Cache-Control: no-store` for HTTP intermediaries.

`BOXEL_PUBLIC_REFERENCE_SAVE_PUBLIC_SNAPSHOTS=true` enables explicit offline
application snapshots of public metadata that the upstream marks `no-store`.
This is off by default and enabled by the native stack to meet its offline
requirement. It additionally requires `X-Boxel-Realm-Public-Readable: true` and
an exact configured `X-Boxel-Realm-Url`; a private response is still excluded.
Search responses without that assertion require a fresh credential-free `_info`
check of every requested realm before a snapshot is saved.
Hosted catalog and skill metadata currently require this option. A future
versioned public snapshot endpoint should replace this compatibility path.
This service downloads responses and does not mount or index a catalog realm.
Cache eviction and proactive download of a complete catalog are not implemented;
only resources read while online are available offline.

`BOXEL_LOCAL_REALM_SERVER_URL` identifies the native worker's local server
when its URL mappings also include hosted read-only reference realms. It must
match a local source-to-loopback mapping and cannot name a deployed server.
Without this explicit native identity, the existing rule remains: any deployed
mapping requires KMS. Catalog reference URLs do not change where native data
is stored or which key provider protects it.

Native bootstrap also seeds each bundled realm's dedicated Matrix service
account as its owner. Public reads stay read-only. This owner is needed for
lazy definition lookup even though the base realm skips a full boot index;
no user-owned realm permissions are changed. `MATRIX_SERVER_NAME` is passed
explicitly to native clients, worker tasks and prerender authentication so
a loopback transport URL does not change the Matrix identity.

## External 3D maps in a local realm

Use the existing authenticated `POST /_request-forward` endpoint for Google
Map Tiles. Configure a system key for `https://tile.googleapis.com/v1/3dtiles/`
with `authMethod: "raw-header"`, `paramName: "X-Goog-Api-Key"`,
`creditStrategy: "none"`, and `supportsStreaming: false`. The system-key store
seals the credential in Postgres; it is not realm content. `header` continues
to prepend `Bearer`, including for custom header names. `raw-header` sends
the value without a scheme and requires an explicit header name.

The JSON request-forward envelope is unchanged. A no-credit endpoint may also
return binary 3D tiles or raster images. These responses stream through with
their original binary content type, cancellation, outbound limits, and
`Cache-Control: no-store`. HTML and SVG do not use this binary path. The
credit strategy controls Boxel credit accounting only; Google bills its
project directly for usage. Google tiles are not offline snapshots.

CLI configuration uses `boxel realm-server keys add --help`; choose
`--auth raw-header --param-name X-Goog-Api-Key`, and supply the key with
`--key-file` or stdin. The SDK `addSystemKey` accepts the same auth method.

## Idle prerender browser

The native stack sets `PRERENDER_BROWSER_IDLE_TIMEOUT_MS=60000`. After one
minute with no running or queued prerender visits, module renders, commands,
captures, or explicit standby warmup, the prerenderer closes its page pool,
shared contexts and Chrome process. The prerender HTTP service stays ready;
the next request lazily launches Chrome and reloads the host. Expect a cold
render after an idle period. Browser-only auth/icon caches and batch ownership
are cleared with the discarded pages. Persisted realm content is unchanged.

An arriving request waits for an in-progress idle close before acquiring pages.
Shutdown disables the idle timer and prevents a waiting request from reopening
Chrome. This policy is independent of the existing affinity eviction timer,
which defaults to 12 hours and normally retains standby pages.

`PRERENDER_BROWSER_IDLE_TIMEOUT_MS` accepts an integer between 0 and 2147483647
milliseconds; 0 disables idle browser shutdown. The default is 0, preserving
hosted warm-pool behavior. The native adapter enables it without adding a
browser-facing control or changing the server/daemon protocol.

## Native identity persistence

`lib/local-identity-store.ts` implements the native persistence component for
linked identities. Its factory receives the native encryption capability,
absolute store directory, stack ID, configured local Matrix server name and
hosted OpenID verifier. It creates an Ed25519 device key once and stores the
key and each account's signed grant as encrypted, owner-only files. Neither
the private key nor the grant is returned by its API. Hosted OpenID proofs
are verified at issuance and are never persisted.

`link` verifies the hosted proof and persists the exact full hosted/local ID
pair for 30 days. An existing local account cannot be reassigned to another
hosted identity, including after expiry. `resolve` verifies the persisted grant
offline and returns only the identity pair. The native caller must first prove
control of the local Matrix account; these methods are not HTTP handlers and
must not be exposed directly to the page. Missing, expired or future-dated
grants do not authorize a session. Corruption, changed scope, unsafe file
permissions or an unavailable encryption backend fail without replacing the
original key. A missing key with existing grants requires recovery.

Concurrent initialization uses an exclusive hard-link publish, so launchers
converge on the same key. Each account has its own hashed filename, preventing
updates to different accounts from overwriting each other. Atomic replacement
keeps interrupted renewals from leaving partially written grant files.

The native launcher now owns this store and a private loopback listener.
`createLocalIdentityBroker` verifies the exact local OpenID proof before linking
it to a verified hosted proof. `/v1/link` and `/v1/resolve` perform those proof
checks. `/v1/resolve-verified` is for a native service that already authenticated
the local Matrix subject. `/v1/login-hosted` performs the native hosted password
exchange and local JWT login. These routes require native bearer authority,
an exact literal loopback Host, JSON and bounded bodies; page origins and
browser fetch-site headers are rejected. There is no gateway route to this
listener. Only the login route returns a local Matrix session; no route returns
the device key, identity grant, hosted password or hosted access/OpenID token.

The launcher injects `BOXEL_LOCAL_IDENTITY_BROKER_URL` and
`BOXEL_LOCAL_IDENTITY_BROKER_SECRET` only into native realm-server, worker and
prerender processes. These are managed settings, not profile secrets or CLI
arguments. When configured, the realm identity adapter resolves grants before
issuing server/realm sessions and AI read delegation. The database user and JWT
subject are the full hosted ID; Matrix session-room invitations target the
local ID. An expired grant blocks renewal rather than using local identity.
Incomplete configuration or an unavailable listener fails closed. When both
settings are absent, the existing paired-homeserver behavior is preserved.

Focused tests use real HTTP proof exchanges, signed JWTs and real Postgres for
session-room and permission assertions. A separate two-process Electron probe
checks real native encryption. The protected password frame (Desktop and CLI
login modes) now posts to `/_local-identity-login`. That route accepts only the
configured secure origin, rate limits failures, and returns the linked local
Matrix session. Its body/query/header values are scrubbed from telemetry.
The password and temporary hosted session stay inside this native exchange;
the temporary hosted session is logged out after the OpenID check. Tuwunel
receives a five-minute HS256 JWT with the configured issuer and audience, as
described in [its JWT login documentation](https://matrix-construct.github.io/tuwunel/authentication/jwt.html).
A pre-existing local account without a matching native link is never taken
over. Link metadata in local Matrix account data is informational; only the
native signed grant authorizes hosted subjects.

Native new-realm paths for hosted owners include the issuing server and a hash
of the full Matrix ID under `matrix/`. Safe existing local usernames keep their
paths; `matrix` is reserved to prevent parent/child namespace overlap. Hashing
the full identity prevents case-insensitive filesystems merging distinct IDs.
No existing ownership or private permission rows are migrated automatically.
Without native configuration, existing hosted namespace behavior is preserved.

This first version supports hosted password sign-in. Hosted Google/SSO entry
and secure-window key-management reauthentication still need integration.
Manual real-account sign-in and the full Wi-Fi-off acceptance path remain to
be verified. Credentials must be entered in the protected form, never in CLI
arguments or chat. For isolated frame tests, set `BOXEL_TEST_BROWSER_BINARY`
to an installed Chrome binary while running the focused Turbo test task; both
Desktop and CLI frame modes use synthetic accounts and close Chrome afterward.

## Development cleanup isolation

The mise dev/dev-all cleanup guardian can run while Desktop owns a separate
native stack on the same Mac. Its fallback sweep must not signal a process just
because its command contains `main.ts`, `worker-manager.ts` or a prerender entry
point. The fixed sweep requires an orphan parent (PID 1) and a resolved working
directory inside the exact checkout being cleaned. Live runtime-owned services,
sibling checkout paths and processes whose ownership cannot be established are
preserved. Forced cleanup bypasses the dev-session guard, not these ownership
checks. Recorded dev process groups remain the primary shutdown mechanism.

Run the regression through Turbo from the repository root:

```sh
pnpm exec turbo run test:dev-cleanup
```

It exercises all three managed entry points, a sibling checkout orphan, and a
checkout-owned orphan that ignores SIGTERM and therefore needs SIGKILL.
