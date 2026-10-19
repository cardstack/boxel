---
name: secure-session
description: Operate and diagnose sessions signed in on the secure origin — the `secureSession` claim on a realm-server session, the `secure_sessions` table behind it, how the secure window and `boxel keys sign-in` get one (a password checked by a Matrix user-interactive auth check the realm server drives through `account/3pid/add`, or the realm server's own Google sign-in returning to the secure origin), and what it gates (minting key write tickets). Use when a user can't sign in to the secure window or the CLI's `boxel keys sign-in`, when a key write ticket is refused with "issued only to a session signed in on the secure origin", when reading `secure_sessions`, when Synapse's admin credentials or the Google client change, or when changing `lib/secure-session.ts`, `lib/google-sign-in.ts`, `handlers/handle-secure-session.ts` or `secure-origin/sign-in.js`.
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
| `expires_at`    | Seven days after sign-in (`SECURE_SESSION_TTL_SECONDS`); signing out sets it to now                  |

Excluded from the SQLite schema dump and withheld from `readonly_role`.
Signing out expires a row rather than deleting it, and rows are swept two
days after they expire, so a proof can't sign in again after its session
ends. To sign a user's secure sessions out, expire their rows; revoking all of
a user's sessions (`isSessionRevoked`) ends these too.

## Signing in

Only the user's own credential, presented on the secure origin, signs in (ADR
005 §1.3).

**Password** — `POST /_secure-session` (`attributes.{username, password,
client}`), one request. The server resolves the account (Matrix id, email via
the admin threepid lookup, or a bare username), mints a token for it through
Synapse's admin "log in as user" API, posts `account/3pid/add` with a made-up
validation session, and completes the UIA password stage with the password.
Synapse runs the request only once the password is right, and it then fails
with `M_THREEPID_AUTH_FAILED` having changed nothing — that failure is the
proof. Both admin-minted tokens are logged out at once. A missing account, one that has never signed in to Boxel (no session room), one
with no password and a wrong password all answer the same `401
invalid-credentials`.

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
     deactivated account is refused.
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
     taken localpart is never changed.

   The rules live in `lib/google-account.ts`; the two implementations share
   `test_google_sign_in_vectors.json`, which both
   `test_boxel_oidc_mapping_provider.py` and `tests/google-account-test.ts`
   run. Change both together.

5. An account with no session room gets the app's first-sign-in setup before
   the session is minted: the realm-server user and its first credit grant, a
   personal realm when its account data lists none, and last the session
   room, so a sign-in that fails part way sets up again.

Both POSTs answer only a request whose `Origin` is the secure origin's. The
CLI never calls them: `boxel keys sign-in` opens
`<secure origin>?mode=cli-sign-in&port=…&state=…`, and the window posts the
session (`secure_session`, `user_id`, `expires_at`, `state`) to
`http://127.0.0.1:<port>/callback` (after a Google round trip too; the CLI's
port and state wait in session storage). The shell's CSP allows that form
target and `connect-src` to the realm server (ADR 005 §1.4). `DELETE /_secure-session` signs a secure session out.

## Refusals

| Status, code              | Means                                                                          |
| ------------------------- | ------------------------------------------------------------------------------ |
| 403 `forbidden`           | A sign-in not from the secure origin                                           |
| 401 `invalid-credentials` | Any failed password sign-in (no account, no Boxel account, no password, wrong) |
| 429 `rate-limited`        | Synapse's rate limit on failed attempts for the account                        |
| 401 `not-confirmed`       | Google's code didn't redeem, or its ID token didn't fit the sign-in            |
| 403 `unverified-email`    | An unlinked Google account whose email Google hasn't verified                  |
| 403 `ambiguous-email`     | More than one account holds the unlinked Google account's email                |
| 403 `deactivated`         | The Google account's account is deactivated                                    |
| 403 `no-boxel-account`    | A password sign-in's account has never signed in to Boxel (no session room)    |
| 409 `used`                | The proof already signed in                                                    |
| 503 `unavailable`         | No Synapse admin credentials, or Synapse didn't answer with a challenge        |
| 503 `google-unavailable`  | This server has no Google client                                               |

A Google refusal's message is the app's own copy: the mapping provider's
words for an unverified or shared email, and the app's sign-in error for a
deactivated account. Logged on `realm:secure-session` by error name and message only. The routes
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
