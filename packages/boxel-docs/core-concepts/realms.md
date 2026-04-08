# Realms

A **realm** is a URL-oriented repository that stores, indexes, and serves cards. Think of a realm as a workspace or namespace for your card definitions and instances.

## What is a Realm?

Every card lives in a realm. A realm provides:

- **File storage** — cards are stored as `.gts` (definitions) and `.json` (instances) files
- **Indexing** — cards are automatically indexed for fast search
- **HTTP serving** — cards are served via content negotiation
- **Real-time events** — changes are broadcast via Matrix
- **Permissions** — access control for read/write operations

```
https://my-realm.boxel.ai/
├── blog-post.gts           # Card definition
├── blog/
│   ├── hello-world.json    # Card instance
│   └── second-post.json    # Card instance
├── contact.gts             # Card definition
└── contacts/
    └── alice.json           # Card instance
```

## Realm URLs

Every realm has a unique URL that serves as its identifier:

```
http://localhost:4201/base/          # Base realm (core types)
http://localhost:4201/catalog/       # Catalog realm
http://localhost:4201/experiments/   # Experiments realm
https://my-workspace.boxel.ai/      # User realm
```

Cards within a realm are identified by their path relative to the realm URL:

```
https://my-realm.boxel.ai/blog/hello-world  → blog/hello-world.json
https://my-realm.boxel.ai/contact           → contact.gts
```

## Types of Realms

### Hosted Realms (Node.js)

The primary realm type, backed by a file system and PostgreSQL:

- Cards stored as files on disk
- Indexed in PostgreSQL for fast search
- Served via the Realm Server HTTP API
- Supports real-time subscriptions

### DOM Realms (Testing)

In-browser realms used for testing:

- Cards stored in memory
- Indexed in SQLite (WASM)
- Used by the test suite

## Content Negotiation

The realm server uses HTTP `Accept` headers to determine how to respond:

| Accept Header | Response | Use Case |
|---------------|----------|----------|
| `application/vnd.card+json` | JSON-API card document | Normal card consumption |
| `application/vnd.card+source` | Raw source code | Module editing |
| `application/vnd.api+json` | Directory listing / realm info | File browsing |
| `text/event-stream` | Server-Sent Events | Real-time subscriptions |
| `text/html` | Rendered HTML | Browser / prerendered content |
| `*/*` | Transpiled JavaScript module | Code execution |

### Example: Fetching a Card

```typescript
// Get card as JSON-API
const response = await fetch('https://my-realm.boxel.ai/blog/hello-world', {
  headers: { 'Accept': 'application/vnd.card+json' }
});
const card = await response.json();

// Get card source code
const source = await fetch('https://my-realm.boxel.ai/blog-post', {
  headers: { 'Accept': 'application/vnd.card+source' }
});
const code = await source.text();

// Subscribe to changes
const events = new EventSource('https://my-realm.boxel.ai/?accept=text/event-stream');
events.onmessage = (e) => console.log('Card changed:', e.data);
```

## Realm Operations

### Directory Listing

```
GET / (Accept: application/vnd.api+json)
```

Returns a JSON-API listing of all files and directories in the realm.

### Card CRUD

```
GET    /blog/post-1     → Read a card
PUT    /blog/post-1     → Create or update a card
DELETE /blog/post-1     → Delete a card
```

### Search

```
POST /_search
{
  "filter": {
    "type": { "module": "./blog-post", "name": "BlogPost" }
  },
  "sort": [{ "by": "title", "direction": "asc" }]
}
```

### Federated Search

Search across multiple realms simultaneously:

```
POST /_federated-search
{
  "realms": [
    "https://realm-a.boxel.ai/",
    "https://realm-b.boxel.ai/"
  ],
  "filter": { ... }
}
```

## Realm Metadata

Each realm has metadata including:

- **Name** — Human-readable name
- **Background URL** — Decorative background image
- **Icon URL** — Realm icon
- **Visibility** — Public or private

This metadata is stored in `realm_definition` in the database and can be configured via the `index.json` file at the realm root.

## Realm Lifecycle

```
Create Realm
    ↓
Initialize (create directory, index.json)
    ↓
Index from Scratch (walk all files, build index)
    ↓
Serve Requests
    ↓
Incremental Index (on file changes)
    ↓
Publish (make publicly accessible)
```

## Publishing

Realms can be published to make them publicly accessible:

```
POST /_publish-realm
```

Published realms:
- Are accessible to all authenticated users
- Get a public URL
- Support prerendered HTML for SEO
- Can claim custom domains

## Permissions

Realm access is controlled by the `realm_user_permissions` table:

| Permission | Description |
|------------|-------------|
| `read` | Can read card content |
| `write` | Can create, update, delete cards |
| `realm_owner` | Full control including publishing |

Special user `*` grants access to all authenticated users.

## Working with Realms Locally

### Creating a New Realm

Use the host app's workspace chooser to create a new realm, or use the API:

```
POST /_create-realm
{
  "data": {
    "type": "realm",
    "attributes": {
      "endpoint": "my-workspace",
      "name": "My Workspace"
    }
  }
}
```

### Syncing with Boxel CLI

```bash
# Pull remote realm to local
boxel pull my-workspace ./local-dir

# Push local changes to remote
boxel push ./local-dir my-workspace

# Sync interactively
boxel sync ./local-dir
```

## Built-in Realms

| Realm | URL Path | Purpose |
|-------|----------|---------|
| Base | `/base/` | Core card definitions (always loaded) |
| Catalog | `/catalog/` | Production card catalog |
| Experiments | `/experiments/` | Experimental features |
| Skills | `/skills/` | AI skill definitions |

## Next Steps

- [Indexing](/core-concepts/indexing) — How cards are indexed
- [Queries & Search](/core-concepts/queries-and-search) — Searching across realms
- [Realm Server API](/api-reference/realm-server-api) — Complete API reference
- [Authentication](/architecture/auth-and-permissions) — How auth works
