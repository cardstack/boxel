---
name: key-outage-triage
description: Triage an outage or a complaint involving API keys — callApi calls refused or failing, a vendor answering 401, keys going `rejected`, tokens that won't mint, stored secrets that won't open, Decrypts on the secrets key, guard refusals and the response size cap. Decides first whether it is one key, one vendor, or us, with the Loki and CloudWatch query for each, then reads the Keys dashboard and walks a key that won't substitute through every stage that can stop it. Use when a keys alert fires ("Stored secret failed to open", "Secrets key Decrypt by an unexpected principal", "callApi failures of ours across realms or hosts", "Outbound guard refused a platform destination", "Many keys rejected at one host", "System key responses near the size cap", "System key responses refused over the size cap"), when someone reports that a card's key "stopped working", or when you open the Keys dashboard and need to read it.
---

# Key outage triage

Every key problem is one of three shapes, and each has a different owner:

| Shape          | What it looks like                                                                                                                                                                                 | Who acts                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **One key**    | one grant, one key or one realm refused; the same vendor works for others                                                                                                                          | the key's owner (replace the key, approve again), or nobody        |
| **One vendor** | every key at one host refused or failing at once; other hosts fine                                                                                                                                 | nobody on our side; probes recover the grants when the vendor does |
| **Us**         | sends failing for reasons of ours across many realms, or connections failing at many hosts at once, secrets that won't open, guard refusals of our own destinations, Decrypts we can't account for | us                                                                 |

Answer that before anything else. The rest of this skill is how.

The dashboard is **Keys** (`boxel-keys`) in the Boxel Status folder. The alerts are the `keys-group` rule group (`packages/observability/provisioning/alerting/keys-group.json`). Reaching staging or production Loki and CloudWatch needs the `aws-access` session; `tail-logs` wraps Loki.

## The signals

All of these are one line per event. None carries a key, a filled request or a query string.

| Channel / line                                                      | Service              | Events and fields                                                                                                                                                                                                  |
| ------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `boxel:key-use` (JSON)                                              | realm-server         | one per `callApi` invocation: `operation`, `realm`, `caller`, `url` (origin and path as declared), `outcome` `sent` / `refused` / `failed`, `code`, `status`. See `call-api`.                                      |
| `boxel:key-grant` (JSON)                                            | realm-server         | `vendor-outcome` (`host`, `status`), `grant-rejected` / `grant-cleared` / `probe`, `key-rejected` (`key`, `host`) / `key-cleared` / `key-probe`, `mint-failed` (`key`, `kind`, `host`, `reason`). See `user-keys`. |
| `boxel:key-limits` (JSON)                                           | realm-server         | `refused` (`code`, `share` or `key`, `realm`, `limit`) and `threshold`. See `key-limits`.                                                                                                                          |
| `boxel:secrets-at-rest` (JSON)                                      | realm-server, worker | `open-failed`: `field`, `id`, `keyId`, `reason` `unknown-data-key` / `not-authentic` / `malformed`. See `secrets-at-rest`.                                                                                         |
| `outbound guard refused: path=… host=… reason=… destinationSetBy=…` | realm-server, worker | every request the guard refused before sending, on both paths (`call-api`, `system-key`), with who chose the destination: `platform` or `user`. See `outbound-guard`.                                              |
| `outbound response size: …` and `refused=…`                         | realm-server, worker | the response size cap: every response's size, and each one refused for size. See `outbound-guard`.                                                                                                                 |
| CloudWatch `/aws/events/<env>-boxel-secrets-decrypts`               | (EventBridge)        | every allowed `kms:Decrypt` on the secrets key, and every denied one that names the key or carries its encryption context, copied from CloudTrail by `cardstack/infra:configs/boxel-secrets-kms`.                  |

Hosted, every line arrives wrapped in FireLens's JSON with the line in `.log`; locally the line is bare. A worker child's line also starts with its manager's `[worker <id> priority N]: ` prefix. This unwrap handles all three (the parse error the first `json` raises on a bare line is dropped, and the prefix is stripped); `<unwrap>` below stands for it:

```logql
| json | drop __error__, __error_details__
| line_format `{{ if .log }}{{ regexReplaceAll "^\\[worker [^\\]]+\\]: " .log "" }}{{ else }}{{ regexReplaceAll "^\\[worker [^\\]]+\\]: " __line__ "" }}{{ end }}`
```

For the JSON channels, substituting the channel:

```logql
{service=~"realm-server|worker", env="<env>"} |= "boxel:key-use" <unwrap> | json | channel="boxel:key-use"
```

Below, `<key-use>`, `<key-grant>`, `<key-limits>` and `<secrets>` stand for that with their channel. For guard refusals, `<guard>` stands for:

```logql
{service=~"realm-server|worker", env="<env>"} |= "outbound guard refused:" <unwrap>
  | regexp "path=(?P<path>\\S+) host=(?P<host>\\S+) reason=(?P<reason>\\S+) destinationSetBy=(?P<destinationSetBy>\\S+)"
```

Keep the `|=` line filter ahead of the first `json`: it is what keeps the query from parsing every line the service wrote.

## One key, one vendor, or us

### 1. Is it one vendor?

Outcomes per destination host. One host refused or answering 401 while the others answer normally is that vendor (or keys at it):

```logql
sum by (host, outcome) (count_over_time(<key-use> | url!=""
  | label_format host=`{{ regexReplaceAll "^[a-z]+://([^/]+).*$" .url "${1}" }}` [5m]))
```

What the vendor answered, per host and status:

```logql
sum by (host, status) (count_over_time(<key-grant> | event="vendor-outcome" [5m]))
```

Then how many distinct keys it rejected, per host. Each grant is counted once, when its vendor first answers 401, but one key can hold several grants at one host (one per destination path), so one revoked key can reject several grants at once. Count keys, not grants: several keys at one host in minutes means the vendor refused every key, not one:

```logql
count by (host) (sum by (host, key) (count_over_time(<key-grant> | event=~"grant-rejected|key-rejected" [10m])))
```

Several keys at one host is either the vendor (an outage, a change to its auth) or **our substitution sending the wrong value**. Tell them apart:

- the vendor's status page, and whether its 401s started at one moment for every realm;
- whether keys at **other** hosts still answer 2xx in the same window. If every host's grants are being rejected, it is us, not the vendor;
- whether a deploy went out just before. A substitution bug ships with a deploy.

A vendor outage needs nothing from us: each rejected grant probes once per interval (`KEY_GRANT_PROBE_INTERVAL_SECONDS`, 15 minutes by default) and returns to `active` on the first probe the vendor answers below 400. Watch `grant-cleared` with `reason=probe` come back:

```logql
sum by (host, reason) (count_over_time(<key-grant> | event="grant-cleared" [15m]))
```

Minting keys (Google service accounts, OAuth connections) fail before any call is sent. `mint-failed` names the key's kind, the host of the grant it was minting for and why:

```logql
sum by (kind, host, reason) (count_over_time(<key-grant> | event="mint-failed" [10m]))
```

`unavailable` at one host is the vendor's token endpoint. `rejected` for many keys of one kind at once is the vendor refusing every key; for one key, it is that key. `needs-admin` is an OAuth client whose secret its token endpoint refused (`oauth-connections`).

### 2. Is it us?

Any of these is us, whatever the vendors are doing:

- **A stored secret won't open.**

  ```logql
  sum by (service, field, reason, keyId) (count_over_time(<secrets> | event="open-failed" [15m]))
  ```

  `unknown-data-key` names a data key the process didn't load: a rotation step taken before the previous one fully rolled out, or a task started without `SECRETS_ADDITIONAL_WRAPPED_DATA_KEYS`. Finish the deploy or roll the step back (`secrets-at-rest`, Rotating the data key). `not-authentic` is a sealed row that was changed or moved outside the realm server: the line's `field` and `id` name it. Treat it as a database write nobody can account for until someone can.

- **The guard refused a destination the platform set.** `destinationSetBy=platform` is a `proxy_endpoints` row behind `_request-forward` or the OpenRouter passthrough, a platform OAuth client's token endpoint, or Google's token endpoint. A user's own OAuth client's token URL and a card's declared request are `destinationSetBy=user`: anyone can make those refuse, so they say nothing about us.

  ```logql
  sum by (path, host, reason) (count_over_time(<guard> | destinationSetBy="platform" [15m]))
  ```

- **Sends failing for reasons of ours.** Two shapes. A send that broke without a refusal (`failed`, which the sender raises only for an error it didn't map, so a bug of ours) or `rate-limit-unavailable` (the limit counters' database, the `rate-limit-store` channel), in many realms:

  ```logql
  sum by (code, realm) (count_over_time(<key-use> | outcome="failed" or code="rate-limit-unavailable" [10m]))
  ```

  And connection failures and timeouts at many hosts at once. `internal-error` is any connection that broke before the destination answered (DNS, refused, TLS) and `upstream-timeout` one that didn't connect or finish in time. At one host that is that destination: a vendor's outage, or a card author's dead destination, however many realms call it. Across many hosts at once it is our network:

  ```logql
  sum by (code, host) (count_over_time(<key-use> | code=~"internal-error|upstream-timeout" | url!=""
    | label_format host=`{{ regexReplaceAll "^[a-z]+://([^/]+).*$" .url "${1}" }}` [10m]))
  ```

  Every other code is a user's, an owner's or a card author's state (approval, re-approval after a declaration changed, suspension, limits, an anonymous caller, bad parameters, a card pointing the guard somewhere it may not), and a card installed in many realms, or one owner's key bound in several, raises it in all of them at once, so a count across realms of those says nothing.

- **A Decrypt on the secrets key we can't account for.** The task roles Decrypt once per data key when a task starts, so their entries line up with deploys. Anything else, or any denied call, is the alert. In CloudWatch Logs Insights, on `/aws/events/<env>-boxel-secrets-decrypts`:

  ```
  fields @timestamp,
    coalesce(detail.userIdentity.sessionContext.sessionIssuer.arn, detail.userIdentity.arn) as principal,
    detail.userIdentity.principalId, detail.sourceIPAddress, detail.errorCode,
    detail.requestParameters.encryptionContext.purpose
  | sort @timestamp desc
  ```

  A task role's Decrypt away from a task start is a shell opened in the task (both services run with ECS Exec): look up `ExecuteCommand` in CloudTrail for who opened it. The `secrets-at-rest` skill's audit covers the rest. CloudTrail delivers to EventBridge within minutes; the alert looks back 30 minutes to cover it.

### 3. Otherwise it is one key

One grant, one key or one realm refused while the vendor works for others. Find it and walk it through [A key that won't substitute](#a-key-that-wont-substitute).

```logql
<key-use> | realm=~".*<realm>.*" | operation="<operation>"
```

## Reading the dashboard

Top row, **Is it us, one vendor, or one key?** — six counts over the selected range. Red on _Secrets that failed to open_, _Decrypts by an unexpected principal_ or _Guard refusals_ is us until shown otherwise. _Grants and keys rejected_ and _Mints that failed_ are vendors or keys; the two charts under them say which host. _Limit and budget refusals_ stays green: those are owners' limits working.

- **callApi outcomes by vendor host / Vendor answers by host and status** — the one-vendor test, side by side. A host whose bars turn to `refused` / `401` alone is that vendor.
- **Decryption failures by field and reason / Minting failures by vendor** — see step 2 and step 1.
- **Secrets key Decrypts by principal** — hourly. Expect one bar per task start from each task role; every other principal or a non-`ok` outcome is the Decrypt alert.
- **callApi refusals by code** — the user-state codes (`binding-not-approved`, `share-suspended`, `binding-needs-reapproval`, `interactive-use-not-approved`, `rate-limited`, `over-budget`) are background. A rise in `credential-rejected`, `guard-refused`, `upstream-timeout`, `internal-error` or `rate-limit-unavailable` is what to explain. `failed` is a send that broke without a refusal.
- **Guard refusals by who set the destination / by host** — `user` is a card or a user's own OAuth client, at whatever host they chose; `platform` is ours.
- **Limit and budget refusals by realm** — filter with the Realm box. One realm hitting its budget is the owner's setting; `rate-limit-unavailable` is the database.
- **Keys and grants entering the rejected state, by vendor host** — with `cleared` alongside, so a vendor's outage reads as a spike of rejections followed, one probe interval later, by clears.
- **Key state changes** — the raw `boxel:key-grant` feed. Grant and key ids, hosts and realms only.
- **Response size cap** — the p50, p95 and max decompressed response per path against the dashed cap, the responses refused for size, and the largest response per destination. A refusal from a legitimate vendor, or a max closing on the cap, means the cap needs revisiting (`outbound-guard`, The response size cap).

The Realm box filters the `callApi` and limit panels only.

## A key that won't substitute

A card says its key "stopped working". The invocation's `boxel:key-use` line says which stage stopped it; find it first:

```logql
<key-use> | realm=~".*<realm>.*" | operation="<operation>"
```

Then by `outcome` and `code`, in the order the realm server checks them for each slot (`checkSlot` in `lib/key-bindings.ts`):

| `code`                                | What stopped it                                                                                                                                                                                                                                                                                                                                               | What brings it back                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `binding-not-approved`                | no approved binding fills the slot in this realm, or its grant is gone or belongs to another key                                                                                                                                                                                                                                                              | the key's owner approves the operation (`key-bindings`). A `binding … can't fill slot` warning on `realm:key-bindings` names a binding whose grant is unusable |
| `share-suspended`                     | the binding fills it from a share the realm suspended, or that is no longer active                                                                                                                                                                                                                                                                            | the share's owner and the realm (`key-shares`)                                                                                                                 |
| `binding-needs-reapproval`            | the operation's declaration changed since it was approved                                                                                                                                                                                                                                                                                                     | approve again                                                                                                                                                  |
| `interactive-use-not-approved`        | an interactive call through a binding approved for automations only                                                                                                                                                                                                                                                                                           | approve interactive use                                                                                                                                        |
| `credential-rejected`                 | the vendor answered 401 at that grant's destination and its probe isn't due; or Google refused the service-account key itself and the key's probe isn't due (`meta.reason: "rejected"`, with a `key-rejected` line on `boxel:key-grant` when it entered the state); or a minting key couldn't mint (`meta.reason` `rejected` / `needs-admin` / `unavailable`) | replace the key, or wait for the grant's or key's probe; for minting, see `mint-failed` above and `oauth-connections`                                          |
| `rate-limited` / `over-budget`        | the owner's rate limit or budget                                                                                                                                                                                                                                                                                                                              | `retryAfterSeconds`, or the owner raises it (`key-limits`)                                                                                                     |
| `rate-limit-unavailable`              | the counters couldn't be read                                                                                                                                                                                                                                                                                                                                 | the database (`rate-limit-store`)                                                                                                                              |
| `guard-refused`                       | the destination isn't https, resolves to a private address, redirects too often, or filling the slot would have changed its origin                                                                                                                                                                                                                            | the card's declaration; a guard bug if the card is right (`outbound-guard`)                                                                                    |
| `upstream-timeout` / `internal-error` | the destination didn't connect or answer in time, or the connection broke before it answered: that host, unless many hosts fail at once (step 2)                                                                                                                                                                                                              | the vendor's status page                                                                                                                                       |

`outcome: "sent"` with a vendor status means substitution worked and the vendor answered. A 403 never changes state: it is recorded on the grant as `vendor-forbidden`, which the owner sees beside the grant (`user-keys`, Rejected grants).

If the line shows nothing wrong but the value sent is wrong, check that the grant's copy opens: an `open-failed` line with `field` `user_key_grants.value` and the grant's id as `id` means the copy no longer opens under its own binding, and the grant sends nothing. Replacing the key reseals every grant whose copy still opens; one that doesn't stays unusable, and the owner grants it again.

## The alerts

| Alert                                           | Query                                                                                                                                              | Fires at                             | Why that threshold                                                                                                                                                                                      |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stored secret failed to open                    | `open-failed` lines in 5 minutes                                                                                                                   | any                                  | a value that won't open is never routine                                                                                                                                                                |
| Secrets key Decrypt by an unexpected principal  | Decrypts in the log group from neither of this environment's task roles in this account, or denied, in 30 minutes                                  | any                                  | only those two roles may Decrypt, and they never fail; another environment's role or a same-named role in another account is unexpected too                                                             |
| callApi failures of ours across realms or hosts | realms with a `failed` send or `rate-limit-unavailable`; and, separately, distinct hosts with `internal-error` / `upstream-timeout`; in 10 minutes | 3 or more realms, or 3 or more hosts | those two are ours wherever they happen; a dead destination is one host however many realms call it, so connection failures count by host; every other code is a user's, owner's or card author's state |
| Outbound guard refused a platform destination   | `destinationSetBy=platform` guard refusals in 10 minutes                                                                                           | any                                  | those destinations are ones the platform set; a user-set destination can be refused at will                                                                                                             |
| Many keys rejected at one host                  | distinct keys among `grant-rejected` + `key-rejected` per host in 10 minutes                                                                       | 3 or more keys at one host           | one key can hold several grants at one host, so keys are counted; three keys refused at one host within minutes is the vendor refusing every key, or our substitution                                   |
| System key responses near the size cap          | per system key and destination, the largest response on the `outbound response size:` lines in 10 minutes, as a share of the key's current cap     | over 75%                             | room to raise the cap before a caller fails; the share is against the cap on the key's latest line, so raising it resolves the alert on the next response                                               |
| System key responses refused over the size cap  | `outbound response over size cap:` lines of system keys in 10 minutes, measured against the key's current cap                                      | any                                  | each one is a caller that got an error; a `callApi` refusal is a card's own request and never fires it                                                                                                  |

The two response size cap alerts notify the `Techops` contact point (email to techops@cardstack.com), one notification per key; the others go to the default notification policy. Each Loki rule reads its environment's own Loki, so the rules select no `env`. No series means nothing happened, which is healthy (`noDataState: OK`); a query that fails to run sends a `DatasourceError` alert for the rule, to the rule's own contact point, instead of firing it (`execErrState: Error`), so the fault is the data source, not the keys. The Decrypt rule's log group, account and environment come from `SECRETS_DECRYPTS_LOG_GROUP_NAME`, `SECRETS_DECRYPTS_LOG_GROUP_ACCOUNT_ID` and `SECRETS_DECRYPTS_ENV`, which the apply workflows set per environment; it accepts only `arn:aws:iam::<that account>:role/boxel-(realm-server|worker)-<that env>-ecs-task`. The dashboard's panels, which can't carry an account per environment, require the principal's account to equal the event's `recipientAccountId` instead.

### A system key's responses near or over the size cap

The notification names the environment, the key (`system:<destination>`), the destination, the size, the key's current cap and the command that raises it. A refusal also says how it was measured and how many were refused.

1. **Is the response legitimate?** Read the key's size lines for the last day: `./scripts/tail-logs.sh --env <env> --service realm-server --filter 'key=system:<destination>' --since 1d --no-follow --confirm` (and `--service worker`). A gradual climb from a vendor doing what it was asked, such as larger or more images, is growth. One response far past every other, or `refused=stream-reached-cap` on a response with a small compressed length, is a runaway or a decompression bomb: leave the cap and look at what the vendor sent (`outbound-guard`, The response size cap).
2. **If legitimate, raise that key's cap** with the command in the notification. Its suggested value is twice the key's current cap (near) or twice the refused size (over). It takes effect on the key's next call, with no deploy.
3. **Watch it resolve.** Both alerts compare against the cap on the key's latest size line, so they resolve once a response on the key succeeds under the new cap. Over the cap, also tell whoever reported failures that a retry now goes through: a refused `_request-forward` was a 502, and a refused generation-cost lookup left that call uncharged (`Failed to fetch generation cost` on `credit-strategies`).

When every key on the path outgrows the default, change the path's cap instead (`outbound-guard`, The values, and revisiting them).

## Staging an alert locally

The local observability stack (`packages/observability`, `docker compose up -d`) loads `provisioning/alerting/` at startup and evaluates the Loki rules against local Loki. To see a rule fire without a real outage, push the line its emitter writes into local Loki under `service="realm-server", env="local"`:

```sh
now=$(date +%s%N)
curl -s -H 'content-type: application/json' -X POST http://localhost:3100/loki/api/v1/push --data "$(jq -nc --arg t "$now" \
  --arg l '{"channel":"boxel:key-grant","event":"grant-rejected","grant":"g1","key":"k1","host":"vendor.example","realm":"http://localhost:4201/r/","share":null}' \
  '{streams:[{stream:{service:"realm-server",env:"local"},values:[[$t,$l]]}]}')"
```

Three `grant-rejected` lines at one host with distinct `key`s (and `grant`s) trip "Many keys rejected at one host" on the next evaluation; three grants of one key count once. An `outbound response size: path=system-key … cap=1000 bytes=800 outcome=complete key=system:https://vendor.example/` line trips "System key responses near the size cap"; an `outbound response over size cap: path=system-key … cap=1000 declaredBytes=5000 refused=declared-length key=system:https://vendor.example/` line trips the refusal alert, and a later size line for the same key with a larger `cap` resolves it. Produce the lines by running the emitters rather than by hand where you can: a stub vendor that answers 401 to every request, called through `sendCallApiRequest`, writes the real `outbound` and `boxel:key-grant` lines (with `LOG_LEVELS='*=info'` and `setup-logger.ts` imported first, as `main.ts` does). The Decrypt rule can't evaluate locally (no AWS credentials); on staging, any task start lands a task-role Decrypt in the log group, which the dashboard panel shows and the alert leaves alone.

## Related skills

- **`call-api`** — the key-use channel and every refusal code.
- **`user-keys`** — grants, rejected grants and keys, the `boxel:key-grant` channel.
- **`key-bindings`**, **`key-shares`**, **`key-limits`**, **`oauth-connections`** — the stage each refusal comes from.
- **`secrets-at-rest`** — data keys, rotation, the KMS audit.
- **`outbound-guard`** — guard refusals and the response size cap.
- **`aws-access`**, **`tail-logs`** — reaching staging and production.
