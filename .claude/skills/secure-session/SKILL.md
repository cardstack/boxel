---
name: secure-session
description: Operate and diagnose sessions signed in on the secure origin — the `secureSession` claim on a realm-server session, the `secure_sessions` table behind it, how the secure window and `boxel keys sign-in` get one (a password checked by a Matrix user-interactive auth check the realm server drives through `account/3pid/add`, or the realm server's own Google sign-in returning to the secure origin), and what it gates (minting key write tickets). Use when a user can't sign in to the secure window or the CLI's `boxel keys sign-in`, when a key write ticket is refused with "issued only to a session signed in on the secure origin", when reading `secure_sessions`, when Synapse's admin credentials or the Google client change, when a password change or reset should have ended a secure session, or when changing `lib/secure-session.ts`, `lib/google-sign-in.ts`, `handlers/handle-secure-session.ts`, `secure-origin/sign-in.js`, `secure-origin/password-reset.js` or the credential fields' `set-password`.
---

# Secure sessions (operators)

A **secure session** is a realm-server session signed in on the secure
origin, which card code can't reach. Why key changes need one, and the rules
that keep it out of card code's reach, are ADR 005
(`docs/adr/005-authorize-key-changes-only-with-a-session-card-code-cant-reach.md`);
read it before changing what a secure session gates or how one signs in. The
code is `packages/realm-server/lib/secure-session.ts` and
`handlers/handle-secure-session.ts`; the window's side is
`secure-origin/session.js` and `secure-origin/sign-in.js`.

## The claim and what it gates

A secure session is a realm-server JWT with `user`, `sessionRoom` and
`secureSession`: the id of a `secure_sessions` row. It works anywhere the
user's session does, and additionally:

| Gate                       | Requires                                                                    |
| -------------------------- | --------------------------------------------------------------------------- |
| `POST /_key-write-tickets` | `isSecureSession`: the claim, naming a row of the token's user, not expired |
| `GET /_secure-session`     | The same; answers 204, or 401 `signed-out`                                  |

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

Excluded from the SQLite schema dump and withheld from `readonly_role`.
Signing out expires a row rather than deleting it, and rows are swept two
days after they expire, so a proof can't sign in again after its session
ends. To sign a user's secure sessions out, expire their rows; revoking all of
a user's sessions (`isSessionRevoked`) ends these too.

## What ends a secure session

| What                   | Route                                    | Ends                                                                |
| ---------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| Its seven days pass    | —                                        | That session                                                        |
| Signing out of it      | `DELETE /_secure-session` (the session)  | That session: `boxelSignOut()` in the window, `boxel keys sign-out` |
| Signing out of the app | `DELETE /_secure-sessions?client=window` | Every unexpired `window` row of the token's user                    |
| Changing the password  | `POST /_secure-sessions/password-change` | Every unexpired row of the account, `cli` included                  |
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

Every page that sets a password calls `POST
/_secure-sessions/password-change` (a `password-change` resource,
`attributes.{username, password}`) once Synapse has accepted the new
password. Those pages are the secure origin's `reset-password` page and the
credential fields' `set-password`, which the app's own reset and its
change-password use. `username` is any name a password sign-in takes: the
email address the reset link was sent to, or the Matrix id the app names in
`set-password`'s `account`. `password` is the new password. The realm server
checks the password exactly as a password sign-in does (`confirmPassword`),
under the same per-account limit (`withPasswordLimit`; one `SignInLimiter`
serves both routes), and then expires every unexpired row of the account. It
answers only the secure origin, with the sign-in refusals below, and 204
whether or not a row ended. Card code never sees the new password, so it
can't end the CLI's sessions this way (ADR 005 §1.6). The call is best
effort: the password stays changed when it fails, and a session signed in with
the old password then lasts until it expires. Whoever holds the old password
can keep the account's failure limit full to make it fail.
`endSessionsForNewPassword` in `secure-origin/session.js` (which the credential
fields import too) tries a 429 again, after `retryAfterMs`, for up to a
minute, but that only beats someone filling the limit by hand: a refused
attempt costs nothing and `retryAfterMs` says when the next one is free, so a
script that polls faster than the page takes every free attempt and keeps its
sessions for the week. Don't treat the retry as the defense, and don't drop
the limit on this route either: a caller holding a session would learn the
new password from their session ending. Closing the gap needs a proof that
doesn't share the sign-in limit. A password set any other way,
such as by an operator through Synapse's admin `reset_password`, ends no
secure session. To end them, expire the rows.

A reset link carries the email address it was sent to in its fragment, so
the page it lands on can name the account: `#clientSecret=…&email=…&sid=…` on
the secure origin, and `?clientSecret=…#email=…&sid=…` in the app (Synapse
appends the `sid` to the end of the link). A link without one still resets
the password, and ends no session.

The window checks its stored session with `GET /_secure-session` (204 while
it's live, 401 `signed-out` once it has ended) when it opens, and again when a
request it makes under the session is refused with a 403, which is how a key
write ticket refuses an ended session. An ended session is forgotten, and the
window shows "Sign in to Boxel" with no error. When the check gets no answer
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
with the new password.

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
again in N minutes." (`secure-origin/sign-in-copy.js`). Google sign-in has no
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
4. It resolves the Google identity to an account exactly as Synapse's sign-in
   for the app does with Boxel's OIDC mapping provider
   (`packages/matrix/support/synapse/modules/boxel_oidc_mapping_provider.py`):
   - **Linked by `sub`**: the account Synapse linked to the Google subject,
     `GET /_synapse/admin/v1/auth_providers/oidc-google/users/<sub>`. A
     deactivated or locked account is refused.
   - **Not linked**: the email must be verified. The account holding it
     (`GET /_synapse/admin/v1/threepid/email/users/<email>`, lowercased, and
     as Google spells it) gets the Google link added to its `external_ids`
     (`PUT /_synapse/admin/v2/users/<user>`, keeping its other links), and
     signs in. More than one account holding it is refused.
   - **No account**: a new one is made through the admin API, with the
     mapping provider's localpart (the email's local part, sanitized, then
     `alice1`, `alice2`… past taken ones), Google's `name` as its display
     name, the email as a third-party id, and the Google link. An empty `PUT`
     makes the account, and only its `201` means this sign-in owns it, so a
     taken localpart is never changed. A localpart is taken when an account
     has it ignoring case, as Synapse's registration compares it; the admin
     lookup matches only exactly, so a `M_USER_IN_USE` refusal of the `PUT`
     counts the localpart as taken and the next one is tried. A sign-in that fails after making the
     account unlinks and deactivates it, so the next one resolves again.

   The rules live in `lib/google-account.ts`; the two implementations share
   `test_google_sign_in_vectors.json`, which both
   `test_boxel_oidc_mapping_provider.py` and `tests/google-account-test.ts`
   run. Change both together.

5. An account with no session room gets the app's first-sign-in setup before
   the session is minted, as a password sign-in's does: the realm-server user and its first credit grant, a
   personal realm when its account data doesn't list the user's own
   (`<username>/personal/`; a realm shared with them doesn't count) (one already in
   `realm_registry` is recorded, not made again), and last the session
   room, so a sign-in that fails part way sets up again.

Both POSTs answer only a request whose `Origin` is the secure origin's. The
CLI never calls them: `boxel keys sign-in` opens
`<secure origin>?mode=cli-sign-in&port=…&state=…`, and the window posts the
session (`secure_session`, `user_id`, `expires_at`, `state`) to
`http://127.0.0.1:<port>/callback` (after a Google round trip too; the CLI's
port and state wait in session storage). A Google sign-in the user cancels
(`error=access_denied`) returns the window to the page it started from: the
`cli-sign-in` page for the same listener, or the window's own sign-in. A
Google sign-in that fails any other way shows the error, with Start again
pointing at that same page. The shell's CSP allows that form
target, and `connect-src` to the realm server and the Matrix server (ADR 005 §1.4).

## Refusals

| Status, code              | Means                                                                                                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 403 `forbidden`           | A sign-in not from the secure origin                                                                                                                                                                                       |
| 401 `invalid-credentials` | Any failed password sign-in (no account, no password, wrong)                                                                                                                                                               |
| 401 `signed-out`          | `GET /_secure-session` with a session that isn't, or is no longer, secure                                                                                                                                                  |
| 429 `rate-limited`        | Too many failed password sign-ins for the account; see `meta.retryAfterMs`                                                                                                                                                 |
| 401 `not-confirmed`       | Google's code didn't redeem, or its ID token didn't fit the sign-in                                                                                                                                                        |
| 403 `unverified-email`    | An unlinked Google account whose email Google hasn't verified                                                                                                                                                              |
| 403 `ambiguous-email`     | More than one account holds the unlinked Google account's email                                                                                                                                                            |
| 403 `deactivated`         | The Google account's account is deactivated                                                                                                                                                                                |
| 403 `locked`              | The Google account's account is locked                                                                                                                                                                                     |
| 403 `no-boxel-account`    | A session was asked for an account with no session room, which sign-in sets up first                                                                                                                                       |
| 409 `used`                | The proof already signed in                                                                                                                                                                                                |
| 503 `unavailable`         | No Synapse admin credentials, Synapse didn't answer with a challenge, or a Google sign-in couldn't make or link an account (its `realm:secure-session` log line counts the lost races and the localparts taken or refused) |
| 503 `google-unavailable`  | This server has no Google client                                                                                                                                                                                           |

A Google refusal's message is the app's own copy: the mapping provider's
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
