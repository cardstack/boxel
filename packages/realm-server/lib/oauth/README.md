# Boxel OAuth

The shared authorization service uses `oidc-provider` for discovery,
authorization codes, S256 PKCE, client registration, opaque access tokens,
rotated refresh tokens, revocation, and authenticated introspection. Boxel's
secure origin supplies sign-in, explicit consent, and connected-app management.
See ADR 007 for the boundaries and ADR 005 for secure sign-in.

## Configuration

`BOXEL_OAUTH_CONFIG` is secret JSON with this shape (example placeholders):

```json
{
  "cookieKeys": ["at-least-32-random-characters"],
  "jwks": {
    "keys": [
      { "kty": "RSA", "kid": "signing-key-id", "d": "private-JWK-fields" }
    ]
  },
  "allowedUsers": ["@person:matrix.example"],
  "resources": [
    {
      "resource": "https://mcp.example/mcp",
      "name": "Boxel MCP",
      "realms": ["https://realms.example/library/"],
      "introspectionClientId": "mcp-resource",
      "introspectionClientSecret": "at-least-32-random-characters"
    }
  ]
}
```

Real signing keys must be a complete private JWKS, generated once and persisted
in the deployment secret store. Cookie keys must also survive restarts. Each
resource has a distinct confidential introspection client. Publicly registered
OAuth clients cannot introspect tokens.

A realm-server with a configured secure origin enables OAuth when the setting
is present. The normal realm-server's existing database, sign-in dependencies,
and secrets-at-rest keyring are reused. OAuth grants never receive the
`secureSession` claim and do not authorize managing keys or sharing credentials.

For an explicitly configured remote public realm, include its exact root in
`publicRealms` as well as `realms`. Its own anonymous `_info` response must
identify that root and mark it public on every permission check. Private remote
realms cannot use this option. Locally managed realms use RealmPermissionChecker.

## Separate service

`oauth-main.ts` runs the same provider and secure sign-in code without mounting
cards, host code, indexers or workers. Build `oauth.Dockerfile` from the monorepo
root. Required settings:

- `BOXEL_OAUTH_ORIGIN`: the service's public HTTPS origin, with `/`.
- `BOXEL_OAUTH_CONFIG`: secret JSON above.
- `MATRIX_URL`, `MATRIX_ADMIN_USERNAME`, `MATRIX_ADMIN_PASSWORD`: the existing
  Boxel identity authority used by secure password sign-in.
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`: the Boxel
  account/permission database.
- `BOXEL_OAUTH_SESSION_SECRET`: a fresh private signing seed for this
  deployment's secure sign-in sessions. Do not copy the realm signing seed.
- Secrets-at-rest settings: the existing KMS configuration, or a dedicated
  `SECRETS_DATA_KEY` containing 32 random bytes in canonical base64, supplied
  by a managed secret store. The public development key is refused.
- `PORT`: listener port (default 3000).
- `BOXEL_OAUTH_MIGRATE=true`: apply only the additive secure-session and OAuth
  migrations under a separate `boxel_oauth_migrations` ledger. It does not run
  the realm/index migrations against an older deployment.

This entry point supports existing Boxel password accounts. Google sign-in is
available through the embedded realm-server provider when that server's Google
client is configured. The separate service does not infer or copy a Google client.

## Endpoints and client setup

Discovery is served at `/.well-known/oauth-authorization-server` and
`/.well-known/openid-configuration`. The issuer is the secure origin.

- `/oauth/authorize`, `/oauth/token`, `/oauth/register`, `/oauth/revoke`
- `/oauth/introspect`: HTTP Basic authentication by the resource's registered
  confidential client; checks audience, grant, global session revocation,
  current realm access, and the initial `allowedUsers` restriction.
- `/oauth/grants`: secure-session authenticated owner listing and withdrawal.
- `/?mode=connected-apps`: the user's secure management page.
- `/health`: readiness on the dedicated service.

Access tokens last five minutes, codes one minute, and interactions ten minutes.
Provider state is sealed in `oauth_objects`; permission grants are in
`oauth_grants`. Both tables are withheld from the read-only database roles.
The sealed-artifact registry includes OAuth in key census and rotation.

MCP resource servers publish Protected Resource Metadata identifying this
issuer. They validate every request through introspection, compare the exact
resource audience and allowed subject, and partition persisted user choices.
They return 401 challenges for missing/invalid authorization and never fall
back to anonymous access on a provider outage. `boxel:read` authorizes data
reads; `boxel:choices` authorizes saved chooser/preferences state, not realm writes.
