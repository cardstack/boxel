---
status: proposed
date: 2026-10-19
scope:
  - packages/realm-server/lib/oauth/**
  - packages/realm-server/oauth-main.ts
  - packages/realm-server/secure-origin/oauth.js
  - packages/realm-server/lib/secrets-at-rest/providers.ts
---

# 007. Authorize external clients through Boxel OAuth

Boxel owns one OAuth authorization service for external clients. It reuses
secure sign-in to approve grants, while each API checks the audience and the
current permissions of the person who approved access.

## 1. Decision

The key words "MUST", "MUST NOT", "SHOULD", and "MAY" in this document
are interpreted as described in BCP 14 (RFC 2119, RFC 8174).

### 1.1. Sign-in and consent

Creating a grant MUST require the secure session defined by ADR 005 §1.2.
Consent MUST run on the secure origin and name the client, return destination,
resource, scopes, and realms. A secure session MUST NOT be returned to an
OAuth client. The authorization service MUST bind an approval to the browser
interaction that requested it.

### 1.2. Grants and resources

The protocol implementation MUST require authorization code flow with S256
PKCE. Each grant MUST name one registered resource and selected realms. An
API MUST validate its token's audience and scopes. Effective realm access
MUST be the intersection of the approved grant and current realm permissions.
An explicitly registered remote public realm MAY be checked against its own
anonymous realm metadata; a private remote realm MUST NOT use that path.
An API MUST NOT treat an ordinary Boxel or Matrix session as an OAuth token.

### 1.3. Storage and withdrawal

Provider artifacts MUST use Boxel's secrets-at-rest envelope and persistent
storage. Concurrent exchanges MUST NOT consume the same code or refresh token
successfully. Revocation MUST prevent both resource access and refreshing.
Resource checks MUST honor user session revocation and current realm access.

### 1.4. Renewable consent

The provider MAY issue a refresh token when the client supports the refresh
flow and the user explicitly approves renewal on the secure consent screen.
This approval MAY be separate from an `offline_access` scope request.
Renewal MUST NOT add resource scopes or realms. Renewable grants MUST expire
within 30 days and MUST retain the revocation checks in §1.3. Existing grants
MUST NOT gain renewal permission without a new consent.

### 1.5. Deployment

The provider MAY run in the realm-server process or as a separate deployment
of the same implementation. Each deployment MUST have an isolated secure
origin. Non-AWS deployments MAY load a private data key from their managed
secret store; they MUST NOT use the public development key. Sharing a
privileged database account, Matrix admin credential, or signing seed with a
new deployment requires an explicit infrastructure authorization.

## 2. Rationale

External clients need limited, revocable access. An app session cannot prove
secure approval (ADR 005 §2), and putting an authorization server in every MCP
server would duplicate identity and permission rules. An established protocol
implementation handles OAuth, while Boxel remains responsible for consent
and realm authorization. A separate deployment supports existing hosting
without requiring an unrelated realm runtime upgrade.

## 3. Considered options

- **A shared issuer using secure Boxel sign-in (chosen).** Consent and grants
  have one implementation across APIs.
- **Independent OAuth providers in each MCP server.** This duplicates account
  and grant policy.
- **Exchanging an app or Matrix login token for durable external access.**
  Card code can acquire those tokens and cannot prove secure approval.
- **Longer access tokens or refresh tokens issued without renewal consent.**
  Both extend bearer access without addressing explicit, revocable renewal.
- **Requiring a Matrix authentication-service migration first.** This changes
  the identity infrastructure before external Boxel API access requires it.
