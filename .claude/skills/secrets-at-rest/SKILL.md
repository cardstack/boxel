---
name: secrets-at-rest
description: Operate and diagnose the realm server's secrets-at-rest helper (`packages/realm-server/lib/secrets-at-rest/`) — AES-256-GCM sealing of stored secrets (API keys, OAuth client secrets and refresh tokens, service-account files, endpoint keys, webhook signing secrets) under a 32-byte data key that KMS wraps, bound to its field (table and column), owner, row id and destination. Covers the two providers (KMS and the local development key), the startup self-check the realm server and the worker manager run (workers take their keys from the manager) and what its log line reports, why a deployed server refuses to start, the KMS encryption contexts involved, key ids, re-sealing a secret with its destination, rotating the data key (`boxel realm-server data-keys status | reseal`, `SECRETS_ADDITIONAL_WRAPPED_DATA_KEYS`, the re-seal pass, retiring an old data key, the sealed census), the plaintext census and the drop of the plain-text columns, the sealed proxy endpoint (system) keys in `proxy_endpoints` and incoming webhook signing secrets in `incoming_webhooks`, what a read does with a sealed value that won't open, why a webhook's signing secret is shown only once, and the post-deploy audit that checks, as the read-only AWS role, that a deployed environment seals with KMS, holds no plain-text secrets, lets only the task roles decrypt and withholds the secret tables from the read-only database role. Use when the realm server or a worker won't boot with "Secrets-at-rest self-check failed", when reading the `secrets-at-rest` boot line, when a stored secret fails to open with SecretDecryptionError, when a table starts sealing its secrets with the helper, when rotating the data key, when a proxy endpoint is refused or a webhook's deliveries can't be verified, or after a deploy that changes any of this, to audit the deployed environment.
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

- A secret with no destination of its own, such as a user's key's master
  copy, is sealed under field, owner and id only. A user's key is never
  re-bound to a destination: each grant seals its own copy, sealed afresh from
  the opened master copy (see the `user-keys` skill).
  `keyring.reseal(sealed, from, to)` opens a value under one binding and seals
  it under another, as the data-key re-seal pass does under the same binding.
- A copy of a secret held in another row names that row as `parentId`. A
  grant's copy of a user's key is bound to the grant's id and, as its parent,
  the key's id, so it opens only on that grant of that key. A binding with a
  parent is laid out under its own label in the additional data, so a value
  sealed without one never opens as a copy, nor a copy without its parent.
- `secretEncryptionContext(binding)` is the context a value is bound to:
  `field`, `owner`, `id`, `parent_id` and `destination_sha256`. The destination appears only as its
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
sealed census: incoming_webhooks.signing_secret rowsByKeyId=kms-3f9c0a1b2c4d5e6f=40
```

### The `boxel realm-server` commands

`boxel realm-server` holds commands authorized only by the realm secret seed;
it is left out of the CLI's general help. The token they sign carries an
`operator` claim naming one family of endpoints (`data-keys` here;
`system-keys` for `boxel realm-server keys`), no user, the realm server's
origin as its audience (`aud`, which must match the origin the server knows
itself by, so `--realm-server` must be that URL), and lives at most 15
minutes, measured against the server's clock. The commands send it only over
https (or plain http to this machine) and never follow a redirect. The server
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

`PLAINTEXT_CENSUS` in `lib/secrets-at-rest/index.ts` lists each column that
holds a secret in plain text alongside its sealed copy: `proxy_endpoints.api_key`
and `incoming_webhooks.signing_secret`. At startup the realm server counts the
rows that still hold one, for each listed column that exists:

```
plaintext census: proxy_endpoints.api_key plaintextRows=12
plaintext census: incoming_webhooks.signing_secret plaintextRows=40
```

The application reads and writes only the sealed columns, so these counts are
rows holding a plain-text copy written by a revision that kept one. They stay
until the
removal migrations drop both columns, after the realm server is stable on the
revision that runs them. A boot line comes before that, so the deploy that
drops the columns still logs these counts. Every later start logs:

```
plaintext census: no plain-text secret columns
```

A count that fails logs a warning and doesn't stop startup.

Dropping a column only marks it dropped, and a row written before the drop
keeps its bytes in the table's pages until the row is rewritten. The removal
migration that follows the drop runs `VACUUM FULL` on both tables, which
rewrites them without those bytes. WAL archives and database snapshots taken
before the rewrite keep the plain text until they expire.

## Tables that seal in their own row

`lib/secrets-at-rest/sealed-columns.ts` holds what every such table shares.
The sealed value lives in four columns named after the field:
`<column>_ciphertext`, `<column>_nonce`, `<column>_tag` and `<column>_key_id`.
They are the only copy of the secret. `sealedColumnsSelect` is how a read
selects them, `sealedColumnBindings` how a write binds them, and
`openSealedColumns` how a read opens them under the row's binding.

A sealed value that doesn't open, because it was sealed under a data key the
process hasn't loaded or because a column its binding reads (the row's `id`,
its owner, its destination) was edited outside the application, has no other
copy to fall back on. The read reports it once per sealed value, as an error
naming the row (never the secret) on the table's log channel and to Sentry,
and the read fails: the proxy refuses that endpoint and the webhook receiver
verifies none of that webhook's deliveries. The binding is what stops a sealed secret being moved to
another row, owner or destination, so nothing re-seals such a row on its own.
An operator gives it its value again through the application, which seals it
under the row's current binding: `boxel realm-server keys replace` for a
system key, a rotation for a webhook secret. Or they restore the edited
columns.

### Rolling back to a revision that reads plain text

A revision that still reads `proxy_endpoints.api_key` or
`incoming_webhooks.signing_secret` can't be rolled back to without loss or an
outage once a sealed-only revision has run:

- **Before the drop.** The revision treats those columns as the source. If a
  realm-server rollout fails and rolls back before the removal migrations
  run, its startup backfill empties the sealed columns of every proxy
  endpoint written since with no plain-text key, and it can't verify a
  webhook with no plain-text secret. Add those system keys again
  (`boxel realm-server keys list` and `proxy_endpoint_history` show which) and
  rotate those webhook secrets.
- **After the drop, redeploying its image.** Its reads select the dropped
  columns, so it loads no proxy destination and answers every webhook
  delivery with 500 until the columns exist again. Roll forward instead.
- **After the drop, migrating down first.** The columns come back empty, and
  the revision behaves as before the drop for every row: add every system key
  again and rotate every webhook secret.

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

A row with none of the four set has no key. `readonly_role`, and every role
that is a member of it (the Grafana and Claude read-only database users), has
no `SELECT` on the table.

- **Reads** open the sealed key. A key that doesn't open (see above) is
  logged once per sealed value on the `proxy-endpoint-keys` channel,
  `the sealed key for proxy endpoint <url> … so the endpoint is refused until its key is replaced`,
  and reported to Sentry. `_request-forward` and the OpenRouter passthrough
  refuse that destination until the key is replaced, so a key bound to one
  url is never sent to another and the endpoint is never sent without it.
  Every other destination stays allowed: each endpoint is loaded on its own,
  and one that can't be (this, or an `openrouter` credit strategy with no
  key) is logged on the `allowed-proxy-destinations` channel and refused.
- **Writes** go through `saveProxyEndpoint` or the system-keys operator
  endpoints (`boxel realm-server keys`, see the `system-keys` skill). A
  hand-written `INSERT` or `UPDATE` can't seal a key, so it is never the way
  to add or change one.
- **Data-key rotation.** The column is registered in `SEALED_COLUMNS`
  (binding columns `id` and `url`), so the re-seal pass and the sealed census
  cover it.

## Incoming webhook signing secrets

`incoming_webhooks` holds the secret that verifies the signature on each
webhook Boxel receives at `/_webhooks/<webhook_path>`. Each secret is sealed
into `signing_secret_ciphertext`, `signing_secret_nonce`, `signing_secret_tag`
and `signing_secret_key_id`
(`packages/realm-server/lib/incoming-webhook-secrets.ts`), bound to:

| Binding       | Value                                                        |
| ------------- | ------------------------------------------------------------ |
| `field`       | `incoming_webhooks.signing_secret`                           |
| `owner`       | the row's `username`, the Matrix user who registered it      |
| `id`          | the row's `id`                                               |
| `destination` | none: Boxel never sends the secret, it only verifies with it |

`readonly_role` and its members have no `SELECT` on the table.

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
  A secret that isn't sealed or doesn't open is logged once per sealed value
  on the `incoming-webhook-secrets` channel,
  `the signing secret of incoming webhook <id> … so its deliveries can't be verified; rotate its secret to issue a new one`,
  and reported to Sentry, and the receiver answers each delivery with 500
  rather than verify it against anything. A changed `username` or `id`, or a
  data key this process hasn't loaded, leads here. A changed `username` would
  change who a verified delivery's commands run as, which is why the secret
  stays bound to the user who registered it; rotating it as the new owner
  issues a secret bound to them.
- **Data-key rotation.** The column is registered in `SEALED_COLUMNS`
  (binding columns `id` and `username`), so the re-seal pass and the sealed
  census cover it.

## Post-deploy audit

Four claims can only be checked in a deployed environment: the deployed
processes seal with KMS rather than the local key, no secret is left in plain
text, only the realm-server and worker task roles call `Decrypt` on the secrets
key, and the read-only database role can't read the tables that hold secrets.
This procedure checks all four. Run it after a deploy that changes anything
here, once that deploy has fully rolled out on the realm server and the worker
alike, and record what each step found against the deployed revision. A step
that doesn't come out as described below is a bug to file, not a variation to
explain away.

Every command runs as the `boxel-claude-readonly` role and reads only. The
`aws-access` skill covers getting that session, the database tunnel and the
rules that go with it. `ENV` is the full environment name, `staging` or
`production`, which is also the cluster name and the suffix of every service,
log group, key alias and SSM prefix the steps use.

### 0. The revision and the window

```sh
P=claude-staging ENV=staging   # claude-prod / production for prod
cd "$(mktemp -d)"              # the steps below leave their working files here

# Both services must show COMPLETED, with running equal to desired. The image
# tag is the commit the tasks run.
for svc in realm-server worker; do
  aws --profile $P ecs describe-services --cluster $ENV --services boxel-$svc-$ENV \
    --query "services[0].deployments[?status=='PRIMARY'] | [0].[taskDefinition, rolloutState, runningCount, desiredCount, createdAt]" \
    --output text
done
TD=$(aws --profile $P ecs describe-services --cluster $ENV --services boxel-realm-server-$ENV \
  --query 'services[0].taskDefinition' --output text)
aws --profile $P ecs describe-task-definition --task-definition "$TD" \
  --query 'taskDefinition.containerDefinitions[?name==`boxel-realm-server`].image' --output text

# What each running task actually runs: its task definition and image digest.
for svc in realm-server worker; do
  for t in $(aws --profile $P ecs list-tasks --cluster $ENV --service-name boxel-$svc-$ENV \
      --query 'taskArns' --output text); do
    aws --profile $P ecs describe-tasks --cluster $ENV --tasks "$t" \
      --query "tasks[0].[taskDefinitionArn, lastStatus, containers[?name=='boxel-$svc'].imageDigest | [0]]" \
      --output text
  done
done

# The boot-line window opens when the earlier of the two rollouts started.
SINCE=$(for svc in realm-server worker; do
  aws --profile $P ecs describe-services --cluster $ENV --services boxel-$svc-$ENV \
    --query "services[0].deployments[?status=='PRIMARY'] | [0].createdAt" --output text
done | xargs -I{} date -u -d {} +%FT%TZ | sort | head -1)
SINCE_MS=$(( $(date -u -d "$SINCE" +%s) * 1000 ))

# The current tasks, by id. Each one should show up in steps 1 and 3.
for svc in realm-server worker; do
  aws --profile $P ecs list-tasks --cluster $ENV --service-name boxel-$svc-$ENV \
    --query 'taskArns' --output text | tr '\t' '\n' | sed 's#.*/##'
done > tasks.txt
```

Record the image tag and the digest. Every running task is `RUNNING` on the
primary task definition, and all tasks of a service share one digest. The
CI deploy tags each image with its commit. A task definition registered some
other way can name a tag such as `latest`, and the role can't look a digest up
in ECR, so record the digest and say the commit is unconfirmed. A digest equal
to one an earlier commit-tagged revision ran is that commit.

`date -d` is GNU. On macOS, use `gdate` from coreutils.

### 1. The boot lines

Each task logs the startup self-check once, the plaintext census once, and the
sealed census once per column it covers, as the sections above describe. Shipped lines are
JSON, with the line itself in `log` and the task's ARN in `ecs_task_arn`:

```sh
for svc in realm-server worker; do
  aws --profile $P logs filter-log-events --log-group-name ecs-boxel-$svc-$ENV \
    --start-time $SINCE_MS \
    --filter-pattern '?"secrets at rest:" ?"plaintext census:" ?"sealed census" ?"Secrets-at-rest self-check failed" ?"Could not get the secrets keyring"' \
    --output json \
    | jq -r --arg svc $svc '.events[] | (.message | fromjson? // {log: .}) as $m
        | [(.timestamp / 1000 | todate), ($m.ecs_task_arn // "" | split("/") | last),
           $svc, $m.log] | @tsv'
done | tee boot-lines.tsv

# Current tasks with no self-check line. Expect nothing.
awk -F'\t' '$4 ~ /^secrets at rest: provider=/ { print $2 }' boot-lines.tsv | sort -u \
  | comm -13 - <(sort tasks.txt)
```

The second column is the task id, as in `tasks.txt`. Tasks replaced since the
window opened appear too; judge the current ones. What should be there:

- **Every current realm-server and worker task:** one
  `secrets at rest: provider=kms deployed=true keyIds=kms-… currentKeyId=kms-…`.
  Every task names the same `currentKeyId`, and no task names
  `local-development`.
- **Every worker process:** one `secrets at rest: received keyIds=… from the
worker manager` naming its task's key ids.
- **Every realm-server task:** `plaintext census: no plain-text secret
columns`, and `sealed census:` naming only the key ids the self-check
  loaded. A table with no rows reports `rowsByKeyId=none`. A task that
  started before the removal migrations ran (the deploy that drops the
  columns) logs `plaintextRows=` counts instead; step 4 checks the columns
  are gone.
- **None of:** `Secrets-at-rest self-check failed`, `Could not get the
secrets keyring`, `sealed census failed` or
  `plaintext census: counting … failed`. Each failure takes the place of the
  line it would have logged, so a missing census line is a finding too.

### 2. The key and its policy

```sh
KEY_ARN=$(aws --profile $P kms describe-key --key-id alias/$ENV-boxel-secrets \
  --query KeyMetadata.Arn --output text)

aws --profile $P kms describe-key --key-id "$KEY_ARN" \
  --query 'KeyMetadata.{state:KeyState,usage:KeyUsage,spec:KeySpec,origin:Origin,manager:KeyManager,multiRegion:MultiRegion,created:CreationDate}'
aws --profile $P kms get-key-rotation-status --key-id "$KEY_ARN"
aws --profile $P kms list-aliases --key-id "$KEY_ARN" --query 'Aliases[].AliasName'

POLICY=$(aws --profile $P kms get-key-policy --key-id "$KEY_ARN" --policy-name default \
  --query Policy --output text)
# Each statement's principals, actions and conditions, flattened.
jq -c '.Statement[] | {Sid, Effect, principals: ([.Principal.AWS] | flatten),
  actions: ([.Action] | flatten), Condition}' <<< "$POLICY"
# Allowed actions that would let a caller use the key beyond the startup
# unwrap and minting a wrapped data key. IAM ignores case in action names, so
# the test does too. Expect [].
jq -c '[.Statement[] | select(.Effect == "Allow") | [.Action] | flatten | .[]
  | select(test("Encrypt|GenerateDataKey$|GenerateDataKeyPair|CreateGrant|\\*"; "i"))]' <<< "$POLICY"
```

What should be there:

- The key is `Enabled`, `ENCRYPT_DECRYPT`, `SYMMETRIC_DEFAULT`, origin
  `AWS_KMS`, manager `CUSTOMER`, not multi-Region, with rotation enabled, and
  `alias/<env>-boxel-secrets` is its only alias.
- `kms:Decrypt` is allowed to exactly two principals,
  `role/boxel-realm-server-<env>-ecs-task` and `role/boxel-worker-<env>-ecs-task`,
  and only with `kms:EncryptionContext:purpose` equal to
  `boxel-secrets-data-key`.
- The account root holds key administration, and
  `kms:GenerateDataKeyWithoutPlaintext` only with `purpose` as the only
  encryption-context key. No statement allows `Encrypt`, `ReEncrypt*`, a
  plaintext `GenerateDataKey*`, `CreateGrant` or `kms:*`, so the second `jq`
  prints `[]`.

The role can't call `ListGrants`. That leaves nothing unchecked, because no
principal can create a grant on a key whose policy allows no `CreateGrant`.

### 3. Who used the key

Every call on the key is in CloudTrail event history for 90 days. For a first
audit, start the window at the key's `CreationDate` (from `describe-key`).
After that, start it where the previous audit ended:

```sh
FROM=<ISO 8601 UTC, e.g. 2026-01-01T00:00:00Z>

aws --profile $P cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue="$KEY_ARN" \
  --start-time "$FROM" --query 'Events[].CloudTrailEvent' --output json > key-events.json

# Calls by event, caller (session name dropped) and outcome.
jq -r '.[] | fromjson | [.eventName,
    ((.userIdentity.arn // .userIdentity.invokedBy) | sub("/[^/]+$"; "/*")),
    (.errorCode // "ok")] | @tsv' key-events.json | sort | uniq -c | sort -rn

# The encryption context of every Decrypt.
jq -r '.[] | fromjson | select(.eventName == "Decrypt")
  | .requestParameters.encryptionContext | tojson' key-events.json | sort | uniq -c

# Decrypts per task. A task role's session name is the task id.
jq -r '.[] | fromjson | select(.eventName == "Decrypt")
  | .userIdentity.arn | split("/")[2]' key-events.json \
  | sort | uniq -c | awk '{ print $2, $1 }' > decrypts.txt
# The self-check unwraps each data key it loads with one Decrypt, so a task
# should have made as many as the key ids its step 1 boot line lists.
awk -F'\t' '$4 ~ /^secrets at rest: provider=/ {
    match($4, /keyIds=[^ ]*/); print $2, split(substr($4, RSTART + 7, RLENGTH - 7), k, ",") }' \
  boot-lines.tsv | sort -u > expected-decrypts.txt
# Tasks in the window whose count differs, or that have none. Expect nothing.
join -a1 expected-decrypts.txt decrypts.txt | awk '$2 != $3'
# Tasks from before the window that made more than one. Expect nothing outside
# a rotation.
join -v2 expected-decrypts.txt decrypts.txt | awk '$2 != 1'

# Shells opened in a task, which act with its task role.
aws --profile $P cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=ExecuteCommand \
  --start-time "$FROM" --query 'Events[].CloudTrailEvent' --output json \
  | jq -r '.[] | fromjson | [.eventTime, .userIdentity.arn, .requestParameters.task] | @tsv'
```

What should be there:

- `Decrypt` comes only from the two task roles, always `ok`, and always under
  `{"purpose":"boxel-secrets-data-key"}`.
- Each task calls `Decrypt` once per data key it loads, at startup: once
  outside a rotation, and once more for each key in
  `SECRETS_ADDITIONAL_WRAPPED_DATA_KEYS` while one is under way. Both `join`
  checks print nothing once the most recent task has been up for the fifteen
  minutes an event can take to appear. A task that started before a rotation
  step and is still in the history counts the keys it loaded then.
- No `ExecuteCommand` on a realm-server or worker task. Both services run with
  ECS Exec enabled, and a shell in a task holds the task role's credentials, so
  a `Decrypt` made from it shows the same role and session name as the startup
  unwrap. Only its timing and the `ExecuteCommand` event, under a person's
  identity, tell them apart.
- Anything else comes from an operator identity at a time someone can account
  for (creating the key, minting a wrapped data key with
  `GenerateDataKeyWithoutPlaintext`), from `kms.amazonaws.com` for scheduled
  `RotateKey`, or from `boxel-claude-readonly` reading metadata. These are
  alarming whoever made them: `PutKeyPolicy`, which can undo every claim in
  step 2; `CreateAlias`, `UpdateAlias` or `DeleteAlias` after setup;
  `DisableKey`; `ScheduleKeyDeletion`.

The `aws-access` skill's KMS section has the notes on how event history
answers (delay, paging, throttling), which apply to every lookup here.

Denied calls carry no resource, so this lookup misses them. The `aws-access`
skill's KMS section has the lookup by event name that finds them. Keep its
window to hours around the deploy: the `Decrypt` lookup covers every key in
the account.

### 4. What the read-only role can read

Open the database tunnel as `aws-access` describes, with
`SSM_PREFIX=/$ENV/boxel`. These two commands take the place of its step 4,
credential prefix and all. The identity check runs first, on its own, and the
rest runs only once it prints `claude_readonly_user|t`:

```sh
PGUSER=$CLAUDE_USER PGPASSWORD=$(aws --profile $PROFILE ssm get-parameter \
  --name $SSM_PREFIX/CLAUDE_DB_PASSWORD --with-decryption \
  --query 'Parameter.Value' --output text) \
  psql -h localhost -p $LOCAL_PORT -A -t \
  -c "SELECT current_user, pg_has_role(current_user, 'readonly_role', 'member')"
```

Then each statement as its own `-c`, so one denial doesn't stop the rest, and
without `-t`, so a statement that succeeds prints its header and row count:

```sh
PGUSER=$CLAUDE_USER PGPASSWORD=$(aws --profile $PROFILE ssm get-parameter \
  --name $SSM_PREFIX/CLAUDE_DB_PASSWORD --with-decryption \
  --query 'Parameter.Value' --output text) \
  psql -h localhost -p $LOCAL_PORT -A \
  -c "SELECT * FROM proxy_endpoints LIMIT 0" \
  -c "SELECT * FROM incoming_webhooks LIMIT 0" \
  -c "SELECT * FROM user_keys LIMIT 0" \
  -c "SELECT * FROM key_write_tickets LIMIT 0" \
  -c "SELECT * FROM user_key_grants LIMIT 0" \
  -c "SELECT * FROM secure_sessions LIMIT 0" \
  -c "WITH RECURSIVE reader (oid) AS (
        SELECT oid FROM pg_roles WHERE rolname = 'readonly_role'
        UNION
        SELECT m.member FROM pg_auth_members m JOIN reader ON reader.oid = m.roleid
        WHERE m.inherit_option OR m.set_option)
      SELECT r.rolname, t.relname, c.attname
      FROM reader JOIN pg_roles r ON r.oid = reader.oid
      CROSS JOIN pg_class t JOIN pg_attribute c ON c.attrelid = t.oid
      WHERE t.oid IN (to_regclass('proxy_endpoints'), to_regclass('incoming_webhooks'),
                      to_regclass('user_keys'), to_regclass('key_write_tickets'),
                      to_regclass('user_key_grants'), to_regclass('secure_sessions'))
        AND reader.oid <> t.relowner AND c.attnum > 0 AND NOT c.attisdropped
        AND has_column_privilege(reader.oid, t.oid, c.attnum, 'SELECT')" \
  -c "SELECT attrelid::regclass, attname FROM pg_attribute
      WHERE (attrelid, attname) IN (('proxy_endpoints'::regclass, 'api_key'),
                                    ('incoming_webhooks'::regclass, 'signing_secret'))
        AND NOT attisdropped"
```

`LIMIT 0` means a table that is wrongly readable prints its column names and
`(0 rows)`, and no values, so the check can't expose a secret.

What should be there:

- `claude_readonly_user|t` from the first command.
- `permission denied for table <table>` for each table, and no `(0 rows)`
  among them. A table that the
  deployed revision doesn't have yet answers `relation "<table>" does not
exist` instead. Check that against the revision from step 0 before taking it
  as a finding.
- `(0 rows)` from the role query. It asks the same question as the migration
  that checks these grants, about `readonly_role` and every role that reads
  through it. A row names a role and a column it can read.
- `(0 rows)` from the last query: neither plain-text column exists. The
  catalog is readable to the role even where the tables aren't. A row names a
  column the removal migrations haven't dropped yet.

The list of tables is the one that migration
(`check-readonly-role-cant-read-withheld-tables`) checks, plus
`user_key_grants` and `secure_sessions`, whose own migrations check them. A table added to either one
goes here too.

The role is also denied the wrapped data key itself. Expect
`AccessDeniedException`:

```sh
aws --profile $P ssm get-parameter --name /$ENV/boxel/SECRETS_WRAPPED_DATA_KEY \
  --query Parameter.Name --output text
```
