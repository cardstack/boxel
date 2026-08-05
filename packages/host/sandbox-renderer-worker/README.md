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

- fetches the renderer bootstrap from the exact allowed Host origin that
  created the iframe and proxies only that build's `/assets/` graph through
  the nonce origin, preventing parent/child protocol version skew;
- strips request credentials and response cookies;
- blocks auth service workers and API paths;
- permits only same-origin renderer-asset fetches with CSP (including the
  transpiler WASM bootstrap) and denies external renderer networking;
- hashes the exact inline boot shims found in the deployed Host document
  instead of allowing arbitrary inline scripts;
- restricts framing to staging, branch previews, and explicit local HTTPS
  development origins;
- accepts only random nonce hostnames.

The wildcard Worker route also requires this proxied DNS record:

```text
AAAA  *  100::  proxied
```

`100::` is Cloudflare's reserved originless placeholder. Requests are handled
by the Worker route and never reach it.

The Worker does not embed a Host build. Each validated bootstrap request is
fetched credentiallessly from its exact parent preview origin, and its Vite
asset URLs are rewritten into a nonce-origin proxy path. Deploying the Worker
therefore does not need to be synchronized with every branch-preview build.

```sh
pnpm dlx wrangler@latest deploy \
  --config packages/host/sandbox-renderer-worker/wrangler.jsonc
```

Run the boundary tests with:

```sh
node --test packages/host/sandbox-renderer-worker/test/index-test.mjs
```
