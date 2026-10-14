---
name: secrets-at-rest
description: Operate and diagnose the realm server's secrets-at-rest helper (`packages/realm-server/lib/secrets-at-rest/`) — AES-256-GCM sealing of stored secrets (API keys, OAuth client secrets and refresh tokens, service-account files, endpoint keys, webhook signing secrets) under a 32-byte data key that KMS wraps, bound to its field (table and column), owner, row id and destination. Covers the two providers (KMS and the local development key), the startup self-check the realm server and the worker manager run (workers take their keys from the manager) and what its log line reports, why a deployed server refuses to start, the KMS encryption contexts involved, key ids, re-sealing a secret with its destination, the plaintext census, sealing the proxy endpoint (system) keys in `proxy_endpoints` and the incoming webhook signing secrets in `incoming_webhooks`, with the backfills that seal them and how to run them on demand, and why a webhook's signing secret is shown only once. Use when the realm server or a worker won't boot with "Secrets-at-rest self-check failed", when reading the `secrets-at-rest` boot line, when a stored secret fails to open with SecretDecryptionError, when a table starts sealing its secrets with the helper, or when the census reports `proxy_endpoints.api_key` or `incoming_webhooks.signing_secret` rows still in plain text.
---

# Secrets at rest (operators)

Stored secrets are sealed by the application before they reach the database,
with AES-256-GCM from Node's `crypto`, by `SecretsKeyring` in
`packages/realm-server/lib/secrets-at-rest/envelope.ts`. Each sealed value is
four things a table stores: `keyId` (which data key sealed it), `nonce`
(12 bytes), `ciphertext` and `tag` (16 bytes).

## Envelope

- A 32-byte **data key** seals every secret. KMS wraps it; the wrapped blob
  lives in SSM as `/<env>/boxel/SECRETS_WRAPPED_DATA_KEY` and reaches the task
  as `SECRETS_WRAPPED_DATA_KEY`, with the key's ARN as `SECRETS_KMS_KEY_ARN`.
- The realm server and the worker manager each call `kms:Decrypt` **once, at
  startup**, then seal and open locally. Each worker the manager starts or
  respawns asks the manager for the keys over their IPC channel instead of
  calling KMS. A KMS outage stops new tasks from starting but never a running
  one, a worker respawn included, and no request makes a KMS call.
- The KMS client takes its region from the key ARN and gives up on a call
  after 5 s to connect or 10 s to answer, with 3 attempts.
- The unwrap uses the encryption context `{"purpose": "boxel-secrets-data-key"}`.
  The key policy lets only the realm-server and worker task roles decrypt, and
  only under that context. CloudTrail records each unwrap.

## Binding

Each value is bound, as GCM additional authenticated data, to the field it is
stored in (`<table>.<column>`, required), the owner, the row id and the
destination the secret is sent to. A value moved to another column, row, owner
or destination by a database writer doesn't open: the caller gets
`SecretDecryptionError`, whose message names none of the inputs. Naming the
field is what keeps two secrets on one row, such as an OAuth client secret and
its refresh token sent to the same token endpoint, from being swapped.

- A secret with no destination yet (a key added before its first approval) is
  sealed under field, owner and id only. `keyring.reseal(sealed, from, to)` binds it
  to its destination; after that it opens only with that destination.
- `secretEncryptionContext(binding)` is the context a value is bound to:
  `field`, `owner`, `id` and `destination_sha256`. The destination appears only as its
  SHA-256, so the context is safe to log or to hand to a service that records
  it.
- Destinations are compared exactly as given. A caller passes the same
  normalized form when sealing and opening.

Open a secret only where it is used, and never log what it opens to.

## Providers

| Provider | Chosen when                                                  | Key id                                               |
| -------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| `kms`    | `SECRETS_KMS_KEY_ARN` and `SECRETS_WRAPPED_DATA_KEY` are set | `kms-` + first 16 hex of SHA-256 of the wrapped blob |
| `local`  | neither is set                                               | `local-development`                                  |

Exactly one of the two set is a misconfiguration and fails startup. The local
data key is fixed and public: development and CI run the same envelope, and
nothing sealed under it is secret.

The KMS key id names the wrapped blob, so it stays the same across restarts
and differs for every data key. Rows sealed under a data key the process
hasn't loaded fail with `sealed under data key <id>, which this process has
not loaded`.

## The startup self-check

The self-check (`unwrapDataKeys`) runs at startup in the realm server
(`main.ts`) and the worker manager (`worker-manager.ts`). Each logs one line
on the `secrets-at-rest` channel:

```
secrets at rest: provider=kms deployed=true keyIds=kms-3f9c0a1b2c4d5e6f currentKeyId=kms-3f9c0a1b2c4d5e6f
```

Each worker then logs the keys it received from its manager, relayed through
the manager's output:

```
secrets at rest: received keyIds=kms-3f9c0a1b2c4d5e6f currentKeyId=kms-3f9c0a1b2c4d5e6f from the worker manager
```

"Deployed" means the realm server's `--serverURL`, or any worker manager
`--toUrl`, names a host that isn't `localhost`, `*.localhost` or a non-public
IP literal — the same rule as the outbound guard's.

### When it refuses to start

The realm server or the worker manager exits with
`Secrets-at-rest self-check failed: <reason>` before it starts any worker:

| Reason                                                                   | Fix                                                                                                                                                                                         |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `a deployed server must unwrap its data key with KMS, but … are not set` | The task definition lacks the two secrets. Apply `boxel-secrets-kms`, then boxel-realm-server and boxel-worker, in the infra repo. Never point a deployed server at the local provider.     |
| `… must be set together, but only … is set`                              | One SSM parameter is missing or wasn't wired into the task definition. Check both `/<env>/boxel/SECRETS_*` parameters exist.                                                                |
| `AccessDeniedException` / `InvalidCiphertextException` from KMS          | The task role isn't in the key policy, the wrapped blob was made under another key or context, or the parameter was edited. Compare the parameter's key-ARN tag with `SECRETS_KMS_KEY_ARN`. |
| a network error from KMS                                                 | The task can't reach KMS (it goes through the NAT gateway). Running tasks are unaffected; new ones fail until it is reachable.                                                              |

A worker that can't get its keys from the manager exits with
`Could not get the secrets keyring: …` and the manager respawns it. That
happens only when the IPC channel is broken or the manager doesn't answer
within 10 s; it never depends on KMS.

## Plaintext census

Once tables seal their secrets with the helper, each adds a
`PlaintextCensusEntry` (table, column, a `count` query of rows still in plain
text) to `PLAINTEXT_CENSUS` in `lib/secrets-at-rest/index.ts`, and removes it
when no plain-text value can remain. The realm server logs one line per entry
at startup:

```
plaintext census: proxy_endpoints.api_key plaintextRows=0
plaintext census: incoming_webhooks.signing_secret plaintextRows=0
```

With no entries it logs `plaintext census: no table seals its secrets with
this helper`. A count that fails logs a warning and doesn't stop startup.

Reading the census: `plaintextRows` is the number of rows whose secret
hasn't been sealed yet. It should read 0 on every startup after the first
one following a deploy. A row added by hand reads 1 until the next startup
or until the backfill is run on demand.

## Tables that seal alongside a plain-text column

`lib/secrets-at-rest/sealed-columns.ts` holds what every such table shares.
The sealed value lives in four columns named after the plain-text one:
`<column>_ciphertext`, `<column>_nonce`, `<column>_tag` and `<column>_key_id`.
Every write keeps the plain-text column in step, so it is the source the
sealed columns are checked against. Reads go through
`openWithPlainTextFallback`, which serves the plain-text value whenever the
two disagree. Backfills go through `backfillDecision`, which decides
seal / unchanged / unloadedKey the same way for every table.

## Proxy endpoint keys

`proxy_endpoints` holds the platform's own vendor keys (OpenRouter's among
them), which `_request-forward` attaches. Each key is sealed into
`api_key_ciphertext`, `api_key_nonce`, `api_key_tag` and `api_key_key_id`
(`packages/realm-server/lib/proxy-endpoint-keys.ts`), bound to:

| Binding       | Value                                                                  |
| ------------- | ---------------------------------------------------------------------- |
| `field`       | `proxy_endpoints.api_key`                                              |
| `owner`       | `boxel-platform` (`PLATFORM_SECRET_OWNER`), the owner of platform keys |
| `id`          | the row's `id`                                                         |
| `destination` | the row's `url`, exactly as stored                                     |

Every write keeps the plain-text `api_key` column in step with the sealed
columns, so rolling back to a revision that reads only `api_key` keeps
working. While that column exists, it is the source the sealed columns are
checked against. `readonly_role`, and every role that is a member of it (the
Grafana and Claude read-only database users), has no `SELECT` on the table.

- **Reads** open the sealed key and serve it when it matches `api_key`.
  Whenever the two disagree, `api_key` is served, so a key edited by hand
  reaches the proxy within the five-second endpoint cache, with no restart.
  That covers:
  - a row with no sealed key yet;
  - a sealed key that doesn't open, because the row's `url` or `id` was
    edited by hand, or because it was sealed under a data key this process
    hasn't loaded;
  - a plain-text key edited by hand.

  Each case except the first is logged once per sealed value, as a warning
  on the `proxy-endpoint-keys` channel:
  `the sealed key for proxy endpoint <url> … so its plain-text key is used until the backfill seals it again`.
  The next startup's backfill, or the on-demand command, seals it again.

- **Writes** go through `saveProxyEndpoint`, which writes both forms
  together.

### The backfill

`sealProxyEndpointKeys` seals every row from its plain-text key. It runs
every time the realm server starts, before the census, and logs one line:

```
proxy endpoint keys: sealed=0 cleared=0 unchanged=3 unloadedKey=0 skipped=0
```

- `sealed`: rows sealed from `api_key` because their sealed key was
  missing, didn't open, or opened to a value other than `api_key` (for
  example, a key edited by hand). A key that didn't open is logged as a
  warning naming its url. This count also includes rows that a process
  sealing with KMS found sealed under the public `local-development` key: it
  seals them again, and logs a warning for each.
- `cleared`: rows with no `api_key` whose sealed columns were emptied.
- `unchanged`: rows that were already correct. A second run reports every
  row here.
- `unloadedKey`: rows sealed under a data key, other than the local
  development key, that this process hasn't loaded.
  Each is left as it is and logged as a warning, so the backfill never moves
  a row back onto an older data key. A rotation loads a new data key
  everywhere before any process seals with it, so a nonzero count means a
  rotation step was skipped or a data key was retired too early.
- `skipped`: rows that changed between the read and the update. Those rows
  are left to whatever changed them.

The backfill is idempotent, and every replica can run it at once. A failure
is reported to Sentry and logged as `Sealing proxy endpoint keys failed: …`.
It doesn't stop startup: the proxy keeps serving the affected keys from
`api_key`.

To run it on demand, use `pnpm seal-proxy-endpoint-keys` from
`packages/realm-server`. It defaults to the local `boxel` database on port
5435; `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` and `PGPASSWORD` point it
elsewhere. It takes the data key from the environment, as the realm server
does. It accepts the local development key only for the development
database, on this machine's loopback or a local socket at port 5435. A
private address can be another machine, and a tunnel to a deployed database
also answers on `localhost`. Against a deployed database it needs
`SECRETS_KMS_KEY_ARN` and `SECRETS_WRAPPED_DATA_KEY`, and a role that can
decrypt with that key, which in practice means running it inside a
realm-server task. If rows do end up sealed under the local key, the next
realm-server start seals them again under KMS. The command logs the
backfill line, then the census.

## Incoming webhook signing secrets

`incoming_webhooks.signing_secret` verifies the signature on each webhook
Boxel receives at `/_webhooks/<webhook_path>`. Each secret is sealed into
`signing_secret_ciphertext`, `signing_secret_nonce`, `signing_secret_tag` and
`signing_secret_key_id` (`packages/realm-server/lib/incoming-webhook-secrets.ts`),
bound to:

| Binding       | Value                                                        |
| ------------- | ------------------------------------------------------------ |
| `field`       | `incoming_webhooks.signing_secret`                           |
| `owner`       | the row's `username`, the Matrix user who registered it      |
| `id`          | the row's `id`                                               |
| `destination` | none: Boxel never sends the secret, it only verifies with it |

The plain-text `signing_secret` column is kept in step by every write, as for
proxy endpoint keys, and `readonly_role` and its members have no `SELECT` on
the table.

- **Shown once.** The API returns a secret only in the response that issues
  it: `POST /_incoming-webhooks` (create) and
  `POST /_incoming-webhooks/rotate-signing-secret` with
  `{"data": {"type": "incoming-webhook", "id": "<id>"}}` (rotate). Every
  other read, `GET /_incoming-webhooks` included, reports
  `signingSecretCreatedAt` instead, from `signing_secret_created_at`, or
  from `created_at` for a row written without it. A user who has lost a
  secret rotates it. A signature made with the old secret stops verifying
  as soon as the rotation responds.
- **Reads.** Only the webhook receiver opens a secret, to check a signature.
  Whenever the sealed and plain-text secrets disagree, it verifies against
  `signing_secret` and logs a warning once per sealed value on the
  `incoming-webhook-secrets` channel:
  `the sealed signing secret of incoming webhook <id> … so its plain-text secret is used until the backfill seals it again`.
  A changed `username` or `id`, a data key this process hasn't loaded, or a
  secret edited by hand all lead here.
- **The backfill.** `sealIncomingWebhookSecrets` runs at every realm-server
  start, right after the proxy endpoint backfill and before the census, and
  logs one line:

  ```
  incoming webhook secrets: sealed=0 unchanged=12 unloadedKey=0 skipped=0
  ```

  The counts mean what they do for proxy endpoint keys. There is no
  `cleared`, since the plain-text column is `NOT NULL`. A row rotated
  between the backfill's read and its update counts as `skipped` and keeps
  the rotation's secret. A failure is reported to Sentry and logged as
  `Sealing incoming webhook signing secrets failed: …`. It doesn't stop
  startup: the receiver keeps verifying with `signing_secret`.

- **On demand.** `pnpm seal-incoming-webhook-secrets` in
  `packages/realm-server` runs the same pass and then the census. It takes
  its database and data key exactly as `pnpm seal-proxy-endpoint-keys` does.
