# Indexing

Boxel's indexing system builds a searchable catalog of all cards in a realm. It extracts card data, computes dependencies, and prerenders HTML — enabling fast search, type resolution, and SEO.

## How Indexing Works

```
Files in Realm
      ↓
  IndexRunner walks files
      ↓
  Parses .gts (definitions) and .json (instances)
      ↓
  Prerenderer renders HTML via headless Chrome
      ↓
  IndexWriter stores in PostgreSQL
      ↓
  Cards are searchable
```

## Components

| Component | Role |
|-----------|------|
| **Worker** | Processes indexing jobs from the queue |
| **IndexRunner** | Walks realm files and coordinates indexing |
| **Prerenderer** | Renders cards to HTML using Puppeteer |
| **IndexWriter** | Writes index entries to PostgreSQL |

## Index Types

### From-Scratch Indexing

A full reindex of all files in a realm:

1. Walk every file in the realm directory
2. Parse card definitions and instances
3. Render each card in headless Chrome
4. Write all entries to the `boxel_index` table
5. Store the realm version

**Triggered by:**
- Server startup
- Manual reindex (`/_grafana-reindex`)
- Realm creation

### Incremental Indexing

Updates only changed files:

1. Detect which files changed (via Matrix events or file watcher)
2. Determine affected cards (including reverse dependencies)
3. Re-render only affected cards
4. Update index entries

**Triggered by:**
- File saves in the realm
- Real-time Matrix events
- File system watcher (development mode)

## What Gets Indexed

For each card, the indexer stores:

| Artifact | Column | Purpose |
|----------|--------|---------|
| **Pristine document** | `pristine_doc` | Full JSON-API document |
| **Search document** | `search_doc` | Flattened JSONB for queries |
| **Isolated HTML** | `isolated_html` | Full-page rendered HTML |
| **Atom HTML** | `atom_html` | Minimal chip HTML |
| **Fitted HTML** | `fitted_html` | Adaptive layout HTML |
| **Embedded HTML** | `embedded_html` | Compact preview HTML |
| **Dependencies** | `deps` | Module/card dependencies |
| **Types** | `types` | Adoption chain (all ancestor types) |
| **Display names** | `display_names` | Human-readable type names |
| **Error document** | `error_doc` | Indexing errors (if any) |

## The Search Document

The `search_doc` is a flattened JSONB representation optimized for PostgreSQL queries:

```json
{
  "firstName": "Alice",
  "lastName": "Johnson",
  "fullName": "Alice Johnson",
  "company.name": "Acme Corp",
  "company.industry": "Technology"
}
```

Nested fields are flattened with dot notation, enabling queries like:
```sql
search_doc->>'company.name' = 'Acme Corp'
```

## Database Schema

### `boxel_index` Table

```sql
CREATE UNLOGGED TABLE boxel_index (
  url           TEXT NOT NULL,
  realm_version INTEGER NOT NULL,
  type          TEXT,             -- 'card' or 'instance'
  realm_url     TEXT,
  file_alias    TEXT,
  pristine_doc  JSONB,
  search_doc    JSONB,
  error_doc     JSONB,
  deps          TEXT[],
  types         TEXT[],
  display_names TEXT[],
  embedded_html TEXT,
  isolated_html TEXT,
  atom_html     TEXT,
  fitted_html   TEXT,
  indexed_at    BIGINT,
  is_deleted    BOOLEAN,
  PRIMARY KEY (url, realm_version)
);
```

### `realm_versions` Table

Tracks the current version for each realm:

```sql
CREATE UNLOGGED TABLE realm_versions (
  realm_url       TEXT PRIMARY KEY,
  current_version INTEGER
);
```

### `modules` Table

Caches compiled module definitions:

```sql
CREATE UNLOGGED TABLE modules (
  url          TEXT NOT NULL,
  cache_scope  TEXT NOT NULL,
  auth_user_id TEXT,
  definitions  JSONB,
  deps         TEXT[],
  error_doc    JSONB,
  PRIMARY KEY (url, cache_scope, auth_user_id)
);
```

## Prerendering

The prerenderer uses headless Chrome (Puppeteer) to render cards:

1. Load the card in a browser page
2. Render each format (isolated, embedded, atom, fitted)
3. Extract the HTML output
4. Store in the index

### Prerender Management

- **Page pool**: Each realm gets a pool of browser pages
- **LRU eviction**: Least-recently-used pages are recycled
- **Configurable count**: `PRERENDER_COUNT` controls server instances

## Job Queue

Indexing runs asynchronously through a PostgreSQL-backed job queue:

```sql
-- Jobs table
CREATE UNLOGGED TABLE jobs (
  id         SERIAL PRIMARY KEY,
  category   TEXT,          -- 'reindex-realm', 'search', etc.
  args       JSONB,
  status     TEXT,          -- 'unfulfilled', 'resolved', 'rejected'
  queue      TEXT,
  result     JSONB,
  created_at TIMESTAMP,
  finished_at TIMESTAMP
);
```

### Job Flow

```
Publish job → Queue picks up → Worker processes → Job resolved
```

Jobs are processed serially per queue name, with priority support:
- **High priority**: User-initiated operations
- **Normal priority**: Background indexing

### Coalescing

Duplicate jobs are coalesced — if a reindex job is already queued for a realm, additional requests are merged.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `FROM_SCRATCH_JOB_TIMEOUT_SEC` | `3600` | Max seconds for full reindex |
| `PRERENDER_COUNT` | `1` | Number of prerender server instances |
| `WORKER_HIGH_PRIORITY_COUNT` | `1` | High-priority worker count |
| `WORKER_ALL_PRIORITY_COUNT` | `1` | All-priority worker count |

## Monitoring

### Queue Status

```
GET /_queue-status
```

Returns current job queue state — pending, running, and completed jobs.

### Manual Reindex

```
GET /_grafana-reindex?realm=<realm-url>
```

Triggers a from-scratch reindex for a specific realm.

## Next Steps

- [Queries & Search](/core-concepts/queries-and-search) — Using the index
- [Realm Server API](/api-reference/realm-server-api) — Indexing endpoints
- [System Overview](/architecture/system-overview) — Where indexing fits
