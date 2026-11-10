---
status: proposed
date: 2026-11-06
scope:
  - packages/realm-server/lib/oauth-provider/**
  - packages/realm-server/handlers/handle-oauth-provider-*.ts
  - packages/realm-server/middleware/index.ts
  - packages/realm-server/middleware/multi-realm-authorization.ts
  - packages/realm-server/routes.ts
  - packages/realm-server/lib/request-telemetry.ts
  - packages/realm-server/tests/oauth-provider-*
  - packages/realm-server/lib/secure-session.ts
  - packages/realm-server/handlers/handle-revoke-user-sessions.ts
  - packages/runtime-common/realm.ts
  - packages/postgres/migrations/*oauth-provider*
  - packages/secure-origin/src/shell/pages.js
  - packages/secure-origin/src/shell/authorize/**
  - packages/secure-origin/src/shell/connected-apps/**
  - packages/secure-origin/src/shell/device/**
  - packages/secure-origin/src/security/oauth-provider*
---

# 021. Run Boxel's OAuth provider in the realm server, with opaque tokens bound to one resource

Outside apps, such as AI assistants connecting to Boxel's MCP server and
Boxel's own CLI, act for a user through OAuth. Boxel is its own authorization
server. It runs in the realm server, and its pages run on the secure origin.
Its access tokens are opaque, each bound to one resource and looked up on
every request, so a disconnect or a revoked session applies from the next
call. A resource checks a token only through one shared lookup, and the realm
and realm-server routes come out of it with the same user a session token
gives. Consent needs a secure session, is shown on every flow, and finishes
only in the browser that started it. This ADR records those rules and the
designs they replaced. The provider is separate from `lib/oauth.ts`, where
Boxel is the client of other services' OAuth.

## 1. Decision

In this ADR, a _resource_ is an API protected by OAuth, named by one URL that
is the audience of its tokens. It may be one endpoint, such as `/mcp`, or many
routes, such as the Boxel API (the realm and realm-server routes its registry
entry maps, §1.3). An _OAuth grant_ is the stored result of one consent. A
resource's _controller_ is the code that reads its OAuth tokens. A _verified
caller_ is what a controller builds from a token.

### 1.1. The provider

The provider MUST be `oidc-provider`, running in the realm server. The issuer
MUST be the realm server's public URL, with no path and no trailing slash, and
the provider's endpoints and discovery documents MUST be realm-server routes,
since the secure origin serves only its pages (ADR 019 §1.1). Every URL the
provider publishes MUST be built from the issuer, never from the request, and
discovery MUST list only what the realm server serves. The provider's routes
MUST answer only on the issuer's host. Its pages (sign-in, consent, device-code
entry, connected apps and its error pages) MUST be pages of the secure
origin's app.

The provider MUST allow only the authorization code flow with S256 PKCE, and
the device authorization grant (§1.4). Each library feature MUST be set
explicitly in the configuration, including a feature whose default is the
setting wanted. The library's development login and consent pages
(`devInteractions`) MUST be off. The provider is an OAuth authorization
server, not an OpenID provider: it MUST NOT issue ID tokens or answer
`userinfo`. A client learns about the user only through the resources it was
granted.

### 1.2. Tokens and storage

An access token MUST be opaque, and MUST be bound to exactly one resource. A
resource MUST look its token up on every request, and MUST NOT cache the
result past the request.

Every bearer secret the provider issues (access and refresh tokens,
authorization codes, device codes, and the tickets and error references of
§1.7 and §1.8) MUST be stored and found only by the SHA-256 hash of its
value. A stored row MUST NOT hold the value itself. Provider rows SHOULD NOT
be sealed with the secrets-at-rest envelope: they hold no other secret.

### 1.3. Resources and OAuth grants

Resources MUST be declared in a registry in code, which the provider reads
through `oidc-provider`'s `getResourceServerInfo` on every authorization and
token request. The registry MUST NOT change at run time. Each entry MUST name
its scopes, what consent says for each, the kinds of client it accepts
(§1.4), and, for each scope, the routes it admits. A resource's identifier
MUST be the issuer followed by the resource's path, with no trailing slash.

A controller MUST refuse an OAuth token on a route its entry doesn't map to
one of the token's scopes, so a route added later refuses OAuth tokens until
an entry maps it. An entry MUST name a route as its router registers it: by
method and path pattern, and in the realm by MIME type too. A controller MUST
match the route its router selected for the request, after any method
override, and never the request's URL against an entry. An entry MUST NOT
name a method or path pattern that no route is registered with. The realm
can't read the registry, so the realm server hands each realm the part of the
map that names realm routes. The check against the map MUST be one shared
function, which each controller calls right after the lookup, and it MUST take
only the verified caller and the route its router selected, never the
request. A route that checks its caller another way, by an
operator token, a shared secret, or a session token it verifies itself, never
reaches a controller, and so refuses OAuth tokens. `/mcp`'s entry maps its one
route to each scope, so `/mcp`'s controller MUST admit a tool call only when
the tool, where it is defined, names a scope the token holds. A tool that
names no scope MUST NOT be served.

A resource that needs more than its scopes describe MUST be a new entry, not a
wider scope. Each resource MUST publish protected-resource metadata (RFC 9728)
naming the issuer and its scopes.

Each consent MUST create a new OAuth grant, holding exactly the scopes the
user approved at each resource the flow named, with its own expiry. A consent
MUST NOT merge into, widen or replace an earlier grant. A flow MAY name
several resources. A token request names one of the grant's resources, or
none when the grant holds only one, and the access token MUST be bound to that
one resource.

### 1.4. Clients

A client MUST be either pre-registered in code, with a fixed client ID and no
registration endpoint or table, or registered openly, by a client ID metadata
document (CIMD) or by dynamic client registration (DCR). Each registry entry
MUST say whether it accepts open registration or only pre-registered clients.
The Boxel API's entry MUST accept only pre-registered clients. A flow that names a resource the client isn't accepted at MUST be refused
whole, before consent. The device authorization grant MUST be allowed only
for pre-registered clients. A client registered openly MUST be a public client
(`token_endpoint_auth_method: none`).

A redirect URI MUST be HTTPS or an HTTP loopback address, and MUST match a
registered one exactly, except for the port of a loopback address (RFC 8252
§7.3). A CIMD client ID or a redirect URI MUST NOT be on a host where Boxel
serves its own pages or users' files: the realm server, the secure origin, the
published-site domains, and every app origin the realm server lists for the
deployment (ADR 005 §1.7), other than a loopback address.

Consent MUST take what the access means (each resource's name, what it covers
and what each scope allows) from the registry. Consent MUST name a CIMD client
by its client ID's registrable domain, and a DCR client as unverified, beside
its redirect URI's registrable domain. It MUST NOT show a client's logo or
website link.

The endpoints that need no sign-in (registration, authorization, token and
device-code entry) MUST be rate-limited. The token endpoint's limit MUST NOT
be keyed on the caller's address alone, since a hosted client refreshes every
user's tokens from a few addresses. A client registered by DCR SHOULD be
deleted once it has gone unused for a set period.

### 1.5. Validating a token

A resource MUST check an OAuth token only through the provider's shared
lookup. Only its controller MAY call the lookup, and it MUST call it at most
once per request. `/mcp`'s controller is its entry point. The Boxel API's
controllers are `Realm.#verifySession`, `multiRealmAuthorization` and
`jwtMiddleware`. A route that checks a session token itself, such as
`/_download-realm`, MUST refuse an OAuth token. The lookup MUST be called from
the controller itself, not from a helper such a route shares with it. A
controller MUST read an OAuth token only from the
`Authorization: Bearer` header, and MUST answer one sent anywhere else with
`400` without looking it up. The token MUST NOT leave the controller: it MUST
NOT be forwarded to another service or route, or logged.

The lookup MUST refuse a token that is unknown or expired, whose audience is
another resource, whose OAuth grant has ended, expired or no longer holds the
resource, or whose grant was created before the user's OAuth grants were
last revoked. The token endpoint MUST apply the same grant checks on every code and
refresh exchange.

A verified caller MUST hold exactly the user, the OAuth grant, the OAuth
client, the token's scopes and the time the grant was created, and nothing
taken from the request. The Boxel API's controllers MUST come out of an OAuth
token with the same user a session token gives, so every permission check after them is unchanged. A
token's scopes MUST act only as a ceiling on what its caller may do: the
user's current realm permissions MUST still decide each call, and a scope MUST
NOT grant what they don't (ADR 006). An OAuth token MUST NOT be exchanged for a
realm-server session, a realm session, a delegated session or a Matrix login.

### 1.6. What an OAuth token never reaches

A verified caller MUST NOT carry `secureSession` (ADR 005 §1.2). An entry
MUST NOT map a scope to key management, reads included, to a route that needs a
secure session, to a route that mints a token or a signed URL, or to a route
that changes a realm's permissions. Each of these refusals MUST be tested, on
the realm server and in the realm.

An OAuth token MUST NOT change what a realm's policy admits (ADR 006 §1.3): a
write that changes `realm.json`'s `policy` or `config`, or the `RealmPolicy`
card `policy` names, MUST be refused. A policy grant that reads the card it
guards gives that part of the decision to anyone who can write the card, OAuth
tokens included.

### 1.7. Consent

An OAuth grant MUST be created only under a secure session (ADR 005 §1.1). The
app's session and a Matrix token MUST NOT be enough. Consent MUST be shown on
every flow, including when the user has approved the same client before. The
provider MUST NOT keep a login of its own between flows: each flow takes its
account from the secure session that decides it. The routes that read a flow's
details and take its decision MUST answer only a request whose `Origin` is the
secure origin's. The consent page MUST render only what the realm server
returns for the flow, never the client's request itself.

In the authorization code flow, a consent decision MUST finish the flow only
in the browser that started it. The flow MUST finish on a realm-server route,
reached by a top-level GET navigation, that sees the interaction cookie the
provider set when the flow started. It MUST finish only when that cookie, the
route's interaction and a single-use ticket returned by the decision all name
the same interaction. A ticket MUST be spent on its first presentation,
whether or not the flow finishes.

In the device authorization grant, the user MUST enter the user code on the
secure origin's device page, under a secure session, and see the same consent.

### 1.8. Errors

The provider MUST NOT redirect an authorization error to a redirect URI before
Boxel has validated the client and that URI. A request Boxel refuses MUST be
refused before the library handles it, and that refusal, and an error the
library renders, MUST go to the secure origin's error page. A link from that
page back to the client MUST go through a realm-server route that reads the
redirect URI it stored with the error. The secure origin MUST NOT receive a
redirect address. A user who denies consent MAY be returned to the client at
once. An error the library raises for a request Boxel has already checked MAY
redirect.

### 1.9. Renewal and revocation

A refresh token MUST be issued only on an OAuth grant the user chose, on the
consent page, to keep. Refresh tokens MUST rotate on every use, and presenting
a used refresh token again MUST end its grant, with one exception. Within 30
seconds of a refresh token's first use, measured from that use and recorded
atomically, presenting it again MUST rotate it again, but only while no
refresh token issued from it has been used. Otherwise, presenting it again
MUST end the grant as reuse does. The refresh tokens issued from one token are
siblings: once one of them is used, the others MUST be revoked, and presenting
a revoked sibling MUST end the grant.

A renewing grant MUST expire 30 days after its consent at most, and a refresh
MUST NOT succeed past its grant's expiry. By default, an access token SHOULD
last 10 minutes on a renewing grant and 60 minutes on a non-renewing one, and
a non-renewing grant SHOULD expire 60 minutes after its consent. A registry
entry MAY shorten a lifetime, and MUST NOT lengthen one. Revoking any token of
an OAuth grant MUST end the whole grant.

An operator's revocation of a user's sessions, and the first revocation after
a password change (ADR 005 §1.6), MUST also revoke the user's OAuth grants.
The later revocation that covers Matrix OpenID tokens MUST NOT, since an
OpenID token can't create a grant (§1.7).

## 2. Rationale

Card code can carry the app's session and Matrix token out of the browser, so
neither can prove that the user approved an outside app (ADR 005). Consent
therefore runs on the secure origin, under a secure session. The issuer stays
on the realm server, because the secure origin serves only its own pages
(ADR 019 §1.1).

Every other token Boxel accepts is a signed JWT that stays valid until it
expires. An outside app's access should end when the user disconnects it, and
when an operator revokes the user's sessions. An opaque token costs one indexed
lookup per request, which already replaces the revocation read a session
token's request makes, and buys revocation from the next call.

boxel-cli calls realm and realm-server routes directly, so the Boxel API's
controllers accept OAuth tokens where they accept session tokens. Coming out
with the same user keeps realm permissions the only source of authority (ADR
006). Binding each token to one resource bounds what a stolen token reaches:
an `/mcp` token is refused on every realm route, and only Boxel's own apps get
a token for the whole API.

The resources ship with the provider, and each needs a controller in code that
validates its tokens. A resource added without code would protect nothing, so
the registry is code, reviewed like any other change. Each scope admits only
the routes its entry maps, because many routes check nothing a scope could
narrow: a route that deletes a realm checks ownership, not what the token
allows. The map puts everything a scope reaches in one place, beside the text
consent shows for it. A list of refused routes would fail open: a route added
later would accept OAuth tokens until someone listed it. A rule on the HTTP
method would fail both ways: `_capabilities` is a `POST` that only reads, a
`QUERY` may arrive as a `POST` with a method override, and a `QUERY` can mint
a signed URL. An entry names the route its router selected, not a pattern
over URLs, because realm routes share paths: every card document is read
through one pattern, and a URL pattern broad enough for card paths would also
match `_sign-capture-urls`. The check reads only who is calling and which
route was selected, never how the credential arrived, so it can move whole
into an access decision that never sees the request, and one shared function
leaves that move a single call site.

The library builds the URLs it publishes, and sets its cookies, from whatever
host a request names. The realm server also answers for published sites,
whose pages users write, so a flow started there would set its cookies on a
host a user controls. Clients compare the issuer and resource identifiers as
strings, and grants hold them, so their form is fixed here.

An outside app acts on content the user didn't write, so widening who can
reach a realm stays with the user in Boxel itself, whether by its permissions
or by its policy.

A password change revokes the user's sessions twice. The second revocation,
about an hour later, ends sessions a signed-out Matrix device could still mint
with an OpenID token it obtained before. A grant needs a secure session, which
no OpenID token can give, so grants keep their own cutoff. Otherwise a user who
reconnects their apps right after the change would lose them again an hour
later.

MCP clients are written by other companies, and a user connects any of them
by its server URL, so they can't be listed in code ahead of time. Open
registration lets them connect, and lets anyone register under any name. So
consent names a client by what can be checked, its domain, and a redirect or
client ID on one of Boxel's own hosts is refused, since anyone can serve a page
there. Every outside client is public, and a loopback redirect matches any
port, so any program on the user's machine that knows a client ID can start a
flow. RFC 8252 §8.6 rules out skipping consent for such clients even when the
user has approved them before.

The library binds a flow to its browser only through its own cookie, which
the secure origin's pages never send, so Boxel adds the ticket check itself.
Without it, a user sent an attacker's consent link could approve a flow that
finishes in the attacker's browser. The finish route is a GET navigation,
because the secure origin's pages post forms only to themselves (ADR 005
§1.4).
The ticket travels in its URL, but it is spent on first presentation, so one
that reaches a log is already dead. With open registration, error redirects
would let anyone use Boxel's domain as a redirect to their own site (RFC 9700
§4.11.2).

A refresh can fail on the way back: the client's request is used, but the
response is lost, or the client refreshes twice at once. The grace window
keeps that connection instead of ending it as reuse. The window admits a
retry only before any child is used, which stops a thief who refreshes and
then refreshes again. Revoking siblings once one is used stops a thief whose
child is still unused. Either way one live chain remains, and the side that
refreshes second ends the grant.

The library's defaults suit a general OpenID provider. Its development
interactions are on by default and sign in any account ID typed into them, so
no feature is left to its default. Each bearer secret but the device user code
is a long random value, so its hash is enough to find it, and a database
reader can't use what it reads. The user code is short by design, so its entry
is rate-limited and it expires in minutes. The envelope would protect nothing
more.

## 3. Considered options

- **`oidc-provider` in the realm server (chosen).** It is the only option
  where consent runs on the secure origin under a secure session and the grant
  read on each request is Boxel's own row.
- **The Matrix Authentication Service.** It binds no audience to its tokens, so
  a resource's token would also be a full Matrix token, and it runs consent on
  its own domain. Adopting it changes how every Boxel client signs in, by
  migrating every account.
- **A hosted identity provider.** It adds a second user directory beside
  Matrix, runs consent on the vendor's domain, and issues JWTs, so revocation
  would still need a Boxel grant row.
- **Other libraries.** Cloudflare's `workers-oauth-provider` runs only on
  Workers. The MCP SDK's auth router leaves storage, consent and rotation to
  the app.
- **A separate provider deployment.** It needs a secure origin of its own,
  and a database account, Matrix credential and data key shared with the realm
  server.
- **The secure origin as issuer.** It would serve endpoints beside its pages.
- **Signed JWT access tokens.** A disconnect or a revoked permission would
  wait out the token's lifetime.
- **A token proxy that trades the OAuth token for a Matrix login, then a realm
  session, on each call.** Three Matrix round trips per call, a Matrix admin
  credential able to act as any user, and read-only access enforced only at
  the proxy.
- **Exchanging the OAuth token for a realm session.** A realm session is
  stateless and outlives the grant, so revoking one grant would mean revoking
  every session the user has.
- **Only `/mcp` accepts OAuth tokens.** boxel-cli could not sign in with
  OAuth, since it calls realm and realm-server routes directly.
- **One resource derived from the server's URL.** A second resource would need
  a new consent model and a migration of grants.
- **A registry edited at run time.** It would add a way to create an audience,
  or widen a scope, without review, for resources whose controllers ship in
  code anyway.
- **A stance on each route where it is registered, and a permission ceiling
  in the realm.** What a scope reaches would be spread over every registration
  on the realm server and in the realm, with no one place to review it, and
  the ceiling alone admits a realm route that needs only `read` but mints a
  signed URL.
- **Admitting a token by HTTP method, with a list of refused routes.**
  `_capabilities` is a `POST` that reads, a `QUERY` may arrive as a `POST`
  with a method override, `_sign-capture-urls` is a `QUERY` that mints, and a
  route added later accepts OAuth tokens until it is listed.
- **A list of routes that refuse a resource's tokens.** It fails open: a route
  added later accepts OAuth tokens until someone lists it, and a scope can't
  narrow a route that checks nothing a scope describes.
- **Grants that share the session-revocation cutoff.** The follow-up
  revocation after a password change would end grants made in the hour after
  it, though nothing it covers can create one.
- **Pre-registered clients only.** Outside MCP clients could not connect.
- **Boxel's own apps registered by DCR or CIMD.** DCR shows them as
  unverified, which teaches users to click through the label. CIMD needs a
  client ID off Boxel's own hosts.
- **Private-use redirect schemes, such as `cursor://`.** Any app on the device
  can claim a scheme (RFC 8252 §8.1), so the redirect proves nothing about the
  client. A client that offers only such a scheme can't connect.
- **One grant per user and client, merged or replaced on each consent.**
  Merged, a scope stays until the user disconnects, and two machines running
  the same client can't be disconnected apart. Replaced, the latest consent on
  any machine decides for every machine.
- **Skipping consent when a grant already holds the scopes asked for.** Any
  local program that knows the client ID would get a code unseen. Narrowing
  the skip to HTTPS-only clients with unchanged redirects saves a click only
  on rare reconnects.
- **Strict refresh rotation, with no grace window.** A lost response would end
  the connection, and the user would have to connect the app again.
- **A grace window that keeps every token it issues.** A stolen refresh token
  and the real one would each keep a live chain, so reuse would never be seen.

## 4. Sources

- The proof of concept and its draft ADR: #6846, at `ee8bc0488f`.
- [A review of #6846](https://github.com/cardstack/boxel/pull/6846#pullrequestreview-5589144640).
- RFC 6749, RFC 7009, RFC 7591, RFC 8252, RFC 8414, RFC 8628, RFC 8707,
  RFC 9700 and RFC 9728.

## 5. Remediation

Known gaps are listed in [remediation/021.md](remediation/021.md).
