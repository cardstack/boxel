---
status: proposed
date: 2026-10-17
scope:
  - packages/realm-server/lib/secure-origin.ts
  - packages/realm-server/lib/secure-session.ts
  - packages/realm-server/lib/google-sign-in.ts
  - packages/realm-server/lib/google-account.ts
  - packages/realm-server/lib/sign-in-limiter.ts
  - packages/realm-server/handlers/handle-secure-session.ts
  - packages/realm-server/handlers/handle-user-keys.ts
  - packages/realm-server/utils/jwt.ts
  - packages/realm-server/secure-origin/**
  - packages/boxel-cli/src/commands/keys/**
  - packages/boxel-cli/src/lib/secure-session.ts
  - packages/host/app/services/realm-server.ts
  - packages/host/app/services/matrix-service.ts
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

### 1.6. Signing out

Signing out of the app MUST ask the realm server to end the user's secure
window sessions, so a user who signs out of Boxel is signed out of key
management too. The app page can't reach the window or its storage (§1.4), so
only the realm server can end them; the app asks under the outgoing account's
session, which the route MUST accept for a while after it expires. That
request MUST NOT delay or block the app's sign-out. The route that serves it
MAY take the app's session, since all it can do is end sessions; it MUST NOT
create, extend, read or list one, and MUST answer alike whether or not a
session ended. It SHOULD leave the CLI's sessions alone.

A secure window whose session has ended MUST forget it and offer to sign in
again.

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
and to reset a password, so the password and the invite code are typed into,
and sent from, the secure origin alone [3]. The realm server writes the Matrix
server's URL into the page from its own configuration, so card code can't
change where those requests go. The credential fields the app frames, on the
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

## 4. Sources

1. #6727 (`453102ff40`), sections "Key write tickets" and "What the gate does
   not stop".
2. #6776, its description and review thread, and
   `.claude/skills/secure-session/SKILL.md`.
3. #6861, its description and review thread, and
   `.claude/skills/secure-origin/SKILL.md`.
