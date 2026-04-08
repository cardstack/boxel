# Realm Server API

The Realm Server exposes HTTP endpoints for card operations, realm management, search, authentication, and administration.

## Base URL

```
http://localhost:4201  (development)
https://your-realm.boxel.ai  (production)
```

## Authentication

Most endpoints require a JWT token:

```
Authorization: Bearer <jwt-token>
```

Obtain a token via the session endpoint (see Authentication section below).

## Content Negotiation

The server uses `Accept` headers to determine response format:

| Accept Header | Response Format |
|---------------|----------------|
| `application/vnd.card+json` | JSON-API card document |
| `application/vnd.card+source` | Raw source code |
| `application/vnd.api+json` | Directory listing / realm info |
| `text/event-stream` | Server-Sent Events |
| `text/html` | Rendered HTML |
| `*/*` | Transpiled JavaScript module |

## Card Operations

### Read Card

```http
GET /{realm}/{card-path}
Accept: application/vnd.card+json
Authorization: Bearer <token>
```

**Response**: JSON-API document with card data.

### Create / Update Card

```http
PUT /{realm}/{card-path}
Accept: application/vnd.card+json
Content-Type: application/json
Authorization: Bearer <token>

{
  "data": {
    "type": "card",
    "attributes": { ... },
    "relationships": { ... },
    "meta": {
      "adoptsFrom": { "module": "./my-card", "name": "MyCard" }
    }
  }
}
```

### Delete Card

```http
DELETE /{realm}/{card-path}
Authorization: Bearer <token>
```

### List Directory

```http
GET /{realm}/{directory}/
Accept: application/vnd.api+json
Authorization: Bearer <token>
```

**Response**: JSON-API listing of files and subdirectories.

## Search

### Single Realm Search

```http
POST /{realm}/_search
Content-Type: application/json
Authorization: Bearer <token>

{
  "filter": {
    "type": { "module": "./blog-post", "name": "BlogPost" }
  },
  "sort": [{ "by": "title", "direction": "asc" }],
  "page": { "size": 25, "number": 0 }
}
```

### Federated Search (Multi-Realm)

```http
POST /_federated-search
Content-Type: application/json
Authorization: Bearer <token>

{
  "realms": [
    "https://realm-a.boxel.ai/",
    "https://realm-b.boxel.ai/"
  ],
  "filter": { ... },
  "sort": [ ... ],
  "page": { "size": 25 }
}
```

### Federated Realm Info

```http
GET /_federated-info
Authorization: Bearer <token>
```

Returns metadata for all accessible realms.

### Federated Type Info

```http
GET /_federated-types
Authorization: Bearer <token>
```

Returns card type definitions across all accessible realms.

### Prerendered Search

```http
POST /_federated-search-prerendered
Content-Type: application/json
Authorization: Bearer <token>

{
  "realms": [...],
  "filter": { ... },
  "htmlFormat": "fitted"
}
```

Returns prerendered HTML for search results.

## Realm Management

### Create Realm

```http
POST /_create-realm
Content-Type: application/json
Authorization: Bearer <token>

{
  "data": {
    "type": "realm",
    "attributes": {
      "endpoint": "my-workspace",
      "name": "My Workspace",
      "backgroundURL": "https://...",
      "iconURL": "https://..."
    }
  }
}
```

### Delete Realm

```http
DELETE /_delete-realm?realm={realm-path}
Authorization: Bearer <token>
```

### Publish Realm

```http
POST /_publish-realm
Content-Type: application/json
Authorization: Bearer <token>

{ "realmUrl": "https://my-realm.boxel.ai/" }
```

### Unpublish Realm

```http
POST /_unpublish-realm
Content-Type: application/json
Authorization: Bearer <token>

{ "realmUrl": "https://my-realm.boxel.ai/" }
```

### List Published Realms

```http
GET /_catalog-realms
Authorization: Bearer <token>
```

### Download Realm

```http
POST /_download-realm
Authorization: Bearer <token>

{ "realmUrl": "https://..." }
```

Returns the realm as a downloadable archive.

## Authentication

### Create Session

```http
POST /_server-session
Authorization: Bearer <matrix-access-token>
```

Creates a JWT session from a Matrix access token.

### Create User

```http
POST /_user
Content-Type: application/json
Authorization: Bearer <token>

{ "matrixUserId": "@alice:matrix.boxel.ai" }
```

### Get User Info

```http
GET /_user
Authorization: Bearer <token>
```

## Domain Management

### Check Domain Availability

```http
GET /_check-boxel-domain-availability?domain=my-site
```

### Claim Domain

```http
POST /_claim-boxel-domain
Content-Type: application/json
Authorization: Bearer <token>

{ "domain": "my-site", "realmUrl": "https://..." }
```

### Get Claimed Domain

```http
GET /_get-boxel-claimed-domain
Authorization: Bearer <token>
```

### Delete Claimed Domain

```http
DELETE /_delete-boxel-claimed-domain
Authorization: Bearer <token>
```

## Administration

### Trigger Reindex

```http
GET /_grafana-reindex?realm={realm-url}
```

### Queue Status

```http
GET /_queue-status
```

### Prerender Card

```http
POST /_prerender-card
Content-Type: application/json

{ "cardUrl": "https://...", "format": "isolated" }
```

## Billing

### Create Stripe Session

```http
POST /_stripe-session
Authorization: Bearer <token>
```

### Stripe Webhook

```http
POST /_stripe-webhook
```

## Webhooks & Bots

### Register Bot

```http
POST /_bot-registration
Content-Type: application/json
Authorization: Bearer <token>
```

### Register Webhook Command

```http
POST /_webhook-commands
Content-Type: application/json
Authorization: Bearer <token>
```

### Incoming Webhook

```http
POST /_incoming-webhook
Content-Type: application/json
```

## Real-Time Events

### Subscribe to Realm Events

```http
GET /{realm}?accept=text/event-stream
```

Returns a Server-Sent Events stream with realm changes:

```
event: update
data: {"type": "incremental", "url": "/blog/hello-world"}

event: update
data: {"type": "incremental", "url": "/blog/second-post"}
```

## Error Responses

All errors follow JSON-API error format:

```json
{
  "errors": [
    {
      "status": "404",
      "title": "Card Not Found",
      "detail": "No card exists at /blog/missing-post"
    }
  ]
}
```

## Next Steps

- [Card API](/api-reference/card-api) — Programmatic card operations
- [Query API](/api-reference/query-api) — Query syntax reference
- [Authentication](/architecture/auth-and-permissions) — Auth details
