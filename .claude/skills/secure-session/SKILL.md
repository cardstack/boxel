---
name: secure-session
description: Operate and diagnose sessions signed in on the secure origin — the `secureSession` claim on a realm-server session, the `secure_sessions` table behind it, how the secure window and `boxel keys sign-in` get one (a password checked by a Matrix user-interactive auth check the realm server drives through `account/3pid/add`, or the realm server's own Google sign-in returning to the secure origin), and what it gates (minting key write tickets). Use when a user can't sign in to the secure window or the CLI's `boxel keys sign-in`, when a key write ticket is refused with "issued only to a session signed in on the secure origin", when reading `secure_sessions`, when Synapse's admin credentials or the Google client change, when a password change or reset should have ended a secure session, or when changing `lib/secure-session.ts`, `lib/google-sign-in.ts`, `handlers/handle-secure-session.ts`, `packages/secure-origin/src/shell/sign-in/`, `packages/secure-origin/src/shell/password-reset/`, `packages/secure-origin/src/security/registration.ts` or the credential fields' `set-password`.
---

# Secure sessions (operators)

A **secure session** is a realm-server session signed in on the secure
origin, which card code can't reach. Why key changes need one, and the rules
that keep it out of card code's reach, are ADR 005
(`docs/adr/005-authorize-key-changes-only-with-a-session-card-code-cant-reach.md`);
read it before changing what a secure session gates or how one signs in. The
code is `packages/realm-server/lib/secure-session.ts` and
`handlers/handle-secure-session.ts`; the window's side is
`packages/secure-origin/src/security/session.js` and the sign-in components in `packages/secure-origin/src/shell/sign-in/`.

## The claim and what it gates

A secure session is a realm-server JWT with `user`, `sessionRoom` and
`secureSession`: the id of a `secure_sessions` row. It works anywhere the
user's session does, and additionally:

| Gate                                | Requires                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `POST /_key-write-tickets`          | `isSecureSession`: the claim, naming a row of the token's user, not expired                                         |
| `GET /_secure-session`              | The same; answers 204, or 401 `signed-out`                                                                          |
| `POST /_secure-session/login-token` | The same, and `Origin` the secure origin's; answers a single-use Matrix login token for the user                    |
| `POST /_secure-session/renewal`     | `Origin` the secure origin's, a `window` row that hasn't ended, and the row's current token, which may have expired |

Minting also still requires the request's `Origin` to be the secure origin's
or absent (the CLI). Only `createSecureSessionJWT` mints the claim (ADR 005
§1.2); `tests/secure-session-test.ts` asserts that `createJWT` and the realm
session minter in `jwt.ts` refuse it.

## `secure_sessions`

| Column          | Holds                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| `id`            | UUID the token's `secureSession` claim names                                                         |
| `user_id`       | Matrix user id                                                                                       |
| `client`        | `window` (the secure window's own session) or `cli` (`boxel keys`)                                   |
| `sign_in_proof` | What signed in: `uia:<UIA session>` for a password, `google:<sha256 of the code>` for Google; unique |
| `created_at`    | `timestamptz`                                                                                        |
| `expires_at`    | Seven days after sign-in (`SECURE_SESSION_TTL_SECONDS`); signing out sets it to now (see below)      |
| `app_device_id` | For a `window` row, the Matrix device its latest hand-off signed the app in as; renews the row       |

Excluded from the SQLite schema dump and withheld from `readonly_role`.
Signing out expires a row rather than deleting it, and rows are swept two
days after they expire, so a proof can't sign in again after its session
ends. A row with an `app_device_id` hasn't ended, whatever its `expires_at`
says, and isn't swept (see below). To sign a user's secure sessions out,
expire their rows and clear `app_device_id`; revoking all of a user's
sessions (`isSessionRevoked`) ends these too.

## How long a window's session lasts

A window's session lasts as long as the app session it handed a sign-in to
(ADR 005 §1.8). When the window mints a hand-off's login token, the realm
server picks a fresh Matrix device id (ten capital letters), records it as
the row's `app_device_id`, and answers it as `deviceId` beside the token. The
window hands both to the app in the fragment
(`return#loginToken=…&deviceId=…`), and the app redeems the token with an
`m.login.token` login naming that `device_id`, so the app's Matrix device is
the one the row names. A later hand-off from the same window rebinds the row
to the later device. The CLI's rows are never bound, and the CLI's hand-offs
carry no `deviceId`.

The window renews its session in its last day, or once it has passed
(`liveSession` in `packages/secure-origin/src/security/session.js`), with
`POST /_secure-session/renewal` under its stored token, which may have
expired. Within that day the realm server asks the Matrix server's admin API
whether the device still exists (`GET
/_synapse/admin/v2/users/<user>/devices/<device>`):

- **It does:** the row's `expires_at` moves to a week from now, and the
  answer is the session with a fresh token for that week.
- **It doesn't:** the binding is cleared, and the row ends at its
  `expires_at`, as one never bound does: the answer is the session as it
  stands, or `401 signed-out` once it has passed.
- **No answer:** a row that hasn't expired is answered as it stands, and one
  that has is `503 unavailable`; the window keeps its stored session and
  tries again when it next opens or regains focus.

Earlier than that day, renewal answers the session as it stands and asks the
Matrix server nothing. Only the row's current token renews it: one whose
`exp` is the row's `expires_at`, within five seconds. A renewal that moves
the row's end leaves every earlier token behind, so a token copied out of the
window renews nothing once the window has renewed past it. `DELETE
/_secure-session` takes an expired token too, so a window can sign out a
session bound to the app's after its token has run out, which also clears the
binding. A row bound to a device that never shows up, as when
the app never redeems a hand-off, lasts its week. A bound row whose device
has gone, and which no window renews again, stays in the table until a
renewal finds the device gone.

## What ends a secure session

| What                   | Route                                    | Ends                                                                |
| ---------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| Its seven days pass    | —                                        | That session, unless it is bound to an app device that still exists |
| Signing out of it      | `DELETE /_secure-session` (the session)  | That session: `boxelSignOut()` in the window, `boxel keys sign-out` |
| Signing out of the app | `DELETE /_secure-sessions?client=window` | Every unended `window` row of the token's user                      |
| Changing the password  | `POST /_secure-sessions/password-change` | Every unended row of the account, `cli` included, once it is set    |
| Revoking all sessions  | —                                        | Every session of the user (`isSessionRevoked`)                      |

The app's sign-out (`MatrixService.logout()`) calls `DELETE
/_secure-sessions?client=window` with the outgoing account's realm-server
session, before it drops that session. It is best effort and never awaited, so
a failing or slow server can't hold sign-out up; a failure is only a console
warning, and the user's window sessions then last until they expire. The app's
session is refreshed on a timer that fires late on a slept laptop, so this
route alone accepts a session that expired up to `SECURE_SESSION_TTL_SECONDS`
ago (`jwtMiddleware`'s `expiredWithinSeconds`); every other route refuses an
expired one. The app page can't clear the window's session itself: it can't
read the secure origin's storage and keeps no handle to the window (ADR 005
§1.4).

That route takes any session of the user, the app's included, so card code can
call it. All it can do is sign the user out of key management, which signing
in again undoes; it answers 204 whether or not a row ended, and reads, lists
and extends nothing. It ends the user's windows in every browser, since rows
aren't tied to one, and leaves `cli` rows alone: the CLI usually runs on
another machine.

Every page that sets a password sets it through `POST
/_secure-sessions/password-change` (a `password-change` resource), in place of
the Matrix request: the secure origin's `reset-password` page, and the
credential fields' `set-password`, which the profile modal's change password
uses. The realm server makes the Matrix `account/password`
request itself (`changePassword` in `lib/secure-session.ts`), with
`logout_devices: true`, and answers with the Matrix server's status and body,
which the page reads as it would the Matrix server's own. Once the Matrix
server accepts the change, it expires every unexpired row of the account:

- **A change** (`attributes.{accessToken, currentPassword, newPassword}`): the
  account is the access token's (`account/whoami`). The Matrix server checks
  the current password, so card code, which holds the app's token but never
  sees a password, can't end the CLI's sessions this way. The device that made
  the change stays signed in; every other device is signed out.
- **A reset** (`attributes.{sid, clientSecret, email, newPassword}`): the
  Matrix server finds the account from the validated email and doesn't say
  which it was, so the realm server checks the new password against the
  account `email` names (`confirmPassword`), and ends nothing when it doesn't
  check out. That check is made whatever the per-account limit on failed
  sign-ins says, so keeping the limit full can't stop a reset from ending
  sessions. The Matrix server deletes a validation session the first time a
  reset uses it, so a second request with it is refused (401
  `M_UNAUTHORIZED`), and each check costs a confirmed reset email.

The route answers only the secure origin (403 `forbidden`), and the same
whether or not a row ended. When ending the sessions fails after the password
is set (the Matrix server's admin API is down, say), the failure is logged on
`realm:secure-session` and the route still answers 200; the sessions then last
until they expire. A password set any other way, such as by an operator
through Synapse's admin `reset_password`, ends no secure session. To end them,
expire the rows.

The Matrix server signs out the account's other devices when the password
changes, but not its unused login tokens, which any device of the account (and
a secure session, through `POST /_secure-session/login-token`) can mint, and
which sign in a new device after the change. So once a change or a reset
through the route has ended the account's rows, the realm server records a
**device sweep** in `password_change_device_sweeps` (`user_id`,
`keep_device_id`, `sweep_at`, `revoke_at`), due `DEVICE_SWEEP_DELAY_MS` later: a login
token's two-minute lifetime and a margin. The sweep signs out every device of
the account through the admin API (`_synapse/admin/v2/users/<user>/devices`,
then `delete_devices`) except `keep_device_id`, the device that made a change
(none for a reset), revokes every realm-server session of the account issued
until then (`revokeUserSessions`; the kept device mints a new one), and sets
`revoke_at` `SESSION_REVOCATION_DELAY_MS` later (an OpenID token's hour and a
margin). A swept device's OpenID token belongs to no device and outlives it,
and buys a realm-server session, so at `revoke_at` the account's realm-server
sessions are revoked once more, signing nothing out, and the row is deleted.
The sweep doesn't stop a device that hands itself on: signed in with an old
token, it can mint a login token just before the sweep and redeem it after,
again and again. Requiring the password to mint one
(`login_via_existing_session.require_ui_auth`) would stop that, and would stop
`mintLoginToken` too, whose admin-minted access token has no password to
give. A device signed in with the new password before the sweep is
signed out too; nothing tells it apart from one an old token signed in. After a
reset that is usual, since the reset page offers to sign in straight away.
Each realm-server process arms a timer for the earliest sweep it knows of,
runs the sweeps due when it starts, and looks for due ones every minute
(`resumeDeviceSweeps`), so a deploy within those minutes doesn't drop one. A
sweep that fails stays in the table, is logged on `realm:secure-session` as
"could not sign a changed password's devices out", and is tried again within
a minute. A later change of the same account moves its sweep later and keeps
that change's device.

A reset link carries the email address it was sent to in its fragment, so
the page it lands on can name the account: `#clientSecret=…&email=…&sid=…` on
the secure origin, and `?clientSecret=…#email=…&sid=…` in the app (Synapse
appends the `sid` to the end of the link). A link without one still resets
the password, and ends no session.

The window checks its stored session with `GET /_secure-session` (204 while
it's live, 401 `signed-out` once it has ended) when it opens, and again when a
request it makes under the session is refused with a 403, which is how a key
write ticket refuses an ended session. An ended session is forgotten. A
sign-in page then shows "Sign in to Boxel" with no error. A key page never
signs in, as it never signs out: it says to sign in to Boxel from the page
that opened it, and shows nothing else (ADR 005 §1.6). The window's session
for its key pages is the one Boxel's own sign-in on this origin leaves here
(§1.7). When the check gets no answer
within ten seconds, or the server can't be reached, the window keeps its
session.

## Signing in

Only the user's own credential, presented on the secure origin, signs in (ADR
005 §1.3).

**Password** — `POST /_secure-session` (`attributes.{username, password,
client, registrationToken?}`), one request. The server resolves the account (Matrix id, email via
the admin threepid lookup, or a bare username), mints a token for it through
Synapse's admin "log in as user" API, posts `account/3pid/add` with a made-up
validation session, and completes the UIA password stage with the password.
Synapse runs the request only once the password is right, and it then fails
with `M_THREEPID_AUTH_FAILED` having changed nothing — that failure is the
proof. Both admin-minted tokens are logged out at once. A missing account, one
with no password and a wrong password all answer the same `401
invalid-credentials`. An account that has never signed in to Boxel (no session
room) gets the app's first-sign-in setup (step 5 below) once its password checks
out, with `registrationToken`, the invite code it registered with, recorded on
its realm-server user. That is how an account created on the secure origin's
`register` page signs in for the first time: the page registers with the Matrix
server itself, signs that registration's Matrix session out, and signs in here
with the new password (`Registration#signIn` in
`packages/secure-origin/src/security/registration.ts`).

Failed password sign-ins are limited per account (`lib/sign-in-limiter.ts`)
with the Matrix server's default limit on failed logins to the app
(`rc_login.failed_attempts`: a burst of 3, draining at 0.17 a second); the
limits are fixed in code, not read from the Matrix server's configuration.
Only failures count, a successful sign-in never does, and nothing is
limited per address. The Matrix server's own failure limit doesn't cover these
sign-ins, because it doesn't count a wrong password in a UIA check, so the
realm server keeps the count itself, per process. Failures count against the
Matrix user id the account resolves to, however it was named (username, Matrix
id or email), or against the name when it names no account, as the Matrix
server counts failed logins. Once an account has failures, its sign-ins in
flight count against the burst too, so guesses sent together can't outrun the
failure rate; an account with none may have up to 10 in flight. An account over the limit is refused before its
password is checked, with `429 rate-limited`, a `Retry-After` header, and the
exact wait in `errors[0].meta.retryAfterMs` (none when refused for sign-ins in flight). A
Matrix 429's wait (`retry_after_ms`, or its `Retry-After` header) is passed
through the same way. The window
shows it in the app's words: "Sign-in failed. Too many failed attempts, try
again in N minutes." (`packages/secure-origin/src/shell/sign-in-copy.js`). Google sign-in has no
limit of its own.

**Google** — the realm server is its own OpenID Connect client, using the
Matrix server's Google client (`lib/google-sign-in.ts`):

1. The window gets `GET /_secure-session/google` (authorization endpoint,
   client id, and the redirect URI `<secure origin shell>/google-callback`),
   keeps a state, a nonce and a PKCE verifier in the secure origin's session
   storage, and sends itself to Google.
2. Google returns to `<secure origin shell>/google-callback`, which serves the
   shell; the window checks the state and posts `POST /_secure-session/google`
   (`attributes.{code, codeVerifier, nonce, client}`).
3. The server redeems the code at Google's token endpoint with the client
   secret, against its own redirect URI, and checks the ID token's issuer,
   audience, expiry and nonce (the token comes straight from Google over TLS,
   so its claims are checked, not its signature).
4. It resolves the Google identity to an account. The Google link is a
   Synapse external id under the `oidc-google` provider, the id Synapse's
   single sign-on records its links under, so an account linked that way
   resolves here too. Synapse has no OIDC provider configured: its admin API
   reads and writes external ids whatever its configuration says.
   - **Linked by `sub`**: the account linked to the Google subject,
     `GET /_synapse/admin/v1/auth_providers/oidc-google/users/<sub>`. A
     deactivated or locked account is refused.
   - **Not linked**: the email must be verified. The account holding it
     (`GET /_synapse/admin/v1/threepid/email/users/<email>`, lowercased, and
     as Google spells it) gets the Google link added to its `external_ids`
     (`PUT /_synapse/admin/v2/users/<user>`, keeping its other links), and
     signs in. More than one account holding it is refused.
   - **No account**: a new one is made through the admin API, with a
     localpart from the email (the email's local part, sanitized, then
     `alice1`, `alice2`… past taken ones), Google's `name` as its display
     name, the email as a third-party id, and the Google link. An empty `PUT`
     makes the account, and only its `201` means this sign-in owns it, so a
     taken localpart is never changed. A localpart is taken when an account
     has it ignoring case, as Synapse's registration compares it; the admin
     lookup matches only exactly, so a `M_USER_IN_USE` refusal of the `PUT`
     counts the localpart as taken and the next one is tried. A sign-in that fails after making the
     account unlinks and deactivates it, so the next one resolves again.

   The rules live in `lib/google-account.ts`, and
   `tests/google-sign-in-vectors.json` holds the cases
   `tests/google-account-test.ts` runs.

5. An account with no session room gets the app's first-sign-in setup before
   the session is minted, as a password sign-in's does: the realm-server user and its first credit grant, a
   personal realm when its account data doesn't list the user's own
   (`<username>/personal/`; a realm shared with them doesn't count) (one already in
   `realm_registry` is recorded, not made again), and last the session
   room, so a sign-in that fails part way sets up again.

Both POSTs answer only a request whose `Origin` is the secure origin's. The
CLI never calls them; it opens a page of the window, which signs in with
`client: 'cli'` and hands the result to the CLI's listener at
`http://127.0.0.1:<port>/callback` (after a Google round trip too; the CLI's
port and state wait in session storage):

- `boxel keys sign-in` opens `<secure origin>/cli-sign-in?port=…&state=…`,
  and the window posts the session (`secure_session`, `user_id`,
  `expires_at`, `state`).
- `boxel profile add` opens `<secure origin>/cli-auth?port=…&state=…&session=secure`
  when `GET /_secure-origin` says `cliAuth: true`, and the host app's
  `/cli-auth` otherwise or under `--host-url`, which forwards to this page
  with the same port and state. Once signed in, the window
  mints a Matrix login token with the session (`POST
/_secure-session/login-token`) and posts it as `login_token` beside the
  session's fields. The CLI redeems it (`m.login.token`) for a Matrix device
  of its own and keeps the secure session on the profile, so one sign-in
  serves realm commands and `boxel keys` alike. A `cli-auth` link without
  `session=secure` is one for a CLI that can't hold a secure session (one
  from before secure sessions opens the host app's `/cli-auth`, which
  forwards to this page). For
  it, the window ends the session it signed in and navigates to the listener
  with `?state=…&loginToken=…`, the form every released CLI accepts.

The terminal and CI sign-ins (`--no-browser`, `-u` with `BOXEL_PASSWORD`,
`profile migrate`, and the re-authentication prompt) log in to Matrix with
`m.login.password` directly and never reach the secure origin, so the Matrix
server's password login stays enabled. A Google sign-in the user cancels
(`error=access_denied`) returns the window to the page it started from: the
`cli-sign-in` page for the same listener, or the window's own sign-in. A
Google sign-in that fails any other way shows the error, with Start again
pointing at that same page. The shell's CSP allows that form
target, and `connect-src` to the realm server and the Matrix server (ADR 005 §1.4).

## Handing a sign-in to the app

The app draws no sign-in, registration or password-reset form: users do all
three on the secure origin's pages (ADR 005 §1.7). The Matrix server offers
no single sign-on, so Google sign-in happens only on the secure origin too.
Its password login stays, for the CLI's terminal sign-ins and the realm
server's password check.

1. A signed-out app (`components/matrix/secure-sign-in.gts`) replaces itself
   with `<secure origin>/sign-in#return=<the app page, path and query>`.
   `return` rides in the fragment, which no firewall or access log sees. The
   page is also a plain **Sign in to Boxel** link to the same address. A tab
   that comes back signed out within two minutes of being sent stops and
   says "Sign-in didn’t complete" (`sessionStorage`), and an app in a frame
   is never navigated: its link opens a new tab.
2. The sign-in page keeps `return` for the tab, in `sessionStorage`, once it
   checks out against the app origins the realm server lists
   (`boxel-app-origins` in the shell's markup: the credential fields'
   `--secureOriginAppOrigin` list and the realm server's own origin). Every
   way the window signs in (password, Google, a new account) ends on
   `SignedIn`, which then mints a login token, `POST
/_secure-session/login-token` under the window's secure session, and
   replaces the location with `return#loginToken=…&deviceId=…`, the token
   in the fragment so no server log or access log records it, and the device
   the window's session is bound to beside it (see "How long a window's
   session lasts"). A `return` on a
   loopback origin, `http:` or `https:`, first asks "Continue to
   http://localhost:4200?", unless it is the realm server's own. A `return` on an
   origin that isn't listed is dropped, and the window just says it is
   signed in.
3. The app redeems the token (from the fragment, or the query, where
   `boxel browse` puts it) with an `m.login.token` login,
   as the fragment's `deviceId` when it names one, before it loads any card, takes it out of the address, and boots as after any sign-in:
   realm-server session, realm tokens, service-worker sync.
   A token for another account than the one stored in the browser switches
   accounts (`MatrixService.switchAccount`), signing the stored one out. A
   token for the same account boots alongside it and signs nothing out. This
   happens when two tabs that signed out together each come back from the
   secure origin. Signing the stored session out would sign the other tab out,
   and would end the secure windows the sign-in just came from.

The login token is the Matrix server's own (MSC3882 `login/get_token`),
asked for with an admin-minted token for the user that is logged out right
after. The Matrix server binds it to the user, honours it once, and expires
it after `login_via_existing_session.token_timeout` (two minutes on every
deployment). It mints one per user a minute, and the route passes a refusal
on as `429 rate-limited` with `meta.retryAfterMs`. The window's
`loginToken()` waits and tries again for up to about a minute, so signing in
again straight after signing out shows "Signing you in…" for a while rather
than an error. The route answers only the secure origin (403 `forbidden`)
and only a live secure session (401 `signed-out`).

Signing out of the app (`MatrixService.signOut()`) runs the app's own
`logout()` first, which ends the Matrix device, clears the service worker's
realm tokens and asks the realm server to end the user's window sessions.
It then replaces the location with
`<secure origin>/sign-out#return=<app root>` (an app in a frame signs
out of its own session only, since the secure origin can't be framed), which forgets the
window's session, ends it on the server, and goes back to a listed `return`.

Links already sent keep working through the app: a reset link
(`?clientSecret=…#email=…&sid=…`) is replaced by the secure origin's
`reset-password` with all three in its fragment, and an older CLI's
`/cli-auth?port=&state=` by the secure origin's `cli-auth` page with the
same port and state.

## Refusals

| Status, code              | Means                                                                                                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 403 `forbidden`           | A sign-in not from the secure origin                                                                                                                                                                                       |
| 401 `invalid-credentials` | Any failed password sign-in (no account, no password, wrong)                                                                                                                                                               |
| 401 `signed-out`          | `GET /_secure-session`, `POST /_secure-session/login-token` or `POST /_secure-session/renewal` with a session that isn't, or is no longer, secure                                                                          |
| 429 `rate-limited`        | Too many failed password sign-ins for the account, or, from `POST /_secure-session/login-token`, a login token already minted for the user within the minute (the Matrix server's limit); see `meta.retryAfterMs`          |
| 401 `not-confirmed`       | Google's code didn't redeem, or its ID token didn't fit the sign-in                                                                                                                                                        |
| 403 `unverified-email`    | An unlinked Google account whose email Google hasn't verified                                                                                                                                                              |
| 403 `ambiguous-email`     | More than one account holds the unlinked Google account's email                                                                                                                                                            |
| 403 `deactivated`         | The Google account's account is deactivated                                                                                                                                                                                |
| 403 `locked`              | The Google account's account is locked                                                                                                                                                                                     |
| 403 `no-boxel-account`    | A session was asked for an account with no session room, which sign-in sets up first                                                                                                                                       |
| 409 `used`                | The proof already signed in                                                                                                                                                                                                |
| 503 `unavailable`         | No Synapse admin credentials, Synapse didn't answer with a challenge, or a Google sign-in couldn't make or link an account (its `realm:secure-session` log line counts the lost races and the localparts taken or refused) |
| 503 `google-unavailable`  | This server has no Google client                                                                                                                                                                                           |

A Google refusal's message is the app's own copy: `lib/google-account.ts`'s
words for an unverified or shared email, and the app's sign-in error for a
deactivated or locked account. Logged on `realm:secure-session` by error name and message only. The routes
are key routes in `request-telemetry.ts`, so request logs and Sentry keep only
their method and path, and no body is ever logged.

## Configuration

- `MATRIX_ADMIN_USERNAME` / `MATRIX_ADMIN_PASSWORD` on the realm server (the
  local default is `admin` / `password`); without them sign-in answers 503.
- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`: the Matrix server's
  Google client (SSM `synapse_google_oauth_client_id` /
  `synapse_google_oauth_client_secret`). Unset, the window offers only a
  password. `GOOGLE_OAUTH_ISSUER` points it at a stand-in provider in tests.
  The client's authorized redirect URIs must include each environment's
  `<secure origin shell>/google-callback`.
