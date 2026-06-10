---
name: aws-access
description: Provision an AWS STS session for Claude to use against staging or prod, and reach the deployed environment's data plane from there. Covers (1) the first-time setup walkthrough for a teammate who has never let Claude reach AWS, (2) refreshing an expired session, (3) running read-only queries against the private staging/prod boxel Postgres via SSM port-forwarding through the realm-server ECS task, authenticated as `claude_readonly_user` (a dedicated DB user, member of `readonly_role`), (4) browsing the realm-server's EFS filesystem read-only via a dedicated `boxel-claude-fs-readonly` Fargate task (Caddy file-server, port-forwarded over SSM), and (5) tailing CloudWatch logs for the four boxel ECS services. Claude operates as the dedicated `boxel-claude-readonly` IAM role — its effective AWS permissions are exactly that role's policy, regardless of which IAM groups the user is in. Use whenever Claude needs to call AWS APIs against the cardstack accounts, read/inspect the boxel_index database, browse `/persistent/` files, or read service logs in a deployed environment, or whenever the user asks "how do I connect Claude to AWS / staging / prod" or any of the deployed-env triage questions ("why is this realm indexing slowly", "show me the realm-server logs from last night", "is this file actually on disk in staging").
allowed-tools: Read, Grep, Glob, Bash
---

# AWS access (staging + prod) and RDS querying

This skill exists because:

1. The team's existing `staging` / `prod` shell aliases export AWS credentials into the user's interactive shell, but Claude's Bash tool spawns its own shell that does not inherit them.
2. The boxel staging/prod RDS instances are not publicly reachable — they live inside the AWS VPC.

The flow below solves both: a wrapper script that mints a scoped STS session and writes its credentials to a _named profile_ in `~/.aws/credentials` so Claude can read them from any shell, plus the SSM port-forward pattern for talking to the in-VPC database.

The script and mise task are in this repo:

- `scripts/claude-aws.sh`
- `mise-tasks/claude-aws`

Profile convention is fixed (don't change without a heads-up):

- `claude-staging` — staging temp session (holds `boxel-claude-readonly` role creds)
- `claude-prod` — prod temp session (holds `boxel-claude-readonly` role creds)

## Identity model (CS-10962)

The credentials in `[claude-staging]` / `[claude-prod]` are _not_ the user's IAM identity. The script does:

1. Reads the user's long-lived IAM access keys (held in their source profile, e.g. `cardstack`).
2. Calls `sts:AssumeRole arn:aws:iam::<account>:role/boxel-claude-readonly` directly, passing the user's MFA token via `--serial-number` and `--token-code`. The role's trust policy requires `aws:MultiFactorAuthPresent: true`, which is satisfied by these flags. This is the MFA gate.
3. Writes the role's credentials to `[claude-<env>]`. Session length is the role's `max_session_duration` (12h).

Net effect: every `aws --profile claude-<env> ...` call Claude makes runs as `boxel-claude-readonly`, with exactly that role's policy. The user's IAM group memberships only matter to the extent that they grant `sts:AssumeRole` on the role; once the role is assumed, the user's groups are no longer in the picture. The role is the same name (`boxel-claude-readonly`) in both staging and prod, provisioned by the infra side of CS-10962.

This is why teammates see one identity in their interactive shell (`aws sts get-caller-identity` shows the user) and Claude sees a different one (it shows the role) — that's by design.

## When the user asks "how do I do this?"

Walk them through it in order. Most of the steps are one-time; only the last is per-MFA-refresh.

### 1. Pre-reqs (one-time, per teammate)

The user needs:

- `aws` CLI installed.
- `jq` installed (`brew install jq` / `apt install jq`).
- `session-manager-plugin` installed — required for the SSM port-forward tunnel to RDS. Install instructions: <https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html>. macOS: `brew install --cask session-manager-plugin`. Ubuntu: download the deb from the page and `sudo dpkg -i`.
- A working AWS named profile in `~/.aws/credentials` for staging (typically `cardstack`) and for prod (typically `cardstack-prod`). These hold the user's long-lived access keys; they're what the team sets up via `aws configure --profile <name>` on day one. The script uses these as the _source_ profile to mint an STS session — the user can name them whatever they want and the script will prompt the first time it runs.
- An MFA device registered on the IAM user. The script auto-detects the MFA ARN via `aws iam list-mfa-devices`, so the user does not edit anything.
- IAM permission to `sts:AssumeRole` on `boxel-claude-readonly` in the target account. The infra side of CS-10962 grants this to the `read-only` and `full-access` groups in both staging and prod, so any teammate already set up to use staging/prod has it automatically.

### 2. First-time configuration (one-time, per env)

The first time the user runs `mise run claude-aws staging <token>`, the script will list profiles in `~/.aws/credentials` and prompt:

```
Source AWS profile for staging:
```

Type the source profile name (e.g. `cardstack`). It's saved to `${XDG_CONFIG_HOME:-~/.config}/claude-aws/config` (the XDG config directory; default is `~/.config/claude-aws/config`) and never prompted for again unless the user passes `--source-profile <name>` to override. Same dance for prod the first time `mise run claude-aws prod <token>` is run.

If you typed the wrong profile name (or want to clear the cache for any reason), run:

```sh
mise run claude-aws --reset
```

That wipes the config file (path above) so the next normal invocation prompts again from scratch. `--reset` takes no other arguments — just `--reset`, no env, no token. It does not require `aws` / `jq` to be installed, so it's also the right recovery path on a freshly-cloned machine before the rest of the prereqs are in place. Equivalent shortcut to deleting the config file by hand.

### 3. Per-session — refresh the role-assumed credentials (every ~12h)

```sh
mise run claude-aws staging <MFA_TOKEN>
mise run claude-aws prod    <MFA_TOKEN>
```

Output ends with `Identity: arn:aws:iam::...:role/boxel-claude-readonly (assumed)` and `Expires: <ISO timestamp>`. The role session lasts up to 12h (the role's `max_session_duration`); MFA is applied at the AssumeRole call itself via `--serial-number` / `--token-code`. When it expires, run the same command with a fresh MFA token.

After that, Claude can run any `aws --profile claude-staging ...` or `aws --profile claude-prod ...` command without further intervention until expiration.

### Troubleshooting walkthrough

| Symptom                                                                                                                                                                                   | What to tell the user                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mise ERROR no task claude-aws found`                                                                                                                                                     | They typed it wrong (common: `cluade-aws`) or the mise task file is missing — re-clone or pull main.                                                                                                                                                                                                  |
| `An error occurred (AccessDenied) … MultiFactorAuthentication failed with invalid MFA one time pass code`                                                                                 | The token expired before they hit enter. Wait for a fresh code and try again.                                                                                                                                                                                                                         |
| `No source AWS profile is configured for 'staging'.` followed by a list                                                                                                                   | Expected on first run. Type the source profile name (most teammates use `cardstack` / `cardstack-prod` but it varies).                                                                                                                                                                                |
| `No MFA device registered for profile <name>`                                                                                                                                             | They picked the wrong source profile (cached on first run). List MFA devices: `aws iam list-mfa-devices --profile <profile>`. To clear the bad choice and re-prompt, run `mise run claude-aws --reset`, then re-run with the right profile.                                                           |
| `An error occurred (AccessDenied) when calling the AssumeRole operation: User: ... is not authorized to perform: sts:AssumeRole on resource: arn:aws:iam::...:role/boxel-claude-readonly` | Either the infra side of CS-10962 hasn't been applied to that account yet (so the role doesn't exist or doesn't trust the user's group), or the user's IAM user isn't in `read-only` or `full-access`. Check role existence: `aws --profile <source> iam get-role --role-name boxel-claude-readonly`. |
| `An error occurred (NoRegion)` when Claude later runs `aws --profile claude-staging …`                                                                                                    | They ran the script on an old version that didn't carry region forward. Either re-run `mise run claude-aws <env> <token>` (the current script copies the region from the source profile), or set it manually: `aws configure set region us-east-1 --profile claude-staging`.                          |

## How Claude uses the session

### Verifying the session is still valid before running a sequence of AWS calls

```sh
grep claude_session_expiration ~/.aws/config
```

The `[profile claude-staging]` / `[profile claude-prod]` sections of **`~/.aws/config`** (not `~/.aws/credentials`) carry a custom key `claude_session_expiration = <ISO timestamp>`. The split is an `aws configure set` quirk — recognized credential keys (`aws_access_key_id`, `aws_secret_access_key`, `aws_session_token`) land in `~/.aws/credentials`; anything else (region, our custom expiration key) lands in `~/.aws/config`. Compare the timestamp to the current time (`date -u +%FT%TZ`). If expired or absent, ask the user to run `mise run claude-aws <env> <token>`. **Do not try to refresh the session yourself** — it requires a fresh MFA code from the user.

A cheap end-to-end check that also confirms which identity Claude is operating as:

```sh
aws --profile claude-<env> sts get-caller-identity
```

The `Arn` should look like `arn:aws:sts::<account>:assumed-role/boxel-claude-readonly/claude-<env>-<epoch>`. If it shows the user's IAM user instead, something has gone wrong (likely an old session predating the CS-10962 change) — re-run the script.

### Sanity checks once the session is good

```sh
# Confirm region (script copies it from the source profile)
aws --profile claude-staging configure get region

# List ECS clusters to confirm scope
aws --profile claude-staging ecs list-clusters --query 'clusterArns' --output text
```

## Prod IAM access — the `boxel-claude-readonly` role is the scoping boundary

Claude operates against staging and prod **only as the `boxel-claude-readonly` IAM role**. The role's policy is the entire AWS-side permission surface Claude has — there is no path for Claude to access anything the role doesn't grant, regardless of what the user's own IAM groups allow. This is symmetric across staging and prod: the role exists in both accounts under the same name and is intended to grant the same permissions in both.

The role is provisioned by infra-side configuration tracked under CS-10962. Anything that would require a permission outside the role's policy is out of scope for Claude — the user should run that operation themselves through whatever channel the team uses for it. This is by design: the role is the AWS-side complement to the claude-readonly-only DB rule below, and together they make accidental writes structurally hard to issue.

### Global read-only control-plane APIs (CloudFront, etc.)

Some services Claude reads are **global control-plane APIs that need none of the SSM-tunnel / ECS machinery** below — just call them directly with the session profile, no region tunnel, no DB/EFS hop:

```sh
aws --profile claude-staging cloudfront list-distributions
aws --profile claude-prod    cloudfront get-distribution-config --id <id>
```

For **CloudFront** specifically, the role grants read across the relevant surface in both accounts: `list-distributions`, `get-distribution-config`, `list-invalidations`, `get-invalidation`, `list-tags-for-resource`, and the policy lookups (`get-cache-policy` / `get-origin-request-policy` / `get-response-headers-policy`). **Writes are denied** — `create-invalidation`, `update-distribution`, `tag-resource`, etc. all `AccessDenied`, consistent with the read-only boundary. So a full CloudFront audit (distributions, origins/behaviors, TLS, custom errors, invalidation history, tags) is doable end-to-end as the role; cache-busting and config changes are not.

Two operational notes when fanning these out:

- CloudFront throttles aggressively — firing ~60 calls at once gets `Throttling: Rate exceeded` on some. Cap concurrency or fall back to sequential with a small `sleep`.
- AWS CLI v2 auto-pagination quirk: for _paginated_ list operations (e.g. `list-invalidations`, `list-distributions`), the CLI prints **nothing** (empty stdout, exit 0) when there are zero items — including under the default/JSON output. This is the pagination layer, not the output format: `--no-paginate` returns the normal `{"InvalidationList": { … "Quantity": 0 }}` payload, and non-paginated calls like `list-tags-for-resource` print `{"Items": []}` for an empty result. So empty stdout _from a paginated list_ means "zero items," not an error — but don't generalize that to other commands, which return a normal JSON payload for empty results.

## Connecting to the boxel RDS database

The staging/prod boxel Postgres instances are **private** (`PubliclyAccessible: false`) and live inside the cardstack VPC. They are not directly reachable from a developer laptop. The only path Claude uses is SSM port-forwarding through the realm-server ECS task, authenticated as the read-only `claude_readonly_user` DB user.

### Path A — SSM port-forward → psql on localhost as the `claude_readonly_user` DB user

> All `aws --profile claude-<env> ...` commands below run as the `boxel-claude-readonly` role, not as your user. The procedural commands look the same as before — only the credentials underneath differ.

This opens an SSM tunnel through the realm-server container to the RDS endpoint, then you connect with a normal local psql **as `${CLAUDE_DB_USER}`** (`claude_readonly_user` by convention), which is a member of `readonly_role` and has SELECT-only access to the boxel database. Two layers of safety: AWS-side (the role's policy permits the SSM port-forward and the SSM `GetParameter` reads needed below, but does not permit `ecs:ExecuteCommand` and does not grant access to the realm-server's PGUSER/PGPASSWORD parameters) and DB-side (the user is read-only via `readonly_role`).

Verified on staging via `has_table_privilege(current_user, 'boxel_index', '...')`:

| Privilege                                     | Result                                     |
| --------------------------------------------- | ------------------------------------------ |
| SELECT                                        | ✓ (granted via `readonly_role` membership) |
| INSERT / UPDATE / DELETE / TRUNCATE           | ✗                                          |
| superuser / createrole / createdb / bypassrls | all `f`                                    |

The user is dedicated to Claude so `pg_stat_activity` and slow-query logs cleanly identify triage traffic. It inherits from `readonly_role`, which is where the SELECT-on-public grants live — defined once, applied to whichever users are members.

Source of truth:

- `readonly_role` — defined in `packages/postgres/migrations/1751981407344_setup-grafana-db-user.js` (`CONNECT` on `boxel` / `USAGE` on `public` / `SELECT` on all current tables, plus default privileges so future tables inherit). The filename is historical; the role itself is general.
- `claude_readonly_user` — defined in `packages/postgres/migrations/1777413435523_setup-claude-readonly-db-user.js`, granted `readonly_role`. Both migrations gate on `REALM_SENTRY_ENVIRONMENT in (staging, production)`, so they only run in deployed environments.

Credentials live at SSM `<env-prefix>/CLAUDE_DB_USER` / `CLAUDE_DB_PASSWORD`.

```sh
PROFILE=claude-staging                         # or claude-prod
CLUSTER=staging                                # or production (verify)
SERVICE=boxel-realm-server-staging             # or the prod equivalent
SSM_PREFIX=/staging/boxel                      # or /production/boxel
LOCAL_PORT=55432                               # any free local port

# 1) Find the running task and its container runtime ID. SSM port-forwarding
#    targets ECS by `cluster_<task-id>_<runtime-id>`, where runtime-id is
#    the Docker container ID. Filter the describe-tasks query by container
#    name — `containers[0]` is brittle because the realm-server task has
#    a firelens log-routing sidecar and AWS does not guarantee the array
#    order in DescribeTasks output.
TASK_ARN=$(aws --profile $PROFILE ecs list-tasks \
  --cluster $CLUSTER --service-name $SERVICE \
  --query 'taskArns[0]' --output text)
TASK_ID=${TASK_ARN##*/}
RUNTIME_ID=$(aws --profile $PROFILE ecs describe-tasks \
  --cluster $CLUSTER --tasks $TASK_ID \
  --query 'tasks[0].containers[?name==`boxel-realm-server`].runtimeId | [0]' \
  --output text)

# 2) Pull DB connection params + the claude_readonly credentials from SSM
#    Parameter Store. CLAUDE_DB_PASSWORD is a SecureString — needs
#    --with-decryption (and KMS perm). The boxel-claude-readonly IAM role
#    is NOT granted access to any other DB-credential SSM parameter
#    (notably the realm-server's PGUSER/PGPASSWORD), so trying to read
#    those would fail at the IAM layer. Don't try.
RDS_HOST=$(aws --profile $PROFILE ssm get-parameter \
  --name $SSM_PREFIX/PGHOST --query 'Parameter.Value' --output text)
export PGDATABASE=$(aws --profile $PROFILE ssm get-parameter \
  --name $SSM_PREFIX/PGDATABASE --query 'Parameter.Value' --output text)
export CLAUDE_USER=$(aws --profile $PROFILE ssm get-parameter \
  --name $SSM_PREFIX/CLAUDE_DB_USER --query 'Parameter.Value' --output text)
export CLAUDE_PASSWORD=$(aws --profile $PROFILE ssm get-parameter \
  --name $SSM_PREFIX/CLAUDE_DB_PASSWORD --with-decryption --query 'Parameter.Value' --output text)

# 3) Open the tunnel in the background. Wait for "Waiting for connections..."
#    in its output before connecting.
aws --profile $PROFILE ssm start-session \
  --target "ecs:${CLUSTER}_${TASK_ID}_${RUNTIME_ID}" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"portNumber\":[\"5432\"],\"localPortNumber\":[\"$LOCAL_PORT\"],\"host\":[\"$RDS_HOST\"]}" &
TUNNEL_PID=$!

# 4) Run queries against localhost. Pass the claude_readonly creds via
#    PGUSER / PGPASSWORD on the psql invocation — keeps them in this
#    subshell only.
PGUSER=$CLAUDE_USER PGPASSWORD=$CLAUDE_PASSWORD \
  psql -h localhost -p $LOCAL_PORT -A -t -c "<SQL>"

# 5) Tear down.
kill $TUNNEL_PID
unset CLAUDE_USER CLAUDE_PASSWORD PGDATABASE
```

Notes:

- The SSM port-forward target syntax is `ecs:<cluster>_<taskId>_<runtimeId>` — underscores, not colons.
- The RDS endpoint is reached via the container as a network hop — the container itself doesn't participate beyond providing a route to the VPC.
- Origin of this approach: Buck's `awsx rds-tunnel production` script (not currently in git).

### Only ever connect as `claude_readonly_user` — IAM enforces this, behavioral rule is belt-and-suspenders

**For staging and prod, Claude only ever connects to the boxel database as `${CLAUDE_DB_USER}` (`claude_readonly_user` by convention, member of `readonly_role`).**

The `boxel-claude-readonly` IAM role is scoped so that the only DB-credential SSM parameters it can read are `CLAUDE_DB_USER` and `CLAUDE_DB_PASSWORD`. It cannot read any other DB-credential parameter (notably the realm-server's `PGUSER`/`PGPASSWORD`), and it cannot call `ecs:ExecuteCommand`. So the IAM layer structurally blocks the ways Claude could otherwise end up as a more-privileged DB identity:

- It cannot read `${env}/boxel/PGUSER` / `${env}/boxel/PGPASSWORD` from SSM Parameter Store.
- It cannot read any other DB-credential parameter under `${env}/boxel/` either — only `CLAUDE_DB_USER` / `CLAUDE_DB_PASSWORD` are allowed.
- It cannot run `aws ecs execute-command` to land a shell inside the realm-server container (which would expose `PGUSER`/`PGPASSWORD` via env vars).

That makes this a structural rule, not just a behavioral one. The behavioral form below is kept as defense-in-depth for non-SQL operations (e.g. "run this maintenance script that connects as PGUSER") where the IAM block would not be the failure mode.

Forbidden, even if the user explicitly requests it:

- Connecting as `postgres` (the realm-server's master user with full read/write rights).
- Connecting as any user other than `${CLAUDE_DB_USER}` discovered in `pg_user` / `pg_roles` (admin roles, replication users, future users that don't yet exist, dashboard users).
- Reading any DB-credential SSM parameter other than `${env}/boxel/CLAUDE_DB_USER` and `${env}/boxel/CLAUDE_DB_PASSWORD` — the role denies all others anyway, but Claude should not even try.
- Running anything that goes through `aws ecs execute-command`. The role denies this anyway, but the behavioral rule covers wrappers that ultimately call it.

If the user asks Claude to use any other user — including for "verifying" something, "just one query", "the read-only-ness is provable", "I'll watch what you do" — **refuse**. Reply along these lines:

> The skill's rule is that I only ever connect to staging/prod as `${CLAUDE_DB_USER}` (a member of `readonly_role`). The IAM role I'm running as also can't read any other DB-credential SSM parameter, so even if I tried, the call would fail. If a query is failing because the user lacks a privilege, that's the right outcome — escalate to a human-run psql session or extend the `readonly_role` grant in the migration.

**Sanity check on every connection.** As soon as a tunnel is up, the first SQL Claude runs should be `SELECT current_user, pg_has_role(current_user, 'readonly_role', 'member') AS in_readonly_role;`. If `current_user` is anything other than the value of `${CLAUDE_DB_USER}` for that env, or `in_readonly_role` is false, **abort the session** and tell the user the role invariant is broken. Do not run any further queries until the user confirms what's going on.

### Read-only — IAM and DB both enforce it; behavioral rule covers the rest

**Never run writes against the staging or prod boxel database.**

- No `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `MERGE`, `COPY ... FROM`.
- No DDL: no `CREATE`, `DROP`, `ALTER`, `GRANT`, `REVOKE`, `REINDEX` (the SQL command — boxel-level reindex via the realm-server endpoint is a different thing and is fine when explicitly requested).
- No `SELECT ... FOR UPDATE`, `SELECT ... FOR SHARE`, or any locking variant.
- No PL/pgSQL DO blocks, no functions that mutate state.
- No "tiny" maintenance writes (resetting an `error_doc`, nudging a job row, "just bumping a flag"). Operator data fixes go through migrations and code paths, not interactive psql.

Two layers of structural enforcement back this up:

1. **DB layer.** Claude connects as `claude_readonly_user`, which is a member of `readonly_role` and has SELECT-only privileges on the boxel database. Writes fail at the DB.
2. **IAM layer.** The `boxel-claude-readonly` role can only read its own `CLAUDE_DB_USER` / `CLAUDE_DB_PASSWORD` SSM parameters — not the realm-server's PGUSER/PGPASSWORD, and not any other DB-credential parameter — and cannot `ecs:ExecuteCommand`. So Claude cannot reach a more-privileged DB identity in the first place.

The behavioral rule is the third layer — defense-in-depth for the operations that aren't write SQL but are still mutating (e.g. "run this maintenance script", "kick off this job"). If the user asks you to run a write, refuse and explain that the rule is no-writes-from-Claude-against-deployed-databases regardless of who's asking. Suggest the proper path: a migration in `packages/realm-server/migrations/`, a PR, or having the user run it themselves through a sanctioned admin script.

When constructing a query, the cheapest sanity check is: does the SQL begin with `SELECT`, `EXPLAIN`, `SHOW`, `WITH ... SELECT`, or another read-only form? If not, do not run it.

### What's actually in the database

The `indexing-diagnostics` skill is the right entry point for `boxel_index` / `boxel_index_working` / `error_doc` exploration — it documents the schema, the `diagnostics` JSONB shape, and the canonical query patterns. This skill only covers _getting connected_; the queries themselves live there.

## Browsing the EFS filesystem (read-only)

The realm-server's persistent storage lives on EFS, mounted into the realm-server container at `/persistent`. A separate small Fargate task (`boxel-claude-fs-readonly`) mounts that same EFS read-only via a dedicated access point and exposes it on its container's port 80 via a Caddy file-server with directory listings. Claude reaches it via SSM port-forwarding.

**Three layers of read-only enforcement** so a write is genuinely impossible:

1. ECS task definition mounts the volume with `readOnly: true` — kernel-level RO mount.
2. The fs-explorer task's IAM role has `elasticfilesystem:ClientMount` only — **not** `ClientWrite` or `ClientRootAccess`.
3. Caddy `file-server` has no write endpoints.

### Filesystem layout

```
/persistent/
├── base/                     ← @cardstack/base realm
├── catalog/                  ← @cardstack/catalog realm
├── legacy-catalog/           ← legacy catalog realm
├── skills/                   ← @cardstack/skills realm
├── boxel-homepage/           ← homepage realm
├── experiments/              ← experiments realm
├── openrouter/               ← @cardstack/openrouter realm
├── software-factory/         ← software-factory realm
├── submissions/              ← submission realm
└── realms/                   ← user realms root (--realmsRootPath)
    └── <username>/
        └── <realm-name>/     ← e.g. realms/buck/mar10/
```

Public/system realms are direct children of `/persistent`; user-owned private realms live under `/persistent/realms/<username>/<realm-name>/`. Server.ts walks `realmsRootPath` (`/persistent/realms`) for two-level discovery (username → realm).

### Connecting

Same SSM port-forward pattern as the RDS tunnel, just targeting the fs-explorer task on port 80 and using `localhost` as the remote host (the tunnel forwards from your local port through the SSM agent in the container to the container's localhost, which is where Caddy listens).

```sh
PROFILE=claude-staging                                     # or claude-prod
CLUSTER=staging                                            # or production
SERVICE=boxel-claude-fs-readonly-staging                   # or -production
LOCAL_PORT=58080                                           # any free local port

# 1) Find the fs-explorer task and its container runtime ID. Filter by
#    container name to be robust against any future sidecar additions —
#    AWS doesn't guarantee containers[] order in DescribeTasks output.
TASK_ARN=$(aws --profile $PROFILE ecs list-tasks \
  --cluster $CLUSTER --service-name $SERVICE \
  --query 'taskArns[0]' --output text)
TASK_ID=${TASK_ARN##*/}
RUNTIME_ID=$(aws --profile $PROFILE ecs describe-tasks \
  --cluster $CLUSTER --tasks $TASK_ID \
  --query 'tasks[0].containers[?name==`fs-explorer`].runtimeId | [0]' \
  --output text)

# 2) Open the tunnel — forward localhost:58080 to localhost:80 inside
#    the container (where Caddy listens).
aws --profile $PROFILE ssm start-session \
  --target "ecs:${CLUSTER}_${TASK_ID}_${RUNTIME_ID}" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"portNumber\":[\"80\"],\"localPortNumber\":[\"$LOCAL_PORT\"],\"host\":[\"localhost\"]}" &
TUNNEL_PID=$!
# wait for "Waiting for connections..."

# 3) Browse. Caddy's autoindex returns HTML directory listings; serving
#    raw bytes for files. Both `curl` and a browser work.
curl -s http://localhost:$LOCAL_PORT/                      # public-realm root listing
curl -s http://localhost:$LOCAL_PORT/realms/               # user-realms root
curl -s http://localhost:$LOCAL_PORT/realms/buck/mar10/    # one user realm's contents
curl -s http://localhost:$LOCAL_PORT/base/index.json       # specific file

# 4) Tear down.
kill $TUNNEL_PID
```

### When this is useful

- Confirming a `.gts` or `.json` file actually exists at a particular path before chasing why indexing skipped it.
- Looking at `index.json` / `cards-grid.json` for a realm.
- Verifying file mtimes / sizes for a realm where the user reports "X is missing".
- Cross-referencing what the indexer saw against what actually landed on disk.

### What it can't do

- **No writes, no rsync up.** This is a viewer, not an editor. Repairs go through the realm API or a deploy.
- **No process state.** Logs go to CloudWatch (above), not the filesystem.
- **No DB.** Realm metadata in `boxel_index` is a separate path (the RDS section above).

## Reading CloudWatch logs

CloudWatch read access is part of the `boxel-claude-readonly` role's policy, so log tailing works against both staging and prod from the same session Claude already has.

The boxel deployed services all log to CloudWatch under predictable group names:

| Group (staging)                       | Group (prod, verify with `describe-log-groups`) | What lives there                                                                                                                 |
| ------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `ecs-boxel-realm-server-staging`      | `ecs-boxel-realm-server-production`             | Realm-server requests, indexer drive lines, prerender-client (manager) calls. The main place to grep `requestId=…`.              |
| `ecs-boxel-prerender-server-staging`  | `ecs-boxel-prerender-server-production`         | Prerender-server endpoint logs (per-render breakdown), the periodic `prerender-queue-snapshot` line, page-pool warnings.         |
| `ecs-boxel-prerender-manager-staging` | `ecs-boxel-prerender-manager-production`        | Manager proxy decisions (queueMs, target assignment).                                                                            |
| `ecs-boxel-worker-staging`            | `ecs-boxel-worker-production`                   | Background worker / job queue (the realm-server itself runs the worker manager — there is no separate worker-manager log group). |

Cross-component grep is the bread-and-butter pattern: every request carries `requestId=<uuid>` through realm-server → manager → prerender-server, so a single `requestId` filter will collate the whole call.

### Install the `cw` CLI (only if the user wants to read logs)

`raw aws logs filter-log-events` works but is painful — its time math is in epoch ms, it doesn't tail, and the output structure makes greps awkward. **Only install `cw` when the user actually expresses interest in viewing CloudWatch logs**; do not install it as part of the standard aws-access setup.

`cw` is a single Go binary, no runtime dependencies, cross-platform.

- **macOS**: `brew install lucagrulla/tap/cw`
- **Ubuntu / Linux**: download the latest release binary from <https://github.com/lucagrulla/cw/releases> (e.g. `cw_<ver>_Linux_x86_64.tar.gz`), `tar xzf`, drop the binary on PATH. The `cw` package in apt is a different tool (morse-code keyer) — do not `apt install cw`.
- **Windows**: scoop / chocolatey / release binary, see the project README.

Confirm: `cw --version`.

### `cw` patterns

`cw` v4 honors AWS named profiles natively but **dropped the short flags** in 4.0.0 — use `--profile claude-staging` / `--profile claude-prod` (long form only). Region must also be passed (or set on the profile, which `mise run claude-aws` does automatically); `cw` does not auto-detect region from the source profile.

The `claude_session_expiration` custom key on the profile means you can tell when the underlying STS session is about to die (it's not consulted by `cw` itself, just a sanity check before a long-running tail).

```sh
# Tail the last 5 minutes and follow new lines.
# (-b / --start accepts relative durations: '5m', '2h', '1d6h'.)
cw --profile claude-staging --region us-east-1 tail \
  -b 5m -f ecs-boxel-realm-server-staging

# Tail only events matching a pattern (--grep / -g is a CloudWatch filter
# pattern, not regex — quote literal strings).
cw --profile claude-staging --region us-east-1 tail \
  -b 1h -g 'requestId=b14e' ecs-boxel-realm-server-staging

# Time-bound a slice ('--end' / '-e' also accepts relative durations,
# meaning "N ago" — so -b 15m -e 5m is "from 15m ago to 5m ago").
cw --profile claude-staging --region us-east-1 tail \
  -b 15m -e 5m \
  ecs-boxel-prerender-server-staging

# Search a specific log stream (e.g. one ECS task) using group:prefix syntax.
# The prefix matches any stream name starting with it.
cw --profile claude-staging --region us-east-1 tail -b 30m \
  'ecs-boxel-realm-server-staging:boxel-realm-server/<task-id>'

# Cross-component grep for a single requestId (run in parallel — three calls
# touching different log groups).
cw --profile claude-staging --region us-east-1 tail -b 1h -g 'requestId=b14e' ecs-boxel-realm-server-staging &
cw --profile claude-staging --region us-east-1 tail -b 1h -g 'requestId=b14e' ecs-boxel-prerender-manager-staging &
cw --profile claude-staging --region us-east-1 tail -b 1h -g 'requestId=b14e' ecs-boxel-prerender-server-staging &
wait
```

For long-running tails or when you want to know which log stream / task each event came from, `-n` (group name) and `-s` (stream name) prefix the lines.

### Timezones — confirm, convert to UTC yourself, then run

CloudWatch stores all event timestamps in UTC, and `cw` defaults to UTC for `--start` / `--end` unless you pass `-l` / `--local`. The host running `cw` is **not** necessarily in the user's timezone (Claude often runs on Linux boxes set to UTC), so `-l` is unsafe — it interprets times in the _cw host's_ local zone, not the user's.

Workflow when a user asks for a time-bounded slice:

1. **Ask which timezone they mean** if there's any ambiguity — "between 2pm and 3pm" is bait. Common slip: the user is quoting a Sentry / Slack timestamp that's already been converted to their local time, so assuming UTC reads the wrong hour. Don't infer the timezone; confirm it.
2. **Convert to UTC yourself** before constructing the cw command. Show the conversion in your reply so the user can sanity-check ("2pm PT on Apr 28 → 2026-04-28T21:00 UTC").
3. **Pass UTC values to cw without `-l`**. Example: `cw … tail -b 2026-04-28T20:30 -e 2026-04-28T21:30 …`.
4. **Don't use `-l`** unless you've explicitly confirmed the cw host's timezone matches the user's, which is rarely the case.

Use `TZ=America/Los_Angeles date -d '2026-04-28 14:00'` (GNU date) or `date -j -f '%Y-%m-%d %H:%M' '2026-04-28 14:00' -u` (BSD/macOS date) to do the conversion if mental math is dicey for an unfamiliar zone.

For "what just happened" — the most common ask — relative durations (`-b 1h`, `-b 30m`) sidestep the problem entirely and are the right default.

The `prerender-queue-snapshot` line — useful for capacity-saturation triage — only fires periodically and does **not** carry a `requestId`. Grep for the literal string in the prerender-server group:

```sh
cw --profile claude-staging --region us-east-1 tail -b 30m \
  -g 'prerender-queue-snapshot' \
  ecs-boxel-prerender-server-staging
```

### Falling back to raw `aws logs` if `cw` isn't available

If the user doesn't want to install `cw` (or it's not available on their system), the AWS CLI works but is clunkier:

```sh
START=$(($(date +%s%3N) - 600000))   # 10 minutes ago in epoch ms
aws --profile claude-staging logs filter-log-events \
  --log-group-name ecs-boxel-realm-server-staging \
  --start-time $START \
  --filter-pattern '"requestId=b14e"' \
  --query 'events[].message' --output text
```

This is fine for one-off investigations. For anything iterative — tailing during a repro, comparing log groups, narrowing a filter — `cw` pays for itself within minutes.

## Future skill / scripting room

- The script writes `claude_session_expiration` so a future iteration can auto-refresh by prompting Claude Code for a fresh MFA token. Today, refresh is fully manual.
- A nice next step is a `query-staging-db.sh` wrapper that hides the SSM port-forward dance — taking SQL on stdin and printing only the result rows. The pieces are all here; not built yet.
