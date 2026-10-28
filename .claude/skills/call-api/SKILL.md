---
name: call-api
description: How a `callApi` card operation — a request to a service outside the realm, declared as data on a card — is lowered when its module is indexed and carried out by the realm server without loading card code. Covers the declaration shape and the credential slot grammar (`{{userKey}}`, `{{apiKey}}`, `{{apiKey:name}}`, `|basic`), every lowering check and the issue code it records, the lowered destination (normalized origin and path prefix) and the `destinationCovers` rule approval and sending share, why `http:` lowers and is refused when sent, how an invocation on an instance or on a type builds the request, how slots become tokens that the outbound client fills only after its destination check, the refusals (`binding-not-approved`, `not-during-render`, `actor-required`, `guard-refused`, `upstream-timeout`, `response-too-large`, `invalid-operation`), why a vendor's error status is an answer rather than a refusal, and the `boxel:key-use` log channel. Use when changing or reviewing `card-operations/call-api.ts`, the `callApi` arms of lowering and dispatch, `lib/outbound/call-api-sender.ts` or the outbound client's substitutions; when a `callApi` is refused and you need to know which stage refused it; or when adding the binding that fills a slot.
---

# callApi — lowering and dispatch

A `callApi` is the one way a card reaches a credential: the card declares the
request as data, and the realm server sends it. No card code runs at call
time — not the module, not a template, not a computed. The request is built
from the lowered declaration stored in the type's definition-cache entry, the
same way every other operation is carried out.

The free-form proxy (`SendRequestViaProxyCommand` → `POST /_request-forward`)
is the other outbound path and never fills a slot: a `{{userKey}}` written into
a forwarded header or body reaches the vendor as that literal text. Keep it
that way; a credential a card can steer into an arbitrary request is exactly
what `callApi` exists to prevent.

## Key files

| What                                                          | Where                                                                                                     |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Declaration type, decorator shape checks                      | `packages/base/operations.ts` (`CallApiOperationDeclaration`, `assertDeclaresARequest`)                   |
| Slot grammar, lowering checks, request building, the executor | `packages/runtime-common/card-operations/call-api.ts`                                                     |
| Lowered shape, issue and refusal codes, `travelsAsWrite`      | `packages/runtime-common/card-operations/types.ts` (`OperationCallApi`, `CallApiSlot`, `CallApiResponse`) |
| Lowering arm                                                  | `card-operations/lowering.ts` (`lowerOperation` → `lowerCallApi`)                                         |
| Dispatch arm                                                  | `card-operations/dispatch.ts` (`runBaseOperation` → `callApiOperation`, `projectResult`)                  |
| QUERY refusal, prerender signal, sender injection             | `packages/runtime-common/realm.ts` (`#runOperationsBatch`, the `callApi` constructor option)              |
| The sender                                                    | `packages/realm-server/lib/outbound/call-api-sender.ts`                                                   |
| Send-time substitution                                        | `packages/realm-server/lib/outbound/client.ts` (`substitutions`, `applySubstitutions`)                    |
| Key-use channel                                               | `card-operations/telemetry.ts` (`emitKeyUse`, `setKeyUseSink`)                                            |

## The declaration

```ts
@operation static openIssues = {
  base: 'callApi',
  params: { owner: StringField, repo: StringField },
  url: 'https://api.github.com/repos/{owner}/{repo}/issues',
  path: { owner: params('owner'), repo: params('repo') },
  query: { state: 'open' },
  headers: { authorization: 'Bearer {{userKey}}' },
  output: bxl`{status: .status, issues: .body}`,
} satisfies OperationDeclaration;
```

`method` (absent: GET without a body, POST with one), `url`, `path`,
`headers`, `query`, and one body: `json`, or `graphql: { document, variables }`.
`output` is the optional response mapping; it runs over `{status, headers,
body}` and has to produce an object, since the answer stands alone in the
batch's results, where a list reads as a group's answers and `null` as a
removal. `input` works as on any operation. A `transformations` program is
refused (`unrunnable-program`): there is no document to run it over.

`perInstance: true` makes a key's owner approve the operation for each card
on its own (one webhook per channel card): it lowers to
`OperationCallApi.perInstance`, and a binding for it names the instance.

`callApi` is declaration-only (nothing implies it) and is carried only by a
card def. It is invocable on an instance and on the type: the client puts it
in both buckets once declared (`carriesMember` in `card-operations/client.ts`).

### Slots

A credential is written inside a string as a slot:

- `{{userKey}}` — the invoking user's key; `{{apiKey}}` — one the realm holds.
- `{{apiKey:token}}` — named; a slot written without a name is named by its key.
- `{{apiKey|basic}}` — the value is base64'd as HTTP Basic takes it before it is sent.

`slotsIn` reads them. Any `{{…}}` that _starts_ with `userKey` or `apiKey` but
doesn't parse is `invalid-slot`; any other `{{…}}` is the author's own text
(a template the vendor fills) and is sent as written.

## Lowering checks

All in `lowerCallApi`. Each records an issue, so the entry is stored
`invalid` and invoking it answers 422 `invalid-operation` with the issues in
`meta.issues`. The decorator only checks shape (url is a string, method is
known, one body, no body on GET); everything below is lowering's, so it holds
for a stored entry whatever produced it.

| Code                       | Raised for                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slot-placed-twice`        | the same slot name, same key, in two places                                                                                                                                                                                                                                                                                                  |
| `slot-name-reused`         | one name used for a `userKey` slot and an `apiKey` slot                                                                                                                                                                                                                                                                                      |
| `slot-out-of-place`        | a slot in the URL as written, a header or query _name_, or a GraphQL document                                                                                                                                                                                                                                                                |
| `unencoded-path-parameter` | a `{name}` that isn't a whole path segment (in the host, part of a segment, `{+name}`), a `{name}` that `path` doesn't fill, or a typed reference spliced into URL or path text (`[object Object]`)                                                                                                                                          |
| `string-built-graphql`     | a document that is a marker or program, or has a reference spliced into it                                                                                                                                                                                                                                                                   |
| `invalid-slot`             | a malformed slot or an unknown transform                                                                                                                                                                                                                                                                                                     |
| `invalid-request`          | not an absolute http(s) URL, userinfo in the URL, a `*` in the host (written or as `%2A`), a trailing dot on the host, a `path` key no segment takes, a `path` value written as text that is `''`, `.` or `..` or holds `/` or `\`, an `X-Boxel-*` or non-token header name, an object or list where text is sent, two bodies, a body on GET |

The lowered entry keeps every value as a marker and every slot as the text the
author wrote, plus `slots: CallApiSlot[]` — `{name, key, transform?,
placement, at}` — so dispatch knows what a request needs without walking it.

## The destination

Lowering (`lowerUrlTemplate`) parses the URL with each `{name}` segment
stood in for by a plain one and stores two things on `OperationCallApi`:

- **`url`** — the parser's `href`, each `{name}` segment put back as written.
  The host is lower-cased, a default port dropped and dot segments resolved, so
  two spellings of one place lower alike: `https://API.openai.com:443/v1/../chat/{id}`
  lowers to `https://api.openai.com/chat/{id}`.
- **`destination`** — where the request goes: the origin plus the path up to
  and including the last `/` before the first `{name}` segment, or the path's
  last `/` when it has none, as the parser's `href`. The URL above has the
  destination `https://api.openai.com/chat/`;
  `https://api.example.com/v1/chat/completions` has
  `https://api.example.com/v1/chat/`. The query string and fragment are never
  part of it. The prefix is set as the `pathname` of a copy of the parsed URL,
  never resolved against the origin, because a path opening with `//` would
  resolve as another host.

Each stand-in carries a random part, and each must appear exactly once in the
parsed URL or the URL is refused `unencoded-path-parameter`, so a URL whose own text
holds stand-in-like text can't move a `{name}` into another segment or the
host. A host with a trailing dot is refused too, since it names the same host
as one without.

The definition cache holds both. The destination is the unit a key is
approved for: creating a grant (see the `user-keys` skill) reads it from here
and stores it on the grant, and sending under a grant never reads it again.

**`destinationCovers(destination, url)`** is the one rule for whether a request
goes where a destination says: the send-time check asks it of every request,
and an approval of a key for a destination is judged by it too. Both
sides are compared as parsed `href`s, and a destination whose path doesn't end
in `/` (or that carries userinfo, a query or a fragment) covers nothing, so a
match always ends at a `/`: `https://api.openai.com/` doesn't cover
`https://api.openai.com.evil.net/`, and `https://api.example.com/v1/` doesn't
cover `https://api.example.com/v1beta`.

**`http:` lowers; it is refused when sent.** Lowering can't see the server's
outbound guard, so it accepts `http:`. The guard's `checkDestination` refuses
an `http:` request before connecting unless its host is on the development
allowlist (`OUTBOUND_DEV_ALLOWLIST`, which a deployed server refuses to start
with), and the sender answers `guard-refused` with `meta.reason: 'scheme'`.
Local development and the stub vendor in tests send over `http:` that way.

## Invocation

`callApiOperation`, called from `runBaseOperation`, in this order. Each
refusal also writes a key-use line.

1. **`not-during-render`** (403) — the batch arrived with
   `x-boxel-during-prerender`, or on a realm-authority session, which only a
   realm rendering its own cards holds (`#duringRender` in `realm.ts`; a
   render's operations batch carries the session and not always the header).
   A render is replayed and shared; it may not act for anyone. The host also refuses a POST batch inside a prerender
   (`assertMayWrite` in `services/operations.ts`), so this is the server's own
   copy of that rule.
2. **`actor-required`** (401) — the request has a slot and no signed-in caller.
3. **Slots are filled** — the request has a slot, so the sender's `fill`
   finds the binding for each (see the `key-bindings` skill) and opens its
   key under the binding's grant, or refuses: `binding-not-approved` (409,
   `meta.slots: [{name, key}]`), `share-suspended` (409),
   `binding-needs-reapproval` (409), `interactive-use-not-approved` (403) or
   `credential-rejected` (424: the vendor rejected the key at the grant's
   destination, and no probe is due; see the `user-keys` skill, _Rejected
   grants_).
   Every invocation off the network is interactive, and every binding is
   approved for pipelines only, so a slotted request is sent only from a
   pipeline (`Realm.handlePipeline`). The `binding-not-approved` detail names
   each slot with whose key fills it (`the credential slot "weather" for the
invoking user's own key`, `… for the realm's key`, from `describeSlots`),
   because a caller that sees only the message, such as the AI assistant,
   gets neither the code nor `meta`, and a slot's name alone doesn't say. The
   assistant's rule for opening the secure window keys on that wording. A
   keyless request continues.
4. **Build** (`buildCallApiRequest`): markers filled from the payload, the
   caller, the realm's settings and — on an instance target — the card's
   _indexed_ document (`indexedInstance` in `read.ts`, so computed fields are
   readable). `instance()` on a type target is a 400. Each path value becomes
   exactly one segment via `encodeURIComponent`; `''`, `.` and `..` are
   refused 400 because a URL would resolve them away, and a value holding
   `/` or `\` is refused 400 because a vendor that decodes `%2F` (or reads
   `%5C` as a separator) before routing would split it into more segments.
   A `path` value written as text is held to the same rule at lowering,
   which records `invalid-request` for it, since it would refuse every call.
   That refusal is deliberate even though some APIs take an encoded `/`
   inside one segment (GitLab's `group%2Fproject`, a storage object name):
   a request can't tell such a vendor from one that routes on the decoded
   path. A credential filled into the path at send time is held to the same
   rule by the outbound client (`applySubstitutions`), which refuses it
   `guard-refused` with `meta.reason: 'invalid-url'`. Query values are
   appended with `URLSearchParams`. A JSON body gets `content-type:
application/json` unless the declaration set one.
5. **`guard-refused`** (502, `meta.reason: 'destination'`) — the built URL
   is not covered by the lowered `destination`, or by the destination stored
   on the grant a filled slot's key is sent under. Every value is encoded
   into a segment or the query string, so a request can't leave it; these
   are the send-time checks that what goes out is what was declared and what
   the key's owner approved, made on the request with its slots still
   tokens.
6. **Send** through `core.callApi`, the `CallApiSender` the realm server
   passes to `new Realm({ callApi })`. A realm without one (the host's
   in-browser test realm) answers 501. The realm server's sender first
   refuses a request addressed to one of the platform's token endpoints
   (`tokenEndpointAt` in `lib/outbound/token-endpoints.ts`: Google's, at each
   address Google exchanges an assertion, and each platform OAuth client's
   token URL), key or no key, with `guard-refused` (502,
   `meta.reason: 'platform-only'`). A user's own OAuth client is never
   consulted: any user may store one with any token URL, and one user's must
   not refuse another's requests. The check is made on the address the
   operation declares.

Which realm: an instance target's is the realm serving it; a type target's
is the one the entry names in `data.meta.realmURL`, and `assertInRealm`
holds it to the realm that received the batch. The server decides, never
the declaration.

`callApi` is not a write (`isWrite` is false, so it is never staged or
committed), but it needs write authority: `travelsAsWrite` is true, so the
client sends it on POST, a QUERY batch carrying one is refused
`wrong-entry-point`, and a caller the ACL declined writes to (a delegated,
read-only session) needs a policy grant. It runs in the batch's read pass,
against pre-batch state.

### Slots at send time

Building turns each slot into an opaque token (`boxel_slot_<n>_<hex>`) of
characters that percent-encoding, JSON escaping and a header value all leave
unchanged. The built request holds no credential. It is what the guard
checks, and the URL every log line, error and key-use record describes.

The sender hands the client `substitutions: [{token, value}]`. `outboundFetch`
then:

- checks the destination on the request _as given_, then fills the tokens:
  URL-encoded in the URL, as-is in headers, JSON-escaped in a string body;
- refuses if filling changed the origin (a slot can only stand in a path or
  query value, so this is a guard against a bug, not a route);
- registers every value with the scrubber before anything is sent;
- treats a redirect to another origin as the answer instead of following it,
  because a filled value in a header, the body or the path would otherwise go
  with it. Same-origin redirects are followed.

A secret destination — a credential in the path, like a webhook URL — is a
`{{apiKey}}` in a `path` value; the recorded URL carries the token, never the
value.

The binding fills each slot with the value _as sent_ (with `|basic`
applied) as `CallApiCredential.value`, and its stored value as `raw` when
the transform changes it, which the sender registers with the scrubber too.

### The answer

Whatever the vendor answered: `{status, headers, body}`. A 404, a 403 or a
500 is a result the card reads. The one exception is a **401 to a request
that carried a credential**: it rejects the grants the request was sent
under and is refused `credential-rejected` (424), so a card stops instead of
reading the vendor's refusal as data. A keyless request's 401 is an answer
like any other. `headers` is an allowlist (`safeResponseHeaders`):
content type, language and disposition, caching validators, `link`,
`location`, `retry-after`, `www-authenticate`, and rate-limit headers.
`set-cookie`, `server` and everything else stay on the server. The body is
parsed when the vendor says JSON and is text otherwise, null when empty,
with every registered credential removed by the scrubber.

Only these refuse the operation:

| Code                  | Status                           | When                                                                                                                                                                                                                                                                  |
| --------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `guard-refused`       | 502 (400 for a forbidden header) | the guard refused the destination or a redirect hop: not https (and not an allowlisted local host), a non-public address, too many redirects; the built request left its lowered destination; or it is addressed to a token endpoint (`meta.reason: 'platform-only'`) |
| `upstream-timeout`    | 504                              | no connection within the connect timeout, or not finished within the total                                                                                                                                                                                            |
| `response-too-large`  | —                                | reserved for the enforced `call-api` response cap. The cap is in observe mode (see the `outbound-guard` skill), so a large response is logged and still delivered                                                                                                     |
| `internal-error`      | 502                              | the connection broke before any response arrived                                                                                                                                                                                                                      |
| `credential-rejected` | 424                              | the vendor answered 401 to a request carrying a credential; its grants are now rejected                                                                                                                                                                               |

## The key-use channel

`boxel:key-use`, one JSON line per invocation:

```json
{
  "channel": "boxel:key-use",
  "operation": "openIssues",
  "realm": "https://…/r/",
  "caller": "@u:host",
  "url": "https://api.github.com/repos/o/r/issues",
  "outcome": "sent",
  "status": 200
}
```

`outcome` is `sent` (the vendor answered; `status` is its status), `refused`
(`code` says which refusal), or `failed`. `url` is the origin and path of the
request as built — tokens, never values, and never the query string — and is
null when the refusal came before a request was built. Tests capture it with
`setKeyUseSink`.

## Tests

- `packages/host/tests/unit/operation-lowering-test.ts`, the callApi section:
  one test per lowering check, lowered from plain data, and the normalized URL
  and destination.
- `packages/host/tests/unit/call-api-destination-test.ts`: `destinationCovers`.
- `packages/realm-server/tests/realm-endpoints/call-api-test.ts`: end to end
  through `_operations` against the stub vendor on a fixed port, because the
  vendor URL is written into the card module.
- `packages/realm-server/tests/call-api-sender-test.ts`: substitution,
  redirects, safe headers, and how guard refusals and timeouts map to codes.

A realm-server test that indexes a `callApi` declaration needs a host dist
built from your tree (the prerenderer's host bundles `@cardstack/base`). See
the `agent-peer-collaboration` skill on serving your own dist.

## Related skills

- **`outbound-guard`** — what the client refuses, the response cap's observe
  mode, the scrubber.
- **`operations-diagnosis`** — the `boxel:operations` channel around the call.
- **`key-bindings`** — the bindings that fill slots, and their refusals.
- **`secrets-at-rest`** — where a key a binding fills from is stored.
