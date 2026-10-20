---
name: secure-origin
description: What the secure origin (`secure.boxel.ai` / `secure.stack.cards`, `https://localhost:4208/secure` in development) serves, why nothing else may ever be served on it, and how it is wired — the realm-server gate that answers it ahead of all other routing, the dedicated development listener, its headers, and what is kept out of logs and Sentry. Use before adding a route, asset, mode or header to the secure origin; when wiring its hostname into a deployment; when a secure-origin request shows up in logs or Sentry; and when reviewing any change to `packages/realm-server/lib/secure-origin.ts`, `lib/secure-origin-telemetry.ts`, `packages/realm-server/secure-origin/`, or the credential fields the app frames from it (`credentials.js`, host `components/matrix/credential-fields.gts`, `lib/credential-fields.ts`) — the sign-in, registration, password-reset, change-password and confirm-your-password inputs. Triggers on `secureOriginURL`, `--securePort`, `SECURE_ORIGIN_URL`, `--secureOriginAppOrigin`, `listenSecureOrigin`, `CredentialFields`, "secure window", "page shell", "credential fields", "frame-ancestors".
---

# The secure origin

**The governing fact: the secure origin is exactly as safe as the least trusted thing it serves.** It exists so that a credential typed into it can't be read by card code. The browser's same-origin policy does the isolating: the app page, and every card evaluated in it, can't read another origin's document, keystrokes or form values. That guarantee is about the _origin_, not the page. One script served anywhere on the origin, from any path, can read every window open on it. So the origin serves the pages in `packages/realm-server/secure-origin/` — the shell, and the credential fields the app frames — and nothing else. No realm, card module, realm asset, host app bundle or third-party script, ever.

## What it serves

- **The shell**, at the path of the configured URL (`/` deployed, `/secure` in development): `index.html` with no inline script, its one entry point `shell.js`, the modes' scripts, `shell.css`, and boxel-ui's `variables.css`, `theme.css` and the app's typeface, read from boxel-ui as they are. `createSecureOrigin` builds a `routes` table of every path served, and the `SHELL_ASSETS` table names the files.
- **Modes** are added to `shell.js`'s `modes` table, keyed by the `mode` query parameter. Every mode is the same shell document, with the same headers. They are `sign-in` and `cli-sign-in` (`sign-in.js`), `register` and `verify-email`, where a registration email's link lands (`register.js`), and `forgot-password` and `reset-password`, where a reset email's link lands (`password-reset.js`); Google returns to `google-callback`, which serves the shell too. An unknown mode renders nothing.
- **The pages are the app's sign-in screens**, drawn and worded the same: `shell.css` mirrors the host's AuthContainer, Login, RegisterUser, ForgotPassword, AuthButton and AuthFormField and the boxel-ui components they use, over boxel-ui's own tokens, and `dom.js` builds the logo, Google's "G", the check mark and the spinner from boxel-ui's icon components' paths (`secure-origin-test.ts` checks the copies against boxel-ui's). A change to those components' styles or copy needs the same change here: the matrix suite's `secure-origin-pages.spec.ts` compares the app's sign-in, account creation and forgot-password pages with these, pixel for pixel, outside the app's password frame, whose fields it compares by position and computed style, and fails until the change is made here too.

- **The credential fields**, at `credentials` beneath the shell's path: `credentials.html`, its entry point `credentials.js` and `credentials.css` (`CREDENTIALS_ASSETS`), and the shell's typeface. See below.

Adding to it means adding a mode to `shell.js`, or a file to `SHELL_ASSETS` or `CREDENTIALS_ASSETS`. Each addition must be code this repo owns and reviews. Never add a proxy, a passthrough to realm routing, a CDN script, an analytics snippet or a host-app import.

## The credential fields the app frames

Every input a password is typed into — sign-in, the CLI sign-in page, registration, password reset, change password, and the change-email modal's "confirm your identity" — is a cross-origin frame of `credentials?form=<form>&origin=<app origin>`. Unlike the secure window, the frame is meant to be invisible: the user sees the app's own form.

- **Where a password goes is the realm server's, not the app's.** `createSecureOrigin` writes the Matrix server's URL (the realm server's `--matrixURL`) into the page's markup and names that origin alone in `connect-src`. The frame sends every request carrying a password there, itself. Nothing the app sends can change the destination, so card code driving the frame can't redirect a password.
- **Framed by the app's origins alone.** `frame-ancestors` names `--serverURL`'s origin plus each `--secureOriginAppOrigin` (the host dev server and the test runner in development; the staging host PR previews' `https://*.boxel-host-preview.stack.cards` on staging, and none in production, where a password manager would otherwise fill a saved production password into any branch's preview). An origin whose host starts with `*.` stands for every subdomain of the rest, in `frame-ancestors` and in the frame's own check alike. The same list is written into the page, and the frame talks only to a parent on one of those origins, checking each message's origin and that it comes from its parent window. The host checks the frame's messages with `isTrustedMessageOrigin` and the frame's window.
- **What crosses the boundary.** The app sends what isn't secret: theme values, a username, an interactive-auth dict without its password, its own access token (change password, change email), and "make this request". The frame sends back whether each field is filled in and valid (never what is in it), its height, and the Matrix server's response — which for sign-in is the session the app already keeps. Before it goes, a response is checked for any password typed into the frame.
- **Card code can still drive the frame.** It runs in the app page, so it can send the frame the same messages the app does, and the frame can't tell the two apart. It can't read a password or change where one goes, but it can choose the non-secret parts of a request the user's password then authorizes — for example, the email verification session `add-threepid` binds. Keep every parameter the app sends to what a request can't do harm with, and fix in `credentials.js` anything that decides what a password authorizes (as `set-password` fixes `logout_devices: true`).
- **Forms and requests are fixed in `credentials.js`.** Each form names its fields and the one request it may make; a request names its Matrix endpoint and the body it sends, taking from the app only the parts that aren't secret. A new form or field is added there and in the host's `CredentialForm` type, never by the app passing field definitions.
- **It looks like the app because the app styles it.** `credentials.css` mirrors boxel-ui's FieldContainer, Label and BoxelInput and the host's AuthFormField. Every `var(--…)` in it is resolved by the host component at the frame's position and sent over, so a theme or token change reaches the frame. A change to those components' own rules needs the same change in `credentials.css`. A layout that follows the space around it (the settings modal) sets `--credential-layout: narrow`.
- **A flow that re-sends the password keeps the frame mounted.** Registration and change-email retry their requests across several screens, so their forms stay mounted, hidden, until the flow ends. Unmounting the frame forgets the password.

## How a mode talks to the realm server and the Matrix server

A mode reads what it shows from the realm server, and sends what is typed there, never from or to the page that opened it. It does this with `fetch` to the realm server's own origin, cross-origin. The secure origin never serves realm-server endpoints itself: that would be the passthrough forbidden above.

Creating an account and resetting a password are Matrix requests the page makes itself (`matrix.js`): registration's user-interactive auth (the invite code where the Matrix server asks for one, and the email validation it polls for), the email validation links, and setting the new password. The shell's policy names exactly two origins besides its own in `connect-src`, the realm server's (`serverURL`) and the Matrix server's (`--matrixURL`), both from the realm server's configuration and both written into the page's markup, never a wildcard. The endpoints a mode calls answer CORS for the secure origin.

An email link that lands on a mode carries anything secret in its fragment, never its query string, because a load balancer's access log records query strings: `reset-password`'s client secret is in the fragment, and the Matrix server appends the validation session's id after it. The page reads them and takes them out of the address bar.

Submissions go through `fetch`, not a `<form action>`, so `form-action 'self'` stays as it is, but for the CLI's loopback hand-off.

- **Everything else is a 404**, on any method, with the same headers. A non-GET to the shell is a 405.

## Headers on every response

`secureOriginHeaders()` sets them, error responses included:

- `Content-Security-Policy: default-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`. There is no `unsafe-inline` and no `unsafe-eval`.
- `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin`, `Cache-Control: no-store`.
- `Cross-Origin-Opener-Policy: same-origin`. The page that opens a secure window keeps a handle to it. Same-origin policy stops that page reading the window, but not navigating it, so card code could swap the window for a look-alike partway through a flow. This policy cuts the handle: the opener sees the window as closed. It also cuts `postMessage` to the opener, which no mode uses. The app learns an outcome by asking the realm server again.
- No CORS headers: the gate runs before the realm-server's CORS middleware.

**Framing is per path, never per mode.** Every mode is one response, so relaxing framing on the shell would relax it for every mode, the key-entry window included. A document the app frames, such as the password forms, gets a path of its own and its own entry in `routes`. That entry's `headers` pass the app's origins in `frameAncestors`, which puts those origins in `frame-ancestors` and drops `X-Frame-Options`, since that header can't name an origin. An app origin may be a `*.` subdomain pattern the realm server is configured with, such as the staging host previews. Never pass a bare `*` or a scheme alone, and never relax the shell's route or the defaults.

## How requests reach it

- **Deployed:** the hostname has its own load balancer, which forwards everything on that host to the realm-server, keeping the `Host` header. `scripts/start-production.sh` and `scripts/start-staging.sh` pass `--secureOriginURL` (`https://secure.boxel.ai/`, `https://secure.stack.cards/`). Without that flag the realm-server treats the host like any other and serves the full app on it. A realm-server started anywhere the secure hostname reaches must carry the flag. `secureOriginGate` is the first middleware in `RealmServer#buildApp`. A request whose `Host` (or `:authority`) is the secure origin's host is answered there and never reaches CORS, request logging, the routes table or a realm. Keep it first.
- **Development:** `--securePort` opens a listener of its own (`RealmServer#listenSecureOrigin`) that serves only the secure origin, whatever `Host` it is sent. The listener is 4208 (`SECURE_PORT` and `SECURE_ORIGIN_URL` in `mise-tasks/lib/env-vars.sh`), on the dev realm-server that both `mise run dev` and the host test stack start. It is a different origin from the app (`localhost:4200`) and from the realm-server (`localhost:4201`), so isolation is real without DNS. In branch mode it is registered with Traefik as `realm-server-secure.<slug>.localhost`.
- The host reads the URL from `secureOriginURL` in its config: `SECURE_ORIGIN_URL` at build time, set for deployments in `packages/host/config/{staging,production}.env`.

The secure origin must never share a host with the realm-server, the host app or a published realm. Port 4201 would not do: it serves realm content and the host app.

## What is never recorded

- **Request logging** for the origin is its own: one `secure-origin <METHOD> <path>: <status>` line per request (logger `realm:secure-origin`). It records no query string, no headers and no body, because a ticket or a credential can travel in any of them. The realm-server's `realm:requests` logger never sees these requests. The `aws-access` skill shows how to find these lines and the load balancer's access logs in a deployed environment.
- **The load balancer's access log does record the query string.** So a ticket or anything secret travels in a request body, or in the URL fragment, which never leaves the browser. It never travels in the query string.
- **Sentry** records the body of any incoming request a handler reads. `scrubSecureOriginEvent` (installed in `instrument.ts` as `beforeSend` and `beforeSendTransaction`) reduces an event raised during a secure-origin request to its method and URL path. A host is covered once it is registered, which `createSecureOrigin` does.
- An error while answering is logged by message and turned into a 500 there and then. It is never rethrown to the app's error handler, which would report the request to Sentry.

## Checks

- `packages/realm-server/tests/secure-origin-test.ts`: the shell and its headers, 404s for realm, module, asset and server paths, the dedicated listener, and the telemetry scrub.
- `packages/realm-server/tests/secure-origin-test.ts` also covers the credential fields' route: `frame-ancestors`, `connect-src`, the Matrix URL and app origins written into the page, and their files.
- `packages/host/tests/integration/components/matrix/credential-fields-test.gts`: a real card rendered beside the sign-in form, and beside the change-password form, finds no password input in the page and can't read the frame.
- `packages/host/tests/unit/secure-origin-isolation-test.ts`: the secure origin is neither the app's origin nor the realm-server's, and a page on the app origin can't read a document loaded from it. It loads the shell in a frame, not a window. Once the opener policy cuts a window's handle, nothing can close that window, and it would keep focus for every test after it. `mise-tasks/test-services/host` doesn't report the stack ready until the shell answers.
