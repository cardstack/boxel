# Hosted sandbox renderer

This Cloudflare Worker is the staging iframe-renderer boundary for
`boxelusercontent.dev`.

Each iframe receives a fresh 128-bit hostname:

```text
https://<32-lowercase-hex>.boxelusercontent.dev/_realm-sandbox-frame
```

Using first-level nonce subdomains keeps the deployment within Cloudflare
Universal SSL coverage. The entire `.dev` zone is reserved for sandbox
renderers; it must never host login, realm, API, or other privileged endpoints.

The Worker:

- serves the Boxel build only through the renderer bootstrap route and its
  static assets;
- strips request credentials and response cookies;
- blocks auth service workers and API paths;
- denies renderer networking with CSP;
- restricts framing to staging, branch previews, and explicit local HTTPS
  development origins;
- accepts only random nonce hostnames.

The wildcard Worker route also requires this proxied DNS record:

```text
AAAA  *  100::  proxied
```

`100::` is Cloudflare's reserved originless placeholder. Requests are handled
by the Worker route and never reach it.

Deploy the current Host build with:

```sh
pnpm dlx wrangler@latest deploy \
  --config packages/host/sandbox-renderer-worker/wrangler.jsonc
```

Run the boundary tests with:

```sh
node --test packages/host/sandbox-renderer-worker/test/index-test.mjs
```
