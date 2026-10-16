---
name: secure-session
description: Operate and diagnose sessions signed in on the secure origin — the `secureSession` claim on a realm-server session, the `secure_sessions` table behind it, how the secure window and `boxel keys sign-in` get one (a Matrix user-interactive auth check the realm server drives through `account/3pid/add`), and what it gates (minting key write tickets). Use when a user can't sign in to the secure window or the CLI's `boxel keys sign-in`, when a key write ticket is refused with "issued only to a session signed in on the secure origin", when reading `secure_sessions`, when Synapse's admin credentials or its SSO confirmation templates change, or when changing `lib/secure-session.ts`, `handlers/handle-secure-session.ts` or `secure-origin/sign-in.js`.
---

# Secure sessions (operators)

Card code runs in the app page, where it can read the user's realm-server
session and Matrix access token, and carry both out of the browser. So the
app's session can't authorize a change to a user's key. A **secure session**
can: a realm-server session signed in on the secure origin, which card code
can't reach. The code is `packages/realm-server/lib/secure-session.ts` and
`handlers/handle-secure-session.ts`; the window's side is
`secure-origin/session.js` and `secure-origin/sign-in.js`.

## The claim and what it gates

A secure session is a realm-server JWT with `user`, `sessionRoom` and
`secureSession`: the id of a `secure_sessions` row. It works anywhere the
user's session does, and additionally:

| Gate                       | Requires                                                                    |
| -------------------------- | --------------------------------------------------------------------------- |
| `POST /_key-write-tickets` | `isSecureSession`: the claim, naming a row of the token's user, not expired |

Minting also still requires the request's `Origin` to be the secure origin's
or absent (the CLI). Nothing else in the server puts `secureSession` in a
token: `createJWT` (realm-server sessions) and the realm session minter in
`jwt.ts` refuse claims that carry it, and `createSecureSessionJWT` is called
only from `lib/secure-session.ts` — `tests/secure-session-test.ts` asserts all
three.

## `secure_sessions`

| Column        | Holds                                                                  |
| ------------- | ---------------------------------------------------------------------- |
| `id`          | UUID the token's `secureSession` claim names                           |
| `user_id`     | Matrix user id                                                         |
| `client`      | `window` (the secure window's own session) or `cli` (`boxel keys`)     |
| `uia_session` | The Matrix UIA session the user completed; unique, so it signs in once |
| `created_at`  | `timestamptz`                                                          |
| `expires_at`  | Eight hours after sign-in (`SECURE_SESSION_TTL_SECONDS`)               |

Excluded from the SQLite schema dump and withheld from `readonly_role`.
Expired rows are swept as new sessions are made. To sign a user's secure
sessions out, delete their rows; revoking all of a user's sessions
(`isSessionRevoked`) ends these too.

## Signing in

A Matrix sign-in proves nothing here: any Matrix access token can mint a
login token for a fresh device (`login_via_existing_session` without UIA).
What card code can't produce is the user re-authenticating, so signing in is
a user-interactive auth check the realm server drives itself:

1. `POST /_secure-session/sign-in` (`attributes.{username, client}`): the
   server resolves the user (Matrix id, email via the admin threepid lookup,
   or a bare username), refuses someone with no session room (never signed in
   to Boxel), mints a token for them through Synapse's admin "log in as user"
   API, and posts `account/3pid/add` with a made-up validation session.
   Synapse answers 401 with a UIA session and its stages; the token is logged
   out at once. The response carries a signed `signIn` (a JWT under a key
   derived for this alone, so it never verifies as a session), the stages
   (`password`, `sso`) and, for `sso`, Synapse's fallback URL.
2. The user completes a stage: the window sends the password, or opens the
   fallback URL in a popup, where Synapse shows `sso_auth_confirm.html` and
   sends them to Google.
3. `POST /_secure-session` (`attributes.{signIn, password?}`) repeats the
   request under a fresh admin-minted token with the UIA session. Synapse
   runs it only once the stage is passed, and it then fails with
   `M_THREEPID_AUTH_FAILED` having changed nothing — that failure is the
   proof. The server records the row and answers with the session.

`account/3pid/add` is used because it never skips UIA for a recent sign-in
(unlike device deletion under `ui_auth.session_timeout`) and fails harmlessly
once auth passes.

Both routes answer only a request whose `Origin` is the secure origin's. The
CLI never calls them: `boxel keys sign-in` opens
`<secure origin>?mode=cli-sign-in&port=…&state=…`, and the window posts the
session (`secure_session`, `user_id`, `expires_at`, `state`) to
`http://127.0.0.1:<port>/callback`. The shell's CSP allows that form target,
and `connect-src` to the realm server, and nothing else off-origin.
`DELETE /_secure-session` signs a secure session out.

## Refusals

| Status, code           | Means                                                                   |
| ---------------------- | ----------------------------------------------------------------------- |
| 403 `forbidden`        | Start or complete not from the secure origin                            |
| 401 `unknown-user`     | No account matches the username or email                                |
| 403 `no-boxel-account` | The account has never signed in to Boxel (no session room)              |
| 403 `no-stage`         | Synapse offers no single-stage password or SSO flow for the account     |
| 401 `invalid-password` | The password stage failed                                               |
| 409 `pending`          | SSO not confirmed yet; the window polls this                            |
| 409 `used`             | The UIA session already signed in                                       |
| 401 `expired`          | The sign-in is older than ten minutes                                   |
| 401 `not-confirmed`    | Synapse answered the completion with something other than the proof     |
| 503 `unavailable`      | No Synapse admin credentials, or Synapse didn't answer with a challenge |

Logged on `realm:secure-session` by error name and message only. The routes
are key routes in `request-telemetry.ts`, so request logs and Sentry keep only
their method and path, and no body is ever logged.

## Dependencies

- `MATRIX_ADMIN_USERNAME` / `MATRIX_ADMIN_PASSWORD` on the realm server (the
  local default is `admin` / `password`); without them sign-in answers 503.
- Synapse's `sso_auth_confirm.html`, `sso_auth_success.html` and
  `sso_auth_bad_user.html` in `packages/matrix/support/synapse/templates/`.
  The confirm page shows Synapse's action description verbatim ("add a
  third-party identifier to your account") with Boxel's explanation, so a
  confirmation card code requests for something else still shows what it is.
  `sync-synapse-assets.yml` publishes them: staging on merge, production by
  running the workflow for `production`.
