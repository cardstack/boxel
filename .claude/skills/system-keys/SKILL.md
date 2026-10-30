---
name: system-keys
description: Operate the realm server's system keys — the platform's own vendor keys (OpenRouter's among them) in `proxy_endpoints` that `_request-forward` and the OpenRouter passthrough attach — with `boxel realm-server keys list | show | add | replace | delete`. Covers the realm secret seed and the operator token it signs, masked entry and the `--stdin` / `--key-file` alternatives, the operator note, the `proxy_endpoint_history` audit table and the `system-keys` log channel, what the `/_system-keys` endpoints accept and refuse, and how a change reaches the proxy. Points to the secrets-at-rest procedures (sealing, the census, data-key rotation) that apply to these keys. Use when adding, rotating, replacing or removing a system key in any environment, when auditing who changed one, when a proxy destination stops getting its key, or when someone reaches for a hand-written `INSERT INTO proxy_endpoints`. Not for user-owned keys, and not for boxel-skills.
---

# System keys (operators)

A **system key** is a key the platform itself holds for an outside vendor,
such as OpenRouter's. Each one is a row in `proxy_endpoints`: a destination
URL, how the key is attached, how calls are charged, and the key, sealed at
rest. `_request-forward` (and the OpenRouter passthrough) attaches the key to
any forwarded request whose URL has the destination's origin and falls under
its path. System keys belong to the platform, not to any user: they are
managed by developers who hold the environment's **realm secret seed**, and no
user session, however privileged, can reach them.

Never add or change a row with a hand-written SQL statement: the table holds
no plain-text key, so SQL can't seal one, and the change would leave no audit
entry. Use the command.

## The command

```sh
export BOXEL_REALM_SECRET_SEED=…   # or let the command prompt for it
boxel realm-server keys list    --realm-server <url>
boxel realm-server keys show    --realm-server <url> (--destination <url> | --id <id>)
boxel realm-server keys add     --realm-server <url> --destination <url> \
                                --credit-strategy openrouter|none \
                                [--auth header|url-parameter] [--param-name <name>] \
                                [--streaming] [--stdin | --key-file <path>] [--note <text>]
boxel realm-server keys replace --realm-server <url> (--destination <url> | --id <id>) \
                                [--stdin | --key-file <path>] [--note <text>]
boxel realm-server keys delete  --realm-server <url> (--destination <url> | --id <id>) [--note <text>]
```

Every command takes `--json`. With `--kind oauth-client` the same commands
manage the platform's OAuth clients instead, named by `--name`; the
`oauth-connections` skill covers them, the Boxel (read-only) GitHub App among
them. `boxel realm-server` is left out of the CLI's
general help (and out of boxel-skills); `boxel realm-server keys --help` shows
the commands.

- `--realm-server` is the realm server's own URL: `https://localhost:4201`
  locally, the environment's realm server URL elsewhere. It must be `https:`
  (plain `http:` only for `localhost`, `127.0.0.1` or `[::1]`), and the
  command refuses to follow a redirect, so neither the token nor a value
  crosses the network in clear text or lands on another origin. Its origin
  must be the one the server knows itself by (its `--serverURL`): the token is
  signed for that origin alone.
- `add` refuses a destination that already has a key (409); use `replace`.
  It also refuses (409) a destination that overlaps an existing one, on the
  same origin with one path under the other: a request under both would match
  either, and which key it got would depend on row order.
  It keeps the destination and settings and swaps only the value. To change a
  destination or its settings, `delete` it and `add` it again.
- `--destination` names a key as the server stores it: the URL as the URL
  parser spells it (`https://VENDOR.test` is `https://vendor.test/`). A
  destination is an `https:` URL with no credentials, query string or
  fragment. Plain `http:` is accepted only for a host on the outbound client's
  development allowlist (`OUTBOUND_DEV_ALLOWLIST`, empty on a deployed
  server), the one case where the proxy sends a key over http.
- `--auth header` (the default) sends the key as `Authorization: Bearer <key>`.
  With `--param-name`, it goes in that header instead, still as
  `Bearer <key>`: a vendor that wants the bare key in a custom header can't be
  served. `--auth url-parameter` sends it as the query parameter
  `--param-name` (default `key`).
- `--credit-strategy openrouter` charges the caller's credits from OpenRouter's
  reported cost; `none` charges nothing.

### Entering the value

The value is never a command-line argument, so it never reaches shell
history or `ps`.

- At a terminal, `Key value:` prompts with every character echoed as `*`.
  After Enter it prints the length and the last few characters (at most four,
  and at most a quarter of the value) so you can tell the value you pasted is
  the one you meant.
- Without a terminal, pass `--stdin` (pipe the value in) or `--key-file
<path>`. One trailing newline is dropped. With neither, the command refuses
  rather than hang.

The server refuses a value with control characters or surrounding whitespace,
or longer than 8 KiB.

### The operator note

Every `add`, `replace` and `delete` carries a note: who is making the change
and why ("rotating the OpenRouter key after the vendor's incident — <your name>").
The command prompts for it at a terminal; with `--stdin` or without a
terminal, pass `--note`. The server refuses a change with no note, a note that
contains the value being sent or the value the key holds now, and a note with
control characters or line breaks (`keys show` prints notes as they are).

A name in the note is recorded as typed. The operator token carries no
identity, so nothing verifies it: anyone holding the seed can write any name.
Next to the note, the history records what the server itself observed (see
[Auditing](#auditing)).

## Authorization: the realm secret seed

The command resolves the seed as `boxel realm pull` does in seed mode:
`BOXEL_REALM_SECRET_SEED`, else a masked prompt. It signs an **operator
token** locally — `{ operator: 'system-keys' }`, no user, the realm server's
origin as its audience (`aud`), five minutes — and sends only the token; the
seed never leaves the machine.

The server never mints an operator token. `/_system-keys` accepts only a
token whose `operator` claim is `system-keys`, that names no user, names this
server's own origin as its audience, lives at most 15 minutes (measured
against the server's clock), and is signed with the seed. A user session, a
realm session, a `data-keys` operator token, a token for another server's
origin or for none, or a token signed with any other seed answers 401. The
audience means a token sent to a mistyped or lookalike host, or captured on
the way, is good at no other server that shares the seed. Every user- and realm-session
verifier refuses a token carrying the `operator` claim, so this token is good
for nothing else. Whoever holds an environment's seed can change its system
keys: treat the seed as a production credential.

## The endpoints

| Route                      | Does                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `GET /_system-keys`        | List every key's metadata                                                                             |
| `GET /_system-keys/:id`    | One key's metadata and its 20 most recent history entries, newest first                               |
| `POST /_system-keys`       | Add: `destination`, `creditStrategy`, `authMethod`, `paramName`, `supportsStreaming`, `value`, `note` |
| `PATCH /_system-keys/:id`  | Replace the value: `value`, `note`                                                                    |
| `DELETE /_system-keys/:id` | Delete: `note`                                                                                        |

**No route answers with a value.** A key's metadata reports `hasValue` and
`keyId`, the data key its value is sealed under (null for a destination with
no key). Bodies are JSON, at most
64 KiB; a larger one is refused with 413 before it is buffered. Sentry events
raised during these routes keep only the method and path, as for the proxy
routes.

## Auditing

Each change writes its `proxy_endpoints` row and a `proxy_endpoint_history`
row in a single statement, so one never lands without the other:

| Column            | Holds                                                                      |
| ----------------- | -------------------------------------------------------------------------- |
| `endpoint_id`     | the key's id (kept after the key is deleted)                               |
| `url`             | its destination                                                            |
| `action`          | `add`, `replace` or `delete`                                               |
| `note`            | the operator's note                                                        |
| `key_id`          | the data key the value was sealed under                                    |
| `changed_at`      | when                                                                       |
| `client_address`  | the caller's address, as the load balancer reports it (null when unknown)  |
| `token_issued_at` | when the operator token was signed, in seconds since the epoch (its `iat`) |

The note says who made a change only as its writer claims; the address and
the token's signing time are what the server observed, and are what to check
a claimed name against.

It never holds a value, so no migration withholds it from the read-only role
the way `proxy_endpoints` is withheld. `keys show` prints the recent
entries; for the full trail, query the table:

```sql
SELECT changed_at, action, url, note, client_address,
  to_timestamp(token_issued_at) AS token_signed
FROM proxy_endpoint_history
ORDER BY changed_at DESC;
```

Each change is also logged on the `system-keys` channel:

```
system key replace: https://openrouter.ai/api/v1/chat/completions (id …, data key kms-…) from 203.0.113.7, token signed 2026-01-01T00:00:00.000Z. Note: "rotating after the incident — <your name>"
```

## How a change reaches the proxy

The proxy reads `proxy_endpoints` through a five-second cache in each
process. The process that answers the command drops its cache at once; every
other realm-server task picks the change up within five seconds. No restart
is needed. A deleted key's destination is refused by `_request-forward` from
then on.

Existing keys are untouched by the command: a key is only ever changed by an
operator naming it.

## Secrets at rest

The value is sealed with the secrets-at-rest helper, bound to field
`proxy_endpoints.api_key`, owner `boxel-platform`, the row's id and its
destination. The sealed columns are its only copy: the table has no plain-text
key, so a hand-written `INSERT` or `UPDATE` can't add or change one. Everything
else about these keys is in the `secrets-at-rest` skill:

- the plaintext census (`plaintext census: no plain-text secret columns`) and
  the sealed census;
- rotating the data key (`boxel realm-server data-keys status | reseal`), the
  other `boxel realm-server` family;
- what a `SecretDecryptionError` or the `the sealed key for proxy endpoint …`
  error means, and why `keys replace` is the fix.

## Troubleshooting

| Symptom                                          | Meaning                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HTTP 401` on every command                      | The seed is not this environment's; `--realm-server`'s origin is not the one the server knows itself by (the token's audience doesn't match); or the machine's clock is off: more than a minute ahead of the server's, or more than five minutes behind (the token arrives already expired). Check `BOXEL_REALM_SECRET_SEED`, the URL and the clock. |
| `… is not https; refusing to send …`             | `--realm-server` is plain `http:` on a host other than this machine. Use its `https:` URL.                                                                                                                                                                                                                                                           |
| `HTTP 409 … overlaps the system key for …`       | The destination shares an origin with an existing key and one path lies under the other. Pick a destination that doesn't, or replace the existing key.                                                                                                                                                                                               |
| `HTTP 409 … already exists`                      | `add` on a destination that has a key; use `replace`.                                                                                                                                                                                                                                                                                                |
| `HTTP 409 … changed while it was being replaced` | Someone changed the row (its destination) mid-replace. Run it again.                                                                                                                                                                                                                                                                                 |
| `No system key has the destination …`            | Compare with `keys list`; the destination must match as stored, path included.                                                                                                                                                                                                                                                                       |
| `stdin is not a terminal`                        | Run from a terminal, or pass `--stdin` / `--key-file`, and `--note`.                                                                                                                                                                                                                                                                                 |
