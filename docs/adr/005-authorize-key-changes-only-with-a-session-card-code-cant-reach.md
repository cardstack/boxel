---
status: proposed
date: 2026-10-17
scope:
  - packages/realm-server/lib/secure-origin.ts
  - packages/realm-server/lib/secure-session.ts
  - packages/realm-server/lib/google-sign-in.ts
  - packages/realm-server/lib/google-account.ts
  - packages/realm-server/lib/sign-in-limiter.ts
  - packages/realm-server/lib/key-shares.ts
  - packages/postgres/migrations/1792187770930_add-key-shares.js
  - packages/realm-server/handlers/realm-destruction-utils.ts
  - packages/realm-server/handlers/handle-secure-session.ts
  - packages/realm-server/handlers/handle-user-keys.ts
  - packages/realm-server/utils/jwt.ts
  - packages/secure-origin/**
  - packages/boxel-cli/src/commands/keys/**
  - packages/boxel-cli/src/lib/secure-session.ts
  - packages/host/app/services/realm-server.ts
  - packages/host/app/services/matrix-service.ts
  - packages/host/app/lib/secure-sign-in.ts
  - packages/host/app/utils/login-token.ts
  - packages/postgres/migrations/1793069013762_add-secure-sessions-app-device.js
  - packages/host/app/components/matrix/secure-sign-in.gts
---

# 005. Authorize changes to a user's keys only with a session that card code can't reach

Card code runs in the app page with the user's realm-server session and Matrix
access token, and it can carry both out of the browser. So the app's session
can't authorize what card code must not do, such as changing a user's keys.
Those operations need a secure session: one the secure window signs in for on
the secure origin, with the user's own credential, and keeps out of the app
page. This ADR records when an operation needs one, and the rules that keep it
out of card code's reach. The `secure-session` and `user-keys` skills cover
the mechanics.

## 1. Decision

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in BCP 14 (RFC 2119, RFC 8174) when,
and only when, they appear in all capitals, as shown here.

### 1.1. When an operation needs a secure session

An operation that changes a user's keys, or what their keys may be used for,
MUST require a secure session. Today that is minting a key write ticket. Any
other operation SHOULD require one when card code holding the app's session
could use it to do lasting harm the user can't see or undo. An operation the
app's session can already do SHOULD NOT move behind a secure session.

### 1.2. The claim

A secure session is a realm-server JWT whose `secureSession` claim names an
unexpired `secure_sessions` row of the token's user. Only
`createSecureSessionJWT` MAY put the claim in a token, and only
`lib/secure-session.ts` MAY call it. Every other token minter MUST refuse
claims that carry it.

### 1.3. Signing in

A secure session MUST be issued only for proof of the user's own credential,
presented on the secure origin: their password, or a Google sign-in that
returns to the secure origin. It MUST NOT be issued for anything card code can
get, including the app's realm-server session, a Matrix access token, or a
Matrix login token. The sign-in routes MUST answer only a request whose
`Origin` is the secure origin's. A proof MUST sign in at most once, including
after its session ends.

### 1.4. Keeping the session out of the app page

The secure window MUST keep its session only in the secure origin's own
storage, and MUST NOT send it to the app page. Secure-origin pages MUST be
served with `Cross-Origin-Opener-Policy: same-origin`, so the page that opens
one keeps no handle to it. Their CSP MUST let them connect only to their own
origin, the realm server and the Matrix server the realm server is configured
with, and submit forms only to their own origin and the CLI's loopback
listener.

### 1.5. The CLI

A client outside the browser MUST get its secure session from the secure
window, which posts it to the client's loopback listener. The CLI MUST NOT
call the sign-in routes itself.

### 1.6. Signing out, and changing a password

Signing out of the app MUST ask the realm server to end the user's secure
window sessions, so a user who signs out of Boxel is signed out of key
management too. The app page can't reach the window or its storage (§1.4), so
only the realm server can end them; the app asks under the outgoing account's
session, which the route MUST accept for a while after it expires. That
request MUST NOT delay or block the app's sign-out. The route that serves it
MAY take the app's session, since all it can do is end sessions; it MUST NOT
create, extend, read or list one, and MUST answer alike whether or not a
session ended. It SHOULD leave the CLI's sessions alone.

A page that changes a user's password MUST make the change through the realm
server, which sets it on the Matrix server and then ends every secure session
of the account, the CLI's included. The page MUST be on the secure origin. The
realm server MUST end the sessions only once the Matrix server has accepted
the change. A change made with an access token MUST end the sessions of the
token's account. A reset by email MUST end the sessions of the account the
page names by email address, and only once the new password checks out for
that account. That check MUST NOT be refused under the limit on failed
password sign-ins, and MUST be made at most once for each email validation
session. The route MUST answer only a request whose `Origin` is the secure
origin's, and MUST answer alike whether or not a session ended.

Once every Matrix login token minted before a change it made has expired, the
realm server MUST sign out every Matrix device of the account but the one that
made the change (every device, for a reset), and MUST end every realm-server
session of the account issued before then. It MUST end them once more when
every Matrix OpenID token requested before the sweep has expired. The sweep
and that revocation MUST still run when the realm server that scheduled them
stops before they are due.

A secure window whose session has ended MUST forget it. A sign-in page then
offers to sign in again. A key page MUST NOT: it offers no sign-in of its own,
as it offers no sign-out, and says to sign in to Boxel from the page that
opened it. The one sign-in is Boxel's own, which leaves the window its session
on the secure origin only on a deployment that signs users in there (§1.7),
so a key page never gathers a credential for a session of its own. A
deployment MUST NOT open a key page unless it signs users in on the secure
origin.

### 1.7. Signing in to the app on the secure origin

A deployment that signs users in on the secure origin MUST NOT have the app
draw a field that a credential is typed into for signing in. A signed-out app
MUST send the user to the secure origin's sign-in page instead, and it MUST
NOT navigate a frame it is shown in to do so.

The secure origin MUST hand the app only a single-use Matrix login token, and
MUST NOT hand it the secure session (§1.4). The token MUST travel only by a
top-level navigation to the page the app asked to come back to, in that
page's URL fragment, or to the CLI's loopback listener (§1.5); never by
`postMessage` or to an opener. The realm server MUST mint it only for a live
secure session, and only for a request whose `Origin` is the secure
origin's.

The page to come back to MUST travel to the secure origin in the URL's
fragment, never its query string. The secure origin MUST hand a token only to
a page on one of the app origins the realm server lists for the deployment.
It MUST ask the user to confirm a hand-off to a loopback origin, of either
scheme, which any program on the user's machine can listen on; the realm
server's own origin is exempt, since the realm server is configured with
it.

A login token is something card code can get (§1.3), so the session the app
redeems it for MUST NOT be a secure session. Signing out of the app SHOULD
also sign out on the secure origin, by a top-level navigation there once the
app's own sign-out has finished.

### 1.8. How long a window's session lasts

A secure window's session MAY last as long as the app session it handed a
sign-in to, by being renewed while the Matrix device that app session signed
in as exists. Only the realm server MAY choose that device: it MUST name the
device when it mints the hand-off's login token, under the window's own
session, and MUST NOT bind a session to a device named by anything the app
page sends. A renewal MUST be answered only for a request whose `Origin` is
the secure origin's, and MUST check that the device still exists. Ending a
window's session (§1.6) MUST also end its binding, so the device can't renew
it. The CLI's sessions MUST NOT be bound.

## 2. Rationale

Key write tickets were first minted only for a request from the secure origin
or with no `Origin`. That keeps key changes out of reach of code running in
the browser. It does not stop card code that carries the user's session out of
the browser, where a client can send any `Origin`, or none, and the server
can't tell it from the CLI [1]. Closing that gap needs a session card code
can't reach [1].

A Matrix sign-in can't provide one. Synapse lets any access token mint a login
token for a new device without user-interactive auth, so a session derived
from Matrix proves only that the caller had a token, which card code has [2].
What card code can't produce is the user's own credential, entered on a page
it can't script. The password check uses `account/3pid/add`, because Synapse
always runs user-interactive auth for it, and it changes nothing once auth
passes [2].

For Google, the realm server is its own OpenID Connect client, and Google
returns to the secure origin. Synapse's own SSO hands the session to whoever
started the sign-in, so a sign-in link that card code opens would sign in for
card code [2]. Reusing Synapse's Google client means existing users see no new
consent screen [2].

Secure-origin pages reach the Matrix server themselves to create an account
and to send a reset email, so the password and the invite code are typed
into, and sent from, the secure origin alone [3]. They set a new password
through the realm server, for the reason below. The realm server writes the
Matrix server's URL into the page from its own configuration, so card code
can't change where those requests go. The credential fields the app frames, on the
same origin and with the same storage, already connect to it [3].

Signing out of the app has to reach the secure window, or a session the user
believes ended keeps minting key write tickets for up to a week. Only the
server can reach it. Ending sessions grants nothing, so letting the app's
session, and with it card code, ask for that is harmless: the worst card code
can do is sign the user out of key management. Rows aren't tied to a browser,
so this ends the user's windows in every browser; the CLI usually runs on
another machine and is left signed in.

The request is best effort, so sign-out can't wait on it: when the realm
server can't be reached or fails, the user's secure window sessions stay
signed in until they expire, at most a week. The app's own session token is
refreshed on a timer that fires late on a slept laptop, so the route accepts
a session that expired no longer ago than a secure session lasts.

Card code can also call the route, as often as it likes, and so keep the
user's secure windows signed out, including when the user needs one to replace
a key they suspect is compromised. This is accepted: it is visible, since the
window asks the user to sign in again; it grants card code nothing; and the
CLI's session, which the route leaves alone, can still change keys. A rate
limit wouldn't stop it, since one call after each sign-in is enough.

A changed password has to end the account's secure sessions, the CLI's too.
A user who resets a leaked password needs that most: whoever signed in with
it holds a session that can change their keys for up to a week. The realm
server can't learn of the change from Synapse. No module callback runs when a
password is set, and the admin API shows nothing that changes with one, so
there is nothing to poll [4]. Every page that sets a password is on the
secure origin: the reset page, and the credential fields the app frames for
its own reset and change-password. So those pages send the change to the
realm server, which makes the Matrix request itself. Synapse accepting the
change is then the proof that the password changed, and nothing else has to
be checked against the account's limit on failed attempts. Whoever holds the
old password can keep that limit full with wrong guesses, and a refused
attempt costs them nothing, so any proof checked under it can be starved [5].

A change is made with the app's access token and the current password. Card
code holds the token but not the password, and Synapse checks the password,
so card code can't end the CLI's sessions this way. Nor can whoever holds
the old password make a change once the password has changed, whatever token
they hold, since Synapse asks for the current one.

A reset names no account to Synapse, which finds it from the validated
email, and doesn't say which it was. So the page names the account by the
email address the reset was sent to, which a reset link carries in its
fragment, and the realm server checks the new password against that account
before it ends anything. Without the check, a reset of an account someone
controls could end any other account's sessions. The check runs whatever the
sign-in limit says, which leaves a way to test guesses at another account's
password: reset an account you control to the guess while naming theirs, and
a session you hold of theirs ends if it was right. Synapse deletes a
validation session when a reset uses it [6], so each guess costs a reset
email to an account the guesser controls, which Synapse's own limits on
validation emails pace. A link that names no account still resets the
password, and ends no session. A password set outside Boxel, such as by an
operator through Synapse's admin API, ends no session.

Synapse signs out the account's other devices when its password changes, but
leaves the account's unused login tokens [7]. Any device of the account can
mint one without a password, and so can a secure session (§1.7), and a token
minted before the change signs in a new device after it. Synapse can't revoke
a login token, and a device records neither when nor how it signed in [7]. So
the realm server signs the account's devices out again once the token
lifetime has passed after it ends the secure sessions, by when every token
minted before then has expired. A device can mint a realm-server session that
lasts a week in those minutes, so the sweep ends the account's realm-server
sessions too; the kept device mints a new one with its Matrix token. A device
the sweep signs out can still hold a Matrix OpenID token, which buys a
realm-server session, belongs to no device, and lasts an hour [8], so the
realm server ends the account's sessions again once that hour has passed. The
sweep doesn't stop a device that hands itself on: one signed in with an old
token can mint another just before the sweep and redeem it after, again and
again [8]. Requiring the password to mint one would stop that, but would also
stop the secure origin's own hand-off (§1.7), which mints with an access token
the admin API made and has no password to give [8]. So the sweep ends a token
that was only redeemed, not one used to mint the next. The sweep also signs
out a device signed in with the new password in those minutes,
since nothing tells it apart, and the user signs in again. After a reset that
is the usual case, since the reset page offers to sign in straight away. It is
still the smaller cost: holding back sign-ins until the sweep would make every
sign-in after a reset wait minutes, and would still miss a device signed in
with the password directly on Synapse. The sweep is recorded in the database,
and every realm server looks for due ones each minute, because a deploy can
stop the realm server that recorded it within those minutes.

Signing in to the app on the secure origin (§1.7) closes what the
credential fields leave open. Those fields are invisible frames inside the
app's own form, so card code can draw a form that looks the same and the user
can't tell them apart; a full page on the secure origin gives the user an
address bar to check. One sign-in there also serves both the app and the
secure window, which otherwise sign in separately.

What reaches the app is a Matrix login token, not a session of the secure
origin's: card code can already mint the same kind of token from the app's
Matrix session (§1.3), so handing one over grants nothing card code couldn't
get, while the secure session never leaves its origin. The realm server asks
the Matrix server for it (`login/get_token`) with a token minted for the user
and logged out at once, so the Matrix server binds it to the user and honours
it once. It lasts the Matrix server's `token_timeout`, two minutes on every
deployment, which `boxel browse` shares. The Matrix server mints one per user
a minute, so a sign-in right after another waits for the next.

The token rides in the destination's fragment, as `return` does on the way
in, because a fragment never reaches a server: the realm server's request log
and the load balancer's access log both record query strings, and a firewall
in front of staging refuses a query string that names a loopback origin. A
top-level navigation carries it because the secure origin's pages cut their
opener (§1.4), so neither `postMessage` nor the opener is there to use. The
allowlist of app origins keeps the page from being an open redirect for
tokens. Of the listed origins, only a loopback one can be served by whatever
program happens to listen there, so only a hand-off to one is confirmed. An
already-signed-in window hands over to any other listed origin with no click,
as an app already signed in would show the user straight into the app.

A window's session lasts a week, but the app's can last much longer, and the
app comes back from the secure origin only when it signs in. Without
renewal, a user signed in to the app for over a week would find the key pages
signed out, and the only fix would be to sign out of the app and back in.
The app's Matrix device lives exactly as long as the app's session: signing
out of the app, switching accounts and changing the password each sign it
out. So the window's session follows that device (§1.8). The realm server
picks the device id when it mints the hand-off's token, and the app signs in
as that device when it redeems the token, before any card code loads. The
app page never reads, holds or extends the window's session (§1.4). Card code
could learn the device id, since it is the app's own device, but knowing it
gets card code nothing. The binding is fixed when the token is minted, and
signing out of the app ends the window's session and its binding together,
so bringing back a device with that id renews nothing. A token the app never
redeems names a device that doesn't exist, which renews nothing either.
Renewal asks the Matrix server about the device only in the session's last
day, so a window that is opened often asks about once a day. A window's
token expires with its row, and a renewal accepts an expired token, since
the row it names decides. The CLI's session stays a week: the CLI keeps it
beside a device of its own, and `boxel keys sign-in` signs it in again.

## 3. Considered options

- **A separate session, signed in on the secure origin (chosen).**
- **The app's session, gated by `Origin`.** This was the first step [1]. Card
  code can carry the session out of the browser, where `Origin` is whatever
  the caller sends.
- **A session derived from Matrix, such as a login token handed to the secure
  window.** Card code can mint the same token [2].
- **Device deletion as the password check.** Synapse skips user-interactive
  auth for a recent sign-in (`ui_auth.session_timeout`), so it doesn't always
  check the password [2].
- **Synapse's own Google SSO, returning to the secure window.** Whoever starts
  the sign-in collects the session [2].
- **Confirming the operation in the app page.** Card code can draw the same
  prompt and answer it.
- **Ending only the signing-out browser's window session.** Rows carry no
  browser binding, so it needs one recorded at sign-in and presented at
  sign-out; and a user who signs out expects to be signed out everywhere.
- **Ending the CLI's sessions too on app sign-out.** The CLI is usually on
  another machine, where signing out of a browser shouldn't reach;
  `boxel keys sign-out` ends it.
- **Learning of a password change from Synapse, through a module or an admin
  poll.** No module callback runs when a password is set, and the admin API
  shows nothing that changes with one [4]. A module would have to patch
  Synapse's password handler.
- **Tying each secure session to a Matrix access token that a password
  change logs out.** Card code holds the user's access token and can log all
  of the account's tokens out, which would end the CLI's sessions too. And the
  realm server would hold a live Matrix token for every session.
- **Letting the page change the password on Synapse itself, then proving the
  change to the realm server with the new password, under the limit on
  failed sign-ins.** Whoever holds the old password can keep the limit full,
  and the limit says exactly when its next attempt is free, so a script that
  polls faster than the page takes every attempt and keeps its sessions for
  the week [5].
- **The same, with no limit on failed attempts.** Whoever still holds a
  session learns from it ending that a guess at the new password was right.
  With no limit, that is a password oracle without a rate.
- **The same, under a limit of its own that only a live access token of the
  account can reach.** A secure session mints a Matrix login token
  (§1.7), so whoever holds one gets a fresh token after the change and can
  keep that limit full too.
- **Ending the secure sessions before Synapse sets a reset's password.** That
  stops a secure session minting a login token while the reset's own check
  runs, but not a token minted before the reset, by a secure session or by
  any device of the account [7].
- **Revoking the account's login tokens at the change.** Synapse has no API
  that revokes a login token [7].
- **Requiring the password to mint a login token**
  (`login_via_existing_session.require_ui_auth`). It would stop a swept
  device handing itself on, but the secure origin's hand-off (§1.7) mints
  with an access token the admin API made, which has no password to give,
  and Synapse exempts no such token [8].
- **Holding back login tokens for the account until its sweep has run.** A
  sign-in on the secure origin after a reset would then wait minutes for its
  hand-off, and a device signed in with the password directly on Synapse
  would still be swept.
- **Sparing the devices that signed in after the change.** A device records
  neither when nor how it signed in, so one signed in with an old login token
  can't be told apart [7].
- **Letting the app's session ask, as sign-out does.** Card code could then
  end the CLI's sessions. While card code keeps the windows signed out, the
  CLI is the only way left to replace a key.
- **Handing the app the secure session, or a session of its own minted by
  the realm server.** The secure session would then sit where card code reads
  it (§1.4). A realm-server session alone leaves the app with no Matrix
  device, which it needs.
- **Carrying the token by `postMessage` to the window that opened sign-in.**
  The secure origin's pages cut their opener, and a message names its target
  only by origin, which card code shares with the app.
- **Synapse's own SSO redirect, returning a token to the app.** It takes the
  user's credential on Synapse's pages, not the secure origin's, and the
  redirect target is whatever the request names.
- **The token in the app page's query string.** The realm server's request
  log and the load balancer's access log would both record a token that is
  live for two minutes.
- **Renewing a window's session each time the window uses it.** A user who
  doesn't open the key pages for a week would still find them signed out
  while the app stays signed in.
- **Renewing it when the app comes back from the secure origin with a login
  token.** That happens only when the app signs in, so it does nothing for
  an app that stays signed in.
- **Letting the app tell the realm server which device it signed in as.**
  Card code could then bind the window's session to a device it keeps
  signed in, which would let the app page extend that session (§1.4).
- **Confirming every hand-off, not only a loopback one.** Every sign-in
  would ask a question whose answer is always yes; the listed origins other
  than loopback are the deployment's own.

## 4. Sources

1. #6727 (`453102ff40`), sections "Key write tickets" and "What the gate does
   not stop".
2. #6776, its description and review thread, and
   `.claude/skills/secure-session/SKILL.md`.
3. #6861, its description and review thread, and
   `.claude/skills/secure-origin/SKILL.md`.
4. Synapse v1.126.0: `SetPasswordHandler.set_password` calls no module
   callback, and the admin API's user details
   (`/_synapse/admin/v2/users/<user>`) carry no password hash or change time.
5. #6866's review: with `SignInLimiter`'s clock, a script polling every 50 ms
   took all 10 attempts in a minute from a page retrying for that minute.
6. Synapse v1.126.0: `EmailIdentityAuthChecker._check_threepid` deletes the
   validation session once it has used it.
7. Synapse v1.126.0 and v1.163.0 alike: `SetPasswordHandler.set_password`
   deletes the account's devices and access tokens but not its `login_tokens`
   rows, and only an OIDC back-channel logout invalidates one
   (`invalidate_login_tokens_by_session_id`); the admin API's device list
   (`/_synapse/admin/v2/users/<user>/devices`) carries no creation time or
   sign-in method.
8. Synapse v1.126.0 and v1.163.0 alike: `IdTokenServlet` stores an OpenID
   token in `open_id_tokens` with no device and an hour's lifetime
   (`EXPIRES_MS`), and neither `set_password` nor `delete_devices` removes
   one; `LoginTokenRequestServlet` mints a login token for any signed-in
   device, one a minute per user, and asks for UI auth only when
   `login_via_existing_session.require_ui_auth` is on, then with no exemption
   for an access token the admin API made.

## 5. Remediation

- `packages/realm-server/lib/key-shares.ts` (`unshareKey`, `suspendShare`)
  breaks §1.1. Each changes what a key may be used for without a key write
  ticket.
- `packages/postgres/migrations/1792187770930_add-key-shares.js`
  (`key_shares_follow_permissions`) breaks §1.1. Restoring a user's write
  access to a realm resumes their suspended shares there, through a
  permissions change the app's session can make.
- `packages/realm-server/handlers/realm-destruction-utils.ts` breaks §1.1.
  Deleting a realm deletes its key shares without a secure session.
- `packages/realm-server/handlers/handle-secure-session.ts`
  (`handleGoogleSignInStart`) breaks §1.3. The Google sign-in start route
  answers a request from any `Origin`.
