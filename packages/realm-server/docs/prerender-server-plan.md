# Prerender Server: Design and Test Plan

Date: 2025-09-15
Owner: Realm Server
Status: Draft

## Goal
Expose a simple HTTP service (similar to worker-manager) that:
- Provides a liveness endpoint.
- Provides a POST API to prerender a card using the existing prerender.ts#prerenderCard, but refactored to accept permissions directly (no DB lookups).
- Uses an env var for the secret seed used to mint JWTs for the prerender session.
- Returns a JSON:API compliant response.

## Summary
Create `packages/realm-server/prerender-server.ts` as a lightweight Koa server. It will:
- HEAD/GET `/` — liveness and readiness (mirror worker-manager conventions)
 - POST `/prerender` — JSON:API request body with `data.type: "prerender-request"` and `data.attributes: { url, userId, permissions }`
 - Use `REALM_SECRET_SEED` to mint per-realm JWTs.
 - Call a refactored `prerenderCard({ url, userId, secretSeed, permissions })` that no longer depends on a DB adapter.

## Scope of Changes
1) Refactor `packages/realm-server/prerender.ts`
- Remove `DBAdapter` argument and internal `fetchUserPermissions(...)` call.
 - Accept `permissions: { [realm: string]: ("read"|"write"|"realm-owner")[] }`.
- Keep puppeteer-based rendering and return type as-is.

2) Implement `packages/realm-server/prerender-server.ts`
- Koa app with:
  - `router.head('/')` -> livenessCheck middleware
  - `router.get('/')` -> return `{ ready: true }` JSON, 200
  - `router.post('/prerender')` -> validate JSON:API-like request, invoke `prerenderCard`, return JSON:API document with 201 Created
- Environment config:
  - Required: `REALM_SECRET_SEED`
  - Optional: `BOXEL_HOST_URL`, `BOXEL_SHOW_PRERENDER`, `CI`
  - Port via `--port` CLI arg (yargs), similar to worker-manager

3) Response shape
- JSON:API success:
  {
    "data": {
      "type": "prerender-result",
      "id": requested url
      "attributes": {
        "serialized": <prerender.serialized>,
        "searchDoc": <prerender.searchDoc>,
        "displayName": <prerender.displayName>,
        "types": <prerender.types>,
        "isolatedHTML": <...>,
        "atomHTML": <...>,
        "embeddedHTML": <...>,
        "fittedHTML": <...>,
        "iconHTML": <...>
      }
    }
  }
- JSON:API error:
  {
    "jsonapi": { "version": "1.0" },
    "errors": [ { ...CardErrorJSONAPI } ]
  }

4) Validation and errors
- Do not strictly enforce `Content-Type: application/vnd.api+json` (accept JSON from trusted callers). Accept both `application/json` and `application/vnd.api+json` without warnings.
- POST body (JSON:API):
  {
    "data": {
      "type": "prerender-request",
      "attributes": {
        "url": string,            // required
        "userId": string,         // required
        "permissions": {          // required (can be empty object)
          [realmUrl: string]: ("read"|"write"|"realm-owner")[]
        }
      }
    }
  }
- Return 400 for invalid/missing fields.
- On success, return 201 with JSON:API document; on render failure, return top-level `errors` with HTTP 500.

5) Testing
- Unit-ish test for `prerender.ts` refactor stays green with updated call signature: update `packages/realm-server/tests/prerendering-test.ts` to pass `permissionsByRealm` instead of `dbAdapter`.
 - Unit-ish test for `prerender.ts` refactor stays green with updated call signature: update `packages/realm-server/tests/prerendering-test.ts` to pass `permissions` instead of `dbAdapter`.
- New tests for `prerender-server.ts`:
  - Liveness endpoint returns 200 and `{ ready: true }`.
  - POST `/prerender` happy path renders card (use existing test realms + puppeteer install step); assert 201 Created, JSON:API structure; request uses JSON:API body with `type: prerender-request`; assert `meta.timing` includes `launchMs`, `renderMs`, and `totalMs`.
  - POST schema validation errors (missing url, missing permissions) -> 400.
  - Rendering error path -> JSON:API `errors` with status 500, confirm error passthrough.

6) CLI and startup
- `ts-node --transpileOnly prerender-server --port=<n>` style start script.
- Graceful shutdown on SIGINT/SIGTERM using server.close.

7) Security
- No DB access in this process; input is trusted by upstream caller. Consider optional HMAC auth header for the API (out of scope now).
- Limit puppeteer launch flags in CI (`--no-sandbox`).

## Open Questions (Yes/No)
1. Use `REALM_SECRET_SEED` env var for JWTs? If not, should we add `PRERENDER_SECRET_SEED`? (Default to `REALM_SECRET_SEED` if present.)
> YES
2. Should the liveness GET `/` return `{ ready: true }` always (no readiness gating), like a simple health probe? 
> YES
3. Should rendering failures respond with HTTP 500 and top-level JSON:API `errors` instead of embedding `error` inside `data`? 
> yes
4. Do we want the route path to be exactly `/prerender`? (Not namespaced.)
> yes
5. Is the POST body name `permissionsByRealm` acceptable? (Alternative: `permissions`.)
> I prefer "permissions"
6. Should we include an optional `show` flag to toggle `BOXEL_SHOW_PRERENDER` per request? (Default is env-only.)
> NO
7. Do we need basic auth or a shared secret header for this API now? (Otherwise, open on the port.)
> NO, this server will be running in a VPC with a security group that only permits requests originating from the same VPC for network ingress

## Implementation Steps
- [ ] Refactor `prerender.ts`: remove DBAdapter usage; accept `permissions` and use it to mint JWTs.
- [ ] Implement `prerender-server.ts` server with Koa, yargs, routes, and JSON:API responses.
- [ ] Update existing prerender tests to conform to new signature; ensure puppeteer install in hooks remains.
- [ ] Add new tests for server routes (liveness + POST) under `tests/`.
- [ ] Wire new npm script(s) if needed for local run; CI remains unchanged.

## JSON:API Examples
Request:
{
  "jsonapi": { "version": "1.0" },
  "data": {
    "type": "prerender-request",
    "attributes": {
      "url": "http://example.com/realm/123",
      "userId": "@user:matrix",
      "permissions": {
        "http://example.com/realm/": ["read", "write"],
        "http://example.org/other/": ["read"]
      }
    }
  }
}

Success:
{
  "jsonapi": { "version": "1.0" },
  "data": {
    "type": "prerender-result",
    "id": "http://example.com/realm/123",
    "attributes": { /* RenderResponse fields */ }
  },
  "meta": { "timing": { "launchMs": 250, "renderMs": 900, "totalMs": 1175 } }
}

Error:
{
  "jsonapi": { "version": "1.0" },
  "errors": [ { "status": 500, "id": "http://example.com/realm/2", "message": "..." } ]
}
