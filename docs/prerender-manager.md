# Prerender Manager: Design and Plan

## Goals

- Orchestrate prerender requests across a cluster of prerender servers.
- Route requests to a server that already has a pooled page for the requested realm when possible (realm affinity / stickiness).
- Otherwise, round-robin across available servers.
- Support configurable multiplexing: up to N servers can concurrently serve the same realm.
- Keep app/server split for supertest usability (like the existing prerender server).
- Minimize implementation complexity by leveraging koa-proxies for HTTP proxying.

## Scope (MVP)

- Manager service (Koa app + HTTP server) with:
  - Registration API for prerender servers.
  - Proxy endpoint for `/prerender` that selects a target server.
  - Realm-to-server(s) mapping maintained in-memory with LRU eviction of stale mappings.
  - DELETE API for servers to indicate a realm is no longer pooled.
  - Health check endpoints.
- Prerender server updates:
  - Reads PRERENDER_MANAGER_URL (default http://localhost:4222) to register on startup.
  - Notifies manager on realm disposal.
- Tests: unit + integration with supertest (single module `packages/realm-server/tests/prerender-manager-test.ts`).

## Architecture

- Manager maintains:
  - `servers`: Map<serverId, { url, registeredAt, lastSeenAt, capacity, meta?, activeRealms: Set<realm> }>
    - `capacity` comes from prerender server registration (defaults to 4 to match PRERENDER_PAGE_POOL_SIZE).
    - `activeRealms.size` must not exceed `capacity` when assigning NEW realms to a server.
  - `realms`: Map<realm, Deque<serverId>> where deque has unique serverIds up to multiplex N (front is most recently used). Alternate form: Map<realm, Set+RR>
  - `rrPool`: Round-robin iterator of currently healthy servers for new realms, filtered by available capacity.
  - `lastAccessByRealm`: Map<realm, number> used to approximate usage recency. Updated on each successful proxy for that realm.
- Affinity routing:
  - If realm has servers assigned: route to next serverId in its deque (cycle within deque for load sharing up to N).
  - Else: pick next healthy server with available capacity via round-robin, assign to realm (and possibly additional servers if multiplex > 1 by pre-seeding on subsequent requests or organically).
  - Pressure mode (all servers at capacity): choose the server that currently owns the globally least-recently-used realm (based on `lastAccessByRealm`) and route to that server, letting its internal LRU decide what to evict.
- Liveness:
  - Health check each server periodically (HEAD / GET /) and drop if dead.
  - When server unregisters/stops responding, remove from `servers` and from all realm deques.
- Eviction flow:
  - Prerender server calls DELETE to manager when it disposes a realm; manager removes that serverId from the realm deque. If deque becomes empty, realm mapping is removed.
  - Manager also removes that realm from the server’s `activeRealms` set, freeing capacity.

## HTTP APIs (JSON:API flavored)

All request/response bodies are JSON; content type: `application/vnd.api+json` where practical.

### Manager APIs

- GET `/` → `{ ready: true }` (health)
- HEAD `/` → 200 (liveness)

- POST `/prerender-servers`
  - Request:
    ```json
    {
      "data": {
        "type": "prerender-server",
        "attributes": {
          "url": "http://127.0.0.1:4223",
          "capacity": 4,
          "meta": { "name": "srv-1" }
        }
      }
    }
    ```
  - Notes:
    - `capacity` is optional; if omitted the manager will treat capacity as the server's `PRERENDER_PAGE_POOL_SIZE` (default 4). Since the manager cannot read the server's env, if your pool size differs from 4 you MUST provide `capacity` explicitly.
  - `url` may be omitted in a single-VPC deployment: the manager will infer `http://<client-ip>:<PRERENDER_SERVER_DEFAULT_PORT>` from the TCP peer address and validate by calling `GET /` on the inferred URL. If validation fails, registration is rejected (400). You can also pass an override header `X-Prerender-Server-Url` when registering.
  - Response: 204 No Content (idempotent). The manager includes `X-Prerender-Server-Id` header so the registering server can persist its id for subsequent operations.

- DELETE `/prerender-servers` (optional graceful unregister; identity inferred from client IP or `X-Prerender-Server-Url`)
  - 204 No Content

- DELETE `/prerender-servers/realms/:encodedRealm` (identity inferred from client IP or `X-Prerender-Server-Url`)
  - Used by prerender servers to indicate a realm is no longer pooled.
  - 204 No Content

- POST `/prerender` (proxy)
  - Request body: identical to prerender server endpoint.
  - Manager chooses target server (preferring existing realm affinity; otherwise a server under capacity) and proxies the request using koa-proxies (preserve method/body/headers).
  - Response: transparently passes through upstream response and status.
  - Manager adds `x-boxel-prerender-target: <serverId>` and `x-boxel-prerender-realm: <realm>` headers in response.

### Prerender Server additions

- On startup: POST register → `POST ${PRERENDER_MANAGER_URL}/prerender-servers`
  - Include `capacity = PRERENDER_PAGE_POOL_SIZE` in attributes so the manager can honor per-server realm limits. If omitted, the manager will assume a default of 4.
  - In a single-VPC setup using the default port, you can omit `url` and let the manager infer it from the client IP and `PRERENDER_SERVER_DEFAULT_PORT`. If using a non-default port, send the explicit `url` or the `X-Prerender-Server-Url` header.
- The manager may include `X-Prerender-Server-Id` in the 204 registration response; this is optional and not required for later calls.
- On shutdown (best-effort): `DELETE /prerender-servers` (identity inferred)
- On realm eviction/disposal: `DELETE /prerender-servers/realms/:encodedRealm` (identity inferred)
- Accept new env var: `PRERENDER_MANAGER_URL` (default `http://localhost:4222`).

## Selection Algorithm

- Inputs: realm (string), multiplex (integer M ≥ 1), `servers` (healthy), `realms[realm]` deque.
- If `realms[realm]` exists and not empty: pop front and push back (rotate), select popped server.
- Else: select next healthy server from global RR iterator that has `activeRealms.size < capacity`; assign to realm deque; return it.
- Ensure deque length ≤ M and contains unique serverIds; if adding beyond M, drop LRU from back.
- If chosen server returns 5xx/timeout: try next server within the realm deque (up to M), otherwise fallback to global RR.
  - When selecting from global RR on fallback, still respect capacity where possible. If no server has available capacity, proceed to route to the next server anyway (server may evict another realm internally), but DO NOT increase `activeRealms` until we observe a successful request completion; upon success, add the realm to that server’s `activeRealms` and the realm deque. If the server later disposes this realm it will issue DELETE, which will also release capacity.
  - This approach prefers honoring capacity, but avoids hard 503s during spikes by letting the prerender server’s own LRU page pool manage evictions.

Pressure mode (all servers at capacity):

1. Compute candidate: among all servers, find the realm with the oldest `lastAccessByRealm` timestamp; select the server that currently owns that realm.
2. Route the request to that server (best-effort). Do not preemptively modify `activeRealms` for capacity accounting until success.
3. On successful proxy: update `lastAccessByRealm[newRealm] = now`, add new realm to server’s `activeRealms` (may temporarily exceed capacity until the prerender server evicts and notifies manager via DELETE), and update the realm deque mapping for affinity.
4. On DELETE notification(s) from the server, remove the evicted realm(s) to free capacity and rebalance mappings.

## Configuration

- Manager:
  - `PRERENDER_MANAGER_PORT` default: 4222
  - `PRERENDER_MULTIPLEX` default: 1
  - `PRERENDER_HEALTH_INTERVAL_MS` default: 10000
  - `PRERENDER_SERVER_TIMEOUT_MS` default: 30000 (proxy timeout)
  - `PRERENDER_SERVER_DEFAULT_PORT` default: 4223 — used to infer the prerender server URL on registration when `url` is not provided.
- Prerender Server:
  - `PRERENDER_MANAGER_URL` default: `http://localhost:4222`
  - `PRERENDER_PAGE_POOL_SIZE` already exists (max pages)

## Security

- VPC-only deployment: no auth headers; rely on network isolation and health checks.
- Ensure the manager is not publicly exposed outside the VPC.

## Error Handling

- Registration: 400 for invalid payload. Duplicate registrations return 204 (idempotent).
- Proxying: 503 if no healthy servers, 504 on upstream timeout, with JSON:API error shape.
- Realm delete: 204 even if mapping missing (idempotent).

## File Layout Changes (proposed)

- Rename existing prerender server files for clarity:
  - `packages/realm-server/prerender/app.ts` → `prerender-app.ts`
  - `packages/realm-server/prerender/server.ts` → `prerender-server.ts`
- New manager files:
  - `packages/realm-server/prerender/manager-app.ts`
  - `packages/realm-server/prerender/manager-server.ts`
  - `packages/realm-server/prerender/manager-types.ts` (ids, payloads)
  - Tests in `packages/realm-server/tests/prerender-manager-test.ts`

## Implementation Steps

1. Add manager app/server with routes above, in-memory store, RR iterator, and health polling.
2. Wire koa-proxies for POST `/prerender` with dynamic target selection and timeouts.
3. Add environment config and defaults.
4. Update prerender server:
   - Read `PRERENDER_MANAGER_URL`.
   - On start: register (`POST /prerender-servers`) and store `serverId` in memory.
   - On realm disposal (`Prerenderer.disposeRealm`): notify manager via DELETE.
   - On shutdown: best-effort unregister.
5. Add tests: unit + integration.
6. Update scripts/README.

## Tests

- Manager unit tests:
  - Selection logic with M=1 and M>1.
  - Realm eviction updates deque and frees server capacity.
  - RR fallback when no mapping respects capacity (prefers servers under capacity).
  - Behavior when all servers at capacity: manager routes using pressure-mode LRU and adds assignment only after success (no 503 due to capacity).
  - Server health down removes from mappings.
- Manager integration tests (supertest):
  - Health endpoints: `HEAD /` returns 200; `GET /` returns `{ ready: true }`.
  - Registration returns 204 (no content) and is idempotent.
  - Registration may set `X-Prerender-Server-Id` header (optional); deletes work without providing an id.
  - Registration URL inference: omit `url` and assert manager infers from client IP + default port; mock `GET /` validation succeeds.
  - Registration URL inference failure: mock inferred `GET /` fails → 400. Header override with `X-Prerender-Server-Url` succeeds.
  - Register two fake servers (Koa apps). Proxy requests and assert sticky routing by realm.
  - With multiplex=2 and per-server capacity=1, assert alternating across two servers for same realm without exceeding capacity.
  - Evict realm from one server → manager routes subsequent requests to remaining server.
  - Capacity honored: do not assign a third distinct realm to a server with capacity=2 when another server has capacity available.
  - No servers → 503.
  - Pressure mode: when all servers are at capacity, manager selects the server that owns the globally least-recently-used realm and routes to it; upon success, mapping updates and later DELETE from server frees capacity.
- Prerender server tests:
  - On startup, performs registration (mock manager).
  - On `disposeRealm`, calls manager `DELETE /prerender-servers/realms/:encodedRealm` (mock manager).

## Observability

- Logs: selection decisions, realm assignments, health status.
- Metrics (future): per-realm hit ratio, server utilization, proxy latencies.

## Decisions

- Manager assigns internal ids but does NOT require `serverId` for realm DELETEs or unregister; identity is inferred inside the VPC.
- No persistent state across manager restarts for MVP: no.
- Multiplex growth: organic.
- Failover within a single request: yes — try remaining servers in realm deque (up to M), then one global RR attempt.

