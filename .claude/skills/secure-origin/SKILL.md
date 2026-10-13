---
name: secure-origin
description: What the secure origin (`secure.boxel.ai` / `secure.stack.cards`, `https://localhost:4208/secure` in development) serves, why nothing else may ever be served on it, and how it is wired — the realm-server gate that answers it ahead of all other routing, the dedicated development listener, its headers, and what is kept out of logs and Sentry. Use before adding a route, asset, mode or header to the secure origin; when wiring its hostname into a deployment; when a secure-origin request shows up in logs or Sentry; and when reviewing any change to `packages/realm-server/lib/secure-origin.ts`, `lib/secure-origin-telemetry.ts` or `packages/realm-server/secure-origin/`. Triggers on `secureOriginURL`, `--securePort`, `SECURE_ORIGIN_URL`, `listenSecureOrigin`, "secure window", "page shell", "frame-ancestors".
---

# The secure origin

**The governing fact: the secure origin is exactly as safe as the least trusted thing it serves.** It exists so that a credential typed into it can't be read by card code. The browser's same-origin policy does the isolating: the app page, and every card evaluated in it, can't read another origin's document, keystrokes or form values. That guarantee is about the _origin_, not the page. One script served anywhere on the origin, from any path, can read every window open on it. So the origin serves the page shell in `packages/realm-server/secure-origin/` and nothing else. No realm, card module, realm asset, host app bundle or third-party script, ever.

## What it serves

- **The shell**, at the path of the configured URL (`/` deployed, `/secure` in development): `index.html` with no inline script, its one entry point `shell.js`, and `shell.css`. The `SHELL_ASSETS` table in `lib/secure-origin.ts` names every file served.
- **Modes** are added to `shell.js`'s `modes` table, keyed by the `mode` query parameter. A mode reads what it shows from the realm server, never from the page that opened it.
- **Everything else is a 404**, on any method, with the same headers. A non-GET to the shell is a 405.

Adding to it means adding a mode to `shell.js`, or a file to `SHELL_ASSETS`. Each addition must be code this repo owns and reviews. Never add a proxy, a passthrough to realm routing, a CDN script, an analytics snippet or a host-app import.

## Headers on every response

`secureOriginHeaders()` sets them, error responses included:

- `Content-Security-Policy: default-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`. There is no `unsafe-inline` and no `unsafe-eval`.
- `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin`, `Cache-Control: no-store`.
- No CORS headers: the gate runs before the realm-server's CORS middleware.

A route that the app frames (the password forms) passes the app's origin in `frameAncestors`, for that route only. That puts the one origin in `frame-ancestors` and drops `X-Frame-Options`, which can't name an origin. Never pass a wildcard, and never relax the default.

## How requests reach it

- **Deployed:** the hostname has its own load balancer, which forwards everything on that host to the realm-server, keeping the `Host` header. `scripts/start-production.sh` and `scripts/start-staging.sh` pass `--secureOriginURL` (`https://secure.boxel.ai/`, `https://secure.stack.cards/`). Without that flag the realm-server treats the host like any other and serves the full app on it. A realm-server started anywhere the secure hostname reaches must carry the flag. `secureOriginGate` is the first middleware in `RealmServer#buildApp`. A request whose `Host` (or `:authority`) is the secure origin's host is answered there and never reaches CORS, request logging, the routes table or a realm. Keep it first.
- **Development:** `--securePort` opens a listener of its own (`RealmServer#listenSecureOrigin`) that serves only the secure origin, whatever `Host` it is sent. The listener is 4208 for the dev stack and 4209 for the test-realms stack (`SECURE_PORT` / `SECURE_TEST_PORT` in `mise-tasks/lib/env-vars.sh`). It is a different origin from the app (`localhost:4200`) and from the realm-server (`localhost:4201`), so isolation is real without DNS. In branch mode it is registered with Traefik as `realm-server-secure.<slug>.localhost` (`realm-test-secure.<slug>.localhost` for the test stack).
- The host reads the URL from `secureOriginURL` in its config: `SECURE_ORIGIN_URL` at build time, set for deployments in `packages/host/config/{staging,production}.env`.

The secure origin must never share a host with the realm-server, the host app or a published realm. Port 4201 would not do: it serves realm content and the host app.

## What is never recorded

- **Request logging** for the origin is its own: method, path and status (`realm:secure-origin`). It records no query string, no headers and no body, because a ticket or a credential can travel in any of them. The realm-server's `realm:requests` logger never sees these requests.
- **Sentry** records the body of any incoming request a handler reads. `scrubSecureOriginEvent` (installed in `instrument.ts` as `beforeSend` and `beforeSendTransaction`) reduces an event raised during a secure-origin request to its method and URL path. A host is covered once it is registered, which `createSecureOrigin` does.
- An error while answering is logged by message and turned into a 500 there and then. It is never rethrown to the app's error handler, which would report the request to Sentry.

## Checks

- `packages/realm-server/tests/secure-origin-test.ts`: the shell and its headers, 404s for realm, module, asset and server paths, the dedicated listener, and the telemetry scrub.
- `packages/host/tests/unit/secure-origin-isolation-test.ts`: a page on the app origin can't read a window showing the shell. A window that failed to load is just as unreadable, and the page can't confirm the shell loaded: its `Cross-Origin-Resource-Policy` refuses the app even a no-cors fetch. So `mise-tasks/test-services/host` doesn't report the stack ready until the shell answers.
