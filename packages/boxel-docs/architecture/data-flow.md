# Data Flow

This page traces data flow through the Boxel system for key operations.

## Card Read Flow

```
Browser                    Realm Server               PostgreSQL
  │                            │                          │
  │ GET /card/url              │                          │
  │ Accept: vnd.card+json      │                          │
  │ ─────────────────────────► │                          │
  │                            │ SELECT * FROM boxel_index│
  │                            │ WHERE url = '/card/url'  │
  │                            │ ────────────────────────►│
  │                            │                          │
  │                            │ ◄────── pristine_doc ────│
  │                            │                          │
  │ ◄── JSON-API response ──── │                          │
  │                            │                          │
  │ Loader imports card class  │                          │
  │ Deserialize into instance  │                          │
  │ Render with Glimmer        │                          │
```

## Card Write Flow

```
Browser                    Realm Server          File System      PostgreSQL
  │                            │                     │                │
  │ PUT /card/url              │                     │                │
  │ Body: JSON-API doc         │                     │                │
  │ ─────────────────────────► │                     │                │
  │                            │ Write .json file    │                │
  │                            │ ──────────────────► │                │
  │                            │                     │                │
  │                            │ Enqueue index job   │                │
  │                            │ ──────────────────────────────────► │
  │                            │                     │                │
  │                            │ Broadcast Matrix event              │
  │                            │ ─────────────────► (Matrix)         │
  │                            │                     │                │
  │ ◄── 200 OK ────────────── │                     │                │
  │                            │                     │                │
  │                     Worker picks up job          │                │
  │                            │                     │                │
  │                     Prerender HTML               │                │
  │                     (Puppeteer)                   │                │
  │                            │                     │                │
  │                     Write to boxel_index         │                │
  │                            │ ──────────────────────────────────► │
```

## Search Flow

```
Browser                    Realm Server               PostgreSQL
  │                            │                          │
  │ POST /_federated-search    │                          │
  │ Body: {                    │                          │
  │   realms: [...],           │                          │
  │   filter: {...}            │                          │
  │ }                          │                          │
  │ ─────────────────────────► │                          │
  │                            │                          │
  │                            │ Check permissions       │
  │                            │ for each realm           │
  │                            │ ────────────────────────►│
  │                            │ ◄───── allowed realms ───│
  │                            │                          │
  │                            │ Build SQL query          │
  │                            │ from filter DSL          │
  │                            │                          │
  │                            │ SELECT FROM boxel_index  │
  │                            │ WHERE search_doc @> ... │
  │                            │ AND realm_url IN (...)   │
  │                            │ ORDER BY ...             │
  │                            │ ────────────────────────►│
  │                            │                          │
  │                            │ ◄───── matching cards ───│
  │                            │                          │
  │ ◄── JSON-API results ──── │                          │
```

## Authentication Flow

```
Browser                  Realm Server             Matrix/Synapse
  │                          │                         │
  │ Login request            │                         │
  │ ────────────────────────►│                         │
  │                          │ Create Matrix session   │
  │                          │ ───────────────────────►│
  │                          │ ◄──── session token ────│
  │                          │                         │
  │                          │ Create JWT              │
  │                          │ (user, sessionRoom)     │
  │ ◄── JWT token ──────────│                         │
  │                          │                         │
  │ Subsequent requests      │                         │
  │ Authorization: Bearer JWT│                         │
  │ ────────────────────────►│                         │
  │                          │ Verify JWT              │
  │                          │ Check realm permissions │
  │                          │                         │
```

## Real-Time Sync Flow

```
Client A               Realm Server              Matrix               Client B
  │                        │                       │                      │
  │ Save card              │                       │                      │
  │ ──────────────────────►│                       │                      │
  │                        │                       │                      │
  │                        │ Broadcast event       │                      │
  │                        │ ─────────────────────►│                      │
  │                        │                       │                      │
  │                        │                       │ Push event           │
  │                        │                       │ ────────────────────►│
  │                        │                       │                      │
  │                        │                       │              Receive event
  │                        │                       │              Invalidate cache
  │                        │                       │              Re-render card
```

## AI Interaction Flow

```
User                   Host App              Matrix Room            AI Bot              LLM
  │                      │                       │                    │                  │
  │ Type message         │                       │                    │                  │
  │ ────────────────────►│                       │                    │                  │
  │                      │ Send to Matrix        │                    │                  │
  │                      │ ─────────────────────►│                    │                  │
  │                      │                       │ Forward to bot     │                  │
  │                      │                       │ ──────────────────►│                  │
  │                      │                       │                    │                  │
  │                      │                       │                    │ Send prompt      │
  │                      │                       │                    │ ────────────────►│
  │                      │                       │                    │                  │
  │                      │                       │                    │ ◄── response ───│
  │                      │                       │                    │                  │
  │                      │                       │                    │ Execute commands │
  │                      │                       │                    │ (create/edit     │
  │                      │                       │                    │  cards via realm)│
  │                      │                       │                    │                  │
  │                      │                       │ ◄── response ─────│                  │
  │                      │                       │                    │                  │
  │                      │ ◄── Matrix event ─────│                    │                  │
  │                      │                       │                    │                  │
  │ ◄── Display response─│                       │                    │                  │
```

## Indexing Pipeline Flow

```
File Change → Realm Adapter
                 ↓
           Job Queue (PostgreSQL)
                 ↓
           Worker picks up job
                 ↓
    ┌────────────┴────────────┐
    │                         │
Card Definition          Card Instance
    │                         │
Parse exports            Load card class
Extract fields           Deserialize JSON
Build dep graph          Compute fields
    │                         │
    └────────────┬────────────┘
                 │
           Prerenderer
           (Puppeteer)
                 ↓
    ┌────────────┼────────────┐
    │            │            │
isolated    embedded       atom
  HTML        HTML         HTML
    │            │            │
    └────────────┼────────────┘
                 │
           IndexWriter
                 ↓
     PostgreSQL boxel_index
                 ↓
     Matrix broadcast event
```

## Next Steps

- [Authentication & Permissions](/architecture/auth-and-permissions) — Auth details
- [System Overview](/architecture/system-overview) — Component overview
- [Realm Server API](/api-reference/realm-server-api) — HTTP endpoints
