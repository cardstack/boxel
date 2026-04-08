# Authentication & Permissions

Boxel uses a layered authentication system built on Matrix protocol for identity and JWT tokens for API authorization.

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Browser    │────►│ Realm Server │────►│   Matrix     │
│              │     │              │     │  (Synapse)   │
│  JWT token   │     │  JWT verify  │     │  Identity    │
│  in header   │     │  Permission  │     │  provider    │
│              │     │  check       │     │              │
└──────────────┘     └──────────────┘     └──────────────┘
```

## Authentication Flow

### 1. Matrix Login

Users authenticate against the Matrix Synapse server:

```
POST https://matrix.boxel.ai/_matrix/client/r0/login
{
  "type": "m.login.password",
  "user": "alice",
  "password": "..."
}
```

This returns a Matrix access token and user ID.

### 2. Session Creation

The Host App creates a realm server session:

```
POST /_server-session
Authorization: Bearer <matrix-access-token>
```

The realm server:
1. Validates the Matrix token against Synapse
2. Creates a JWT containing the user ID and session room
3. Returns the JWT to the client

### 3. API Authorization

Subsequent requests include the JWT:

```
GET /my-card
Authorization: Bearer <jwt-token>
Accept: application/vnd.card+json
```

## JWT Token Structure

```json
{
  "user": "@alice:matrix.boxel.ai",
  "sessionRoom": "!room123:matrix.boxel.ai",
  "iat": 1709827200,
  "exp": 1709913600
}
```

| Claim | Description |
|-------|-------------|
| `user` | Matrix user ID |
| `sessionRoom` | Matrix room for this session |
| `iat` | Issued at timestamp |
| `exp` | Expiration timestamp |

## Permission Model

### Realm Permissions

Access to realms is controlled by the `realm_user_permissions` table:

```sql
CREATE TABLE realm_user_permissions (
  realm_url    VARCHAR NOT NULL,
  username     VARCHAR NOT NULL,  -- Matrix user ID or '*'
  read         BOOLEAN DEFAULT FALSE,
  write        BOOLEAN DEFAULT FALSE,
  realm_owner  BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (realm_url, username)
);
```

### Permission Levels

| Level | Read | Write | Publish | Delete Realm |
|-------|------|-------|---------|-------------|
| **Public (`*`)** | Yes | No | No | No |
| **Reader** | Yes | No | No | No |
| **Writer** | Yes | Yes | No | No |
| **Owner** | Yes | Yes | Yes | Yes |

### Public Access

Setting `username = '*'` with `read = true` makes a realm readable by all authenticated users:

```sql
INSERT INTO realm_user_permissions (realm_url, username, read)
VALUES ('https://my-realm.boxel.ai/', '*', TRUE);
```

## Published Realms

Publishing creates a read-only copy accessible to everyone:

```sql
CREATE TABLE published_realms (
  id                 SERIAL PRIMARY KEY,
  owner_username     VARCHAR NOT NULL,
  source_realm_url   VARCHAR NOT NULL,
  published_realm_url VARCHAR NOT NULL,
  last_published_at  TIMESTAMP
);
```

Published realms are:
- Readable by all users (even without explicit permissions)
- Served with prerendered HTML for SEO
- Accessible via custom domains

## Multi-Realm Authorization

For federated queries across multiple realms, the `multi-realm-authorization` middleware:

1. Extracts the JWT token (or handles anonymous access)
2. For each realm in the query, checks:
   - Is the realm published?
   - Does the user have explicit `read` permission?
   - Does `*` have `read` permission?
3. Filters the query to only include accessible realms
4. Returns results from all authorized realms

```typescript
// Middleware flow
const token = ctx.state.token;  // JWT claims
const requestedRealms = ['realm-a', 'realm-b', 'realm-c'];

const authorized = await filterAuthorizedRealms(
  token?.user,  // undefined for anonymous
  requestedRealms
);
// authorized might be ['realm-a', 'realm-c'] if realm-b is private
```

## Custom Domain Claims

Users can claim custom `.boxel.site` domains for published realms:

```
POST /_claim-boxel-domain
{ "domain": "alice-portfolio", "realmUrl": "https://..." }

GET /_check-boxel-domain-availability
?domain=alice-portfolio

DELETE /_delete-boxel-claimed-domain
```

## Security Considerations

### JWT Secret

The `REALM_SERVER_SECRET_SEED` environment variable is used to derive JWT signing keys. This must be kept secret and consistent across server restarts.

### CORS

The realm server configures CORS to allow requests from the Host App origin. In development, all origins are allowed.

### Content Security

- Cards render in the Host App context
- Scoped CSS prevents style leakage
- The ESLint plugin enforces `position: fixed` restrictions
- Prerendered HTML is sanitized before serving

## Next Steps

- [System Overview](/architecture/system-overview) — Full architecture
- [Realm Server API](/api-reference/realm-server-api) — Auth endpoints
- [Matrix Integration](/ai-agents/matrix-integration) — Matrix details
