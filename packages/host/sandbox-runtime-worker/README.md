# Hosted Boxel Sandbox runtime

This Cloudflare Worker is the distinct-origin boundary for Boxel's hosted
Sandbox runtime:

- staging: `https://<32-lowercase-hex>.boxelusercontent.dev`
- production: `https://<32-lowercase-hex>.boxelusercontent.com`

Production PR previews temporarily use the `.dev` edge as well; that Worker
allows both preview-host domains. Production deployments remain configured for
`.com`. Remove the preview override in `.github/workflows/preview-host.yml`
after the `.com` wildcard DNS record is provisioned.

The Worker fetches the bootstrap document and content-addressed `/assets/`
graph from the exact allowed Host origin that created the iframe. It strips
credentials and cookies, rejects API/auth/service-worker paths, and applies a
restrictive CSP, referrer policy, permissions policy, and `nosniff`. Public
content-addressed Host assets carry CORS/CORP headers and an exact nonce-origin
CSP source so Safari and Firefox can load them from an opaque-origin
`sandbox="allow-scripts"` child. Chromium uses its stronger `credentialless`
mode on the same nonce origin.
The CSP deliberately permits Google Fonts stylesheets from the exact
`https://fonts.googleapis.com` origin and font binaries from the exact
`https://fonts.gstatic.com` origin. Other Google origins and resource types
remain blocked. This exception discloses the requested URL, client IP, and
user agent to Google; credentialless or opaque-origin isolation and
`Referrer-Policy: no-referrer` prevent usable cookies and the parent/card URL
from accompanying the request.

`/_realm-sandbox-frame` remains supported for the frozen
`codex/code-preview-instant-reload` preview. The current execution runtime uses
`/_boxel-sandbox-runtime`. Both paths share the same nonce-hostname and parent
origin validation.

Each zone needs an originless proxied wildcard DNS record so the Worker route
receives nonce subdomains:

```text
AAAA  *  100::  proxied
```

Deploy with Wrangler:

```sh
pnpm dlx wrangler@latest deploy \
  --config packages/host/sandbox-runtime-worker/wrangler.jsonc \
  --env staging

pnpm dlx wrangler@latest deploy \
  --config packages/host/sandbox-runtime-worker/wrangler.jsonc \
  --env production
```

Run the boundary tests with:

```sh
node --test packages/host/sandbox-runtime-worker/test/index-test.js
```
