---
name: local-host-against-remote
description: Running a local host app (`pnpm start` in `packages/host`) against staging or production — the env vars that point it at the environment, how signing in works from `localhost` (on the secure origin's sign-in page, which asks before handing a local page its sign-in), how the profile modal's password fields work there, why it works and what must never be changed to make it work, and how to diagnose a blank password frame. Use when an operator or developer wants a local host against staging or production, when sign-in from a local host fails, and before adding an origin to `--secureOriginAppOrigin` or anything that hands the secure origin an origin or URL. Triggers on "local host against staging", "run the host against production", "point my local host at staging", "password frame blank on localhost", "localhost sign-in", "sign in from localhost", "can't sign in locally to staging".
---

# A local host app against staging or production

A host app served from your own machine can talk to a deployed environment's realm server, Matrix server and secure origin, and sign in there as you would on the real app. The host is a static bundle whose environment URLs come from env vars at build time, so pointing it elsewhere is a matter of setting them before `pnpm start`.

**Production caution:** a local host against production uses real accounts and real data. Sign in with your own account, and never run tests, seed scripts or anything that writes in bulk against it.

## Pointing the host at the environment

From `packages/host`, in a shell where `BOXEL_ENVIRONMENT` is **not** set. That variable puts the host in env mode, which ignores `MATRIX_URL`, `ICONS_URL` and `SECURE_ORIGIN_URL` in favor of a local Traefik stack's hostnames, and points every variable left unset at that stack.

Staging:

```sh
unset BOXEL_ENVIRONMENT ENV_MODE
export REALM_SERVER_DOMAIN=https://realms-staging.stack.cards/
export RESOLVED_BASE_REALM_URL=https://realms-staging.stack.cards/base/
export RESOLVED_CATALOG_REALM_URL=https://realms-staging.stack.cards/catalog/
export RESOLVED_SKILLS_REALM_URL=https://realms-staging.stack.cards/skills/
export RESOLVED_OPENROUTER_REALM_URL=https://realms-staging.stack.cards/openrouter/
export RESOLVED_PRETUI_REALM_URL=https://realms-staging.stack.cards/pretui/
export MATRIX_URL=https://matrix-staging.stack.cards
export MATRIX_SERVER_NAME=stack.cards
export PUBLISHED_REALM_BOXEL_SPACE_DOMAIN=staging.boxel.dev
export PUBLISHED_REALM_BOXEL_SITE_DOMAIN=staging.boxel.build
export ICONS_URL=https://boxel-icons.boxel.ai
export SECURE_ORIGIN_URL=https://secure.stack.cards/
pnpm start
```

Production:

```sh
unset BOXEL_ENVIRONMENT ENV_MODE
export REALM_SERVER_DOMAIN=https://app.boxel.ai/
export RESOLVED_BASE_REALM_URL=https://app.boxel.ai/base/
export RESOLVED_CATALOG_REALM_URL=https://app.boxel.ai/catalog/
export RESOLVED_SKILLS_REALM_URL=https://app.boxel.ai/skills/
export RESOLVED_OPENROUTER_REALM_URL=https://app.boxel.ai/openrouter/
export RESOLVED_PRETUI_REALM_URL=https://app.boxel.ai/pretui/
export MATRIX_URL=https://matrix.boxel.ai
export MATRIX_SERVER_NAME=boxel.ai
export PUBLISHED_REALM_BOXEL_SPACE_DOMAIN=boxel.space
export PUBLISHED_REALM_BOXEL_SITE_DOMAIN=boxel.site
export ICONS_URL=https://boxel-icons.boxel.ai
export SECURE_ORIGIN_URL=https://secure.boxel.ai/
pnpm start
```

- The values are those in `packages/host/config/staging.env` and `production.env`, which the host PR previews build with, plus the pretui realm the env files leave to its default. When the two disagree, the env file is right. `packages/host/config/environment.js` is where each variable is read and what it defaults to; any variable left unset there points at the local dev stack (`https://localhost:4201/...`).
- `set -a; . config/staging.env; set +a` exports the env file as it stands, in place of the block above. Export `RESOLVED_PRETUI_REALM_URL` alongside it.
- Run the block in the same shell as `pnpm start`. The mise environment script (`mise-tasks/lib/env-vars.sh`) runs again whenever `pnpm` runs through mise. In standard mode it keeps a value already exported, but in a shell that is leaving env mode (`ENV_MODE=true`) it resets `SECURE_ORIGIN_URL`, `ICONS_URL` and the other service URLs to the local stack's. Unsetting `ENV_MODE`, as the blocks do, or starting from a fresh shell, keeps the values above.
- `pnpm start` serves on port 4200, over https when the local dev certificate exists (the usual case) and http otherwise. Nothing else may already be listening on 4200. In a shared checkout, that is often another session's dev server, so ask before taking it (see the `agent-peer-collaboration` skill).
- No local realm server, Matrix or test stack is needed: everything the page talks to is the environment's.

## Signing in

- **A signed-out local host sends you to the environment's secure origin** to sign in, with the page to come back to in the URL's fragment. Email and password, Google, registering and a password reset all happen there. The secure origin's `return` allowlist includes `http://localhost:*`, `https://localhost:*` and the same on `127.0.0.1`, so it hands the sign-in back to the local page.
- **The secure page asks "Continue to http://localhost:<port>?"** before it hands a loopback page its login token, since any program on your machine can listen on a loopback port. Continue only if you started the sign-in from that host.
- **Registering** on staging needs an invite code: its Synapse requires a registration token. Production's doesn't.
- **The profile modal's password fields** (change password, and confirming your password to change your email) are a frame from the environment's secure origin, which accepts those origins on any port (see below).

## Why it works, and what not to do

Two checks stand between a local page and the password frame, and both are deliberately satisfied:

1. **The frame's parameters ride in the URL fragment.** The host frames `credentials#form=<form>&origin=<page origin>` (`credentialFieldsURL` in `app/lib/credential-fields.ts`), and the frame reads them from `location.hash` (`packages/secure-origin/src/security/credentials.js`). A page that isn't on the user's machine passes them in the query as well, and the frame reads the query when the fragment names no form, so a host bundle that sends only the query and a secure origin that reads only the query each still work with the other side. The WAF in front of staging and production (AWS's managed rule `EC2MetaDataSSRF_QUERYARGUMENTS`) refuses any query string containing `localhost` or `127.0.0.1` with a 403. A fragment is never sent to the server, so no rule sees it.
2. **Loopback origins may frame the fields.** `scripts/start-staging.sh` and `scripts/start-production.sh` pass `--secureOriginAppOrigin` for `https://localhost:*`, `https://127.0.0.1:*`, `http://localhost:*` and `http://127.0.0.1:*`. A `:*` port stands for every port of the host, both in the credential page's `frame-ancestors` and in the frame's own check (`isListedOrigin` in `packages/secure-origin/src/security/app-origins.js`). No remote website can have a loopback origin, so these admit only a page served from the user's own machine. That is any page served there, on any port, not only the host app: the boundary is the machine, not the Boxel dev server.

So:

- **Never put `localhost` or `127.0.0.1` in a query string sent to the secure origin.** That covers an app origin, a return URL, a CLI callback, or any new parameter. It goes in the fragment, or another channel that isn't the query, or the WAF blocks every local host again.
- **Never add a non-loopback origin to production's list.** A password manager fills a saved production password into the credential fields wherever they are framed. A branch preview, a Railway deployment or a custom domain that needs the frame is added to staging's `--secureOriginAppOrigin` by name.
- Never widen an entry into a bare `*`, a scheme alone or a wildcard host: the realm server refuses them at startup (`appOrigin` in `lib/secure-origin.ts`), and the `secure-origin` skill explains why.

## Troubleshooting

**The password area of the profile modal's change-password or confirm-your-password form is blank.** The frame loaded nothing, or loaded and refused to start. Check, in this order:

1. **The WAF.** In the network panel, the request for `credentials` on the secure origin comes back 403. Something put a loopback origin in the query string; from a local host the frame URL must have no `?`.
2. **`frame-ancestors`.** The console reports that framing the secure origin violates its `frame-ancestors` directive. The page's origin isn't listed: a host on a hostname other than `localhost` / `127.0.0.1`, or a realm server whose `--secureOriginAppOrigin` doesn't list the loopback origins. Read the `Content-Security-Policy` response header on that same `credentials` request to see what is listed.
3. **The `origin` the frame was given.** The frame loads but stays empty, with no console error. It starts only when the `origin` in its fragment is a listed origin, the page is actually its parent, and `form` names a known form. Compare the fragment of the frame's `src` with `location.origin`.

**The secure origin can't be reached.** `SECURE_ORIGIN_URL` is unset or wrong, so the frame points at `https://localhost:4208/secure`, the local dev stack's secure origin, which isn't running. Restart `pnpm start` with the right value; the host reads it at build time.

**Requests to the realm server or Matrix fail with CORS errors.** The realm server answers every origin (`origin: '*'`), and Synapse allows cross-origin client requests. A CORS failure from a local host is almost always a request that never reached them: a 403 from the WAF (a loopback URL in a query string), an http page calling a URL that redirects, or a wrong URL in one of the variables above. Read the failing request's status and URL before suspecting either server.
