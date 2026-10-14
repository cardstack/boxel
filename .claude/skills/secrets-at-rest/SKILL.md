---
name: secrets-at-rest
description: Operate and diagnose the realm server's secrets-at-rest helper (`packages/realm-server/lib/secrets-at-rest/`) — AES-256-GCM sealing of stored secrets (API keys, OAuth client secrets and refresh tokens, service-account files, endpoint keys, webhook signing secrets) under a 32-byte data key that KMS wraps, bound to its field (table and column), owner, row id and destination. Covers the two providers (KMS and the local development key), the startup self-check the realm server and the worker manager run (workers take their keys from the manager) and what its log line reports, why a deployed server refuses to start, the KMS encryption contexts involved, key ids, re-sealing a secret with its destination, the plaintext census, and sealing the proxy endpoint (system) keys in `proxy_endpoints`, with the backfill that seals them and how to run it on demand. Use when the realm server or a worker won't boot with "Secrets-at-rest self-check failed", when reading the `secrets-at-rest` boot line, when a stored secret fails to open with SecretDecryptionError, when a table starts sealing its secrets with the helper, or when the census reports `proxy_endpoints.api_key` rows still in plain text.
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
```

With no entries it logs `plaintext census: no table seals its secrets with
this helper`. A count that fails logs a warning and doesn't stop startup.

Reading the census: `plaintextRows` is the number of rows whose secret
hasn't been sealed yet. It should read 0 on every startup after the first
one following a deploy. A row added by hand reads 1 until the next startup
or until the backfill is run on demand.

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

The plain-text `api_key` column is still present, and every write keeps it
in step with the sealed columns, so rolling back to a revision that reads
only `api_key` keeps working. `readonly_role`, which the Grafana and Claude
read-only database users inherit, has no `SELECT` on the table.

- **Reads** open the sealed key. A row with no sealed key yet is served
  from `api_key`. A sealed key that doesn't open is also served from
  `api_key`, and the realm server logs
  `the sealed key for proxy endpoint <url> could not be opened, so its plain-text key is used: …`
  on the `proxy-endpoint-keys` channel. That happens when the row's `url` or
  `id` was edited by hand, or when it was sealed under a data key this
  process hasn't loaded. Run the backfill to seal it again.
- **Writes** go through `saveProxyEndpoint`, which writes both forms
  together.

### The backfill

`sealProxyEndpointKeys` seals every row from its plain-text key. It runs
every time the realm server starts, before the census, and logs one line:

```
proxy endpoint keys: sealed=0 cleared=0 unchanged=3 unloadedKey=0 skipped=0
```

- `sealed`: rows whose sealed key was missing, didn't open, or opened to a
  value other than `api_key` (for example, a key edited by hand). A key that
  didn't open is logged as a warning naming its url. Each was
  sealed from `api_key`.
- `cleared`: rows with no `api_key` whose sealed columns were emptied.
- `unchanged`: rows that were already correct. A second run reports every
  row here.
- `unloadedKey`: rows sealed under a data key this process hasn't loaded.
  They are left as they are, and each is logged as a warning. During a
  rolling data-key rotation, a task on the previous revision can lack a key
  that other tasks already seal with. Outside a rotation, this means the
  process is missing a data key it should have.
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
does, and refuses the local development key for a database that isn't on
this machine. It logs the backfill line, then the census.
