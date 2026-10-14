---
name: secrets-at-rest
description: Operate and diagnose the realm server's secrets-at-rest helper (`packages/realm-server/lib/secrets-at-rest/`) — AES-256-GCM sealing of stored secrets (API keys, OAuth client secrets and refresh tokens, service-account files, endpoint keys, webhook signing secrets) under a 32-byte data key that KMS wraps, bound to its field (table and column), owner, row id and destination. Covers the two providers (KMS and the local development key), the startup self-check the realm server and the worker manager run (workers take their keys from the manager) and what its log line reports, why a deployed server refuses to start, the KMS encryption contexts involved, key ids, re-sealing a secret with its destination, rotating the data key (`boxel realm-server data-keys status | reseal`, `SECRETS_ADDITIONAL_WRAPPED_DATA_KEYS`, the re-seal pass, retiring an old data key, the sealed census), and the plaintext census. Use when the realm server or a worker won't boot with "Secrets-at-rest self-check failed", when reading the `secrets-at-rest` boot line, when a stored secret fails to open with SecretDecryptionError, when a table starts sealing its secrets with the helper, or when rotating the data key.
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

Exactly one of the two set is a misconfiguration and fails startup.
`SECRETS_ADDITIONAL_WRAPPED_DATA_KEYS`, a comma-separated list of more wrapped
data keys, belongs to the KMS provider: each is unwrapped once at startup and
loaded to open values, never to seal them. Setting it without the KMS pair, or
listing a data key twice across the two settings, fails startup, and so does
an additional key that KMS won't unwrap. The local
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

## Rotating the data key

Every sealed value records the `keyId` that sealed it. A process seals under
its **current** data key (`SECRETS_WRAPPED_DATA_KEY`) and opens under any data
key it loaded, so a new data key rolls out in steps, each a normal deploy, and
every running process can open every row at every point, a rolling deploy
included. Nothing reads or writes a sealed value any differently during or
after a rotation.

Start each step only once the previous step's deploy has fully rolled out, on
the realm server and the worker alike: every boot line from the new revision,
none from the old. A step taken mid-rollout reaches tasks the previous step
hasn't, which is exactly the state the order of the steps exists to avoid.

1. **Mint the new wrapped data key.** An admin-capable operator (the task roles
   can only `Decrypt`):

   ```sh
   aws kms generate-data-key-without-plaintext \
     --key-id alias/<env>-boxel-secrets --key-spec AES_256 \
     --encryption-context purpose=boxel-secrets-data-key \
     --query CiphertextBlob --output text
   ```

2. **Load it everywhere, not yet current.** Append the new blob to
   `/<env>/boxel/SECRETS_ADDITIONAL_WRAPPED_DATA_KEYS` (comma-separated) and
   deploy the realm server and the worker. Each boot line now lists both key
   ids, with the old one still `currentKeyId`.
3. **Make it current.** Swap: the new blob goes into
   `SECRETS_WRAPPED_DATA_KEY`, the old one into
   `SECRETS_ADDITIONAL_WRAPPED_DATA_KEYS`. Deploy. New writes seal under the
   new key; tasks still on the previous revision open them, because step 2
   loaded the new key there first.
4. **Re-seal the stored rows.**

   ```sh
   boxel realm-server data-keys reseal --realm-server <url> \
     --current-key <new key id> --wait
   ```

   `--current-key` names the data key step 3 made current. A task whose current
   key is different, such as one still on the previous revision, refuses with
   409 instead of re-sealing rows back under the old key. With `--wait` the
   command waits for the pass it started (polls that land on other tasks are
   read for their row counts only) and exits non-zero if rows are left. The
   command asks for the realm secret seed (or reads
   `BOXEL_REALM_SECRET_SEED`) and signs a five-minute operator token locally;
   the seed never leaves the machine. The realm server that answers runs the
   pass in the background: a batch at a time, every row of every column in
   `SEALED_COLUMNS` that isn't under the current key is opened and sealed again
   under it. A row is written back only if it still holds what the pass read,
   so a concurrent write wins. The pass is idempotent and resumable: run it
   again after a restart or a failure and it carries on with the rows left; a
   run with nothing left changes nothing. Each finished column logs
   `data-key reseal: <field> resealed=… changedConcurrently=… unopenable=…`.

5. **Retire the old key.** `boxel realm-server data-keys status --realm-server
<url>` lists the rows each data key sealed and `Retirable data keys`: loaded,
   not current, and referenced by no row. Check that its `Current data key` is
   the new one, since a task on another revision reports against its own
   current key. Then remove a retirable key's blob from
   `SECRETS_ADDITIONAL_WRAPPED_DATA_KEYS` and deploy.

`unopenable` rows (and a status that names `Rows reference data keys this
server has not loaded`) are rows sealed under a key the server doesn't hold, or
altered, or bound to values the row no longer has. The pass leaves them as they
are and the old key never becomes retirable while they exist; find the row ids
in the `data-key reseal` warnings before going further. Never retire a key
that status doesn't list as retirable: the rows it sealed stop opening.

At startup the realm server logs the same counts, one line per sealed column,
and warns when rows reference a data key it hasn't loaded:

```
sealed census: proxy_endpoints.api_key rowsByKeyId=kms-3f9c0a1b2c4d5e6f=12
```

### The `boxel realm-server` commands

`boxel realm-server` holds commands authorized only by the realm secret seed;
it is left out of the CLI's general help. The token they sign carries an
`operator` claim naming one family of endpoints (`data-keys` here), no user,
and lives at most 15 minutes, measured against the server's clock. The server
never mints one, accepts it only on that family's endpoints
(`GET /_data-keys`, `POST /_data-keys/reseal?currentKeyId=<id>`), and refuses
it everywhere a user or realm session is expected. The endpoints report key
ids and row counts, never a value.

### Adding a sealed column

A table that seals a column with the helper adds a `SealedColumn` to
`SEALED_COLUMNS` in `lib/secrets-at-rest/rotation.ts`: the binding field, the
table, an orderable unique id column, the four sealed-value columns, the other
columns its binding reads, and `binding(row)` returning exactly the binding its
writes seal under. Without the entry the pass never re-seals that column and
the census can't see it, so an old key can be retired while rows still need
it.

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
