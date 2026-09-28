// Who may read and write the realm under test.
//
// A realm's write permission belongs to its owner, so a run driven by a second
// identity fails at that identity's first POST — which is why the harness
// could not produce two writers on one realm at all. The realm answers
// `GET`/`PATCH /_permissions` to its owner, so the grant is a request rather
// than the UI step the setup script used to leave behind.
//
// Two things here, used at opposite ends of a run:
//
//   * `readRealmPermissions` / `grantRealmPermissions` — what `setup-realm.ts`
//     calls once, as the owner, to put the other credential rows on the realm.
//     It reads before it writes so its output can say what changed: a re-run
//     against an already-granted realm is the common case, and "granted"
//     printed over a no-op reads as a fix having been applied.
//   * `realmPermissionsFor` — what `run-load.ts` calls per writer session
//     before the clock starts, so a missing grant is a refusal naming the fix
//     rather than a run that reports write errors for ten minutes.
//
// Same dependency budget as the rest of the harness: global `fetch` and
// `node:` built-ins.

import { Buffer } from 'node:buffer';

import type { Session } from './auth.ts';

// What the realm stores per user: `read`, `write`, `realm-owner`. `null`
// removes the user.
export type RealmPermission = 'read' | 'write' | 'realm-owner';
export type RealmPermissions = Record<string, RealmPermission[] | null>;

interface PermissionsDocument {
  data?: { attributes?: { permissions?: RealmPermissions } };
}

export async function readRealmPermissions({
  realmUrl,
  authorization,
}: {
  realmUrl: string;
  authorization: string;
}): Promise<RealmPermissions> {
  let response = await fetch(`${realmUrl}_permissions`, {
    headers: {
      Accept: 'application/vnd.api+json',
      Authorization: authorization,
    },
  });
  if (!response.ok) {
    // Only 403 implicates the session. This is the first call `grantAccess`
    // makes, so it is also what a mistyped `--grants-only --realm <url>`
    // produces — and that flag exists for a hand-typed URL on a box with no
    // checkout, which is exactly where a wrong URL is likely and a
    // misattributed cause is expensive.
    throw new Error(
      `GET ${realmUrl}_permissions → ${response.status}` +
        (response.status === 403
          ? `. Only the realm owner may read a realm's permissions, so this is ` +
            `usually the wrong session.`
          : response.status === 404
            ? `. No realm is served at that URL — check --realm.`
            : `.`),
    );
  }
  return (
    ((await response.json()) as PermissionsDocument).data?.attributes
      ?.permissions ?? {}
  );
}

// Grants are merged by the realm rather than replacing the set, so a call
// naming two users leaves everyone else's permissions alone.
//
// `realm-owner` can neither be granted nor modified through this endpoint —
// the realm refuses both — so this cannot hand anyone the realm. The owner is
// whoever `realm create` made the owner.
export async function grantRealmPermissions({
  realmUrl,
  authorization,
  grants,
}: {
  realmUrl: string;
  authorization: string;
  grants: RealmPermissions;
}): Promise<RealmPermissions> {
  let response = await fetch(`${realmUrl}_permissions`, {
    method: 'PATCH',
    headers: {
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      Authorization: authorization,
    },
    body: JSON.stringify({ data: { attributes: { permissions: grants } } }),
  });
  let text = await response.text();
  if (!response.ok) {
    throw new Error(
      `PATCH ${realmUrl}_permissions → ${response.status} ${text.slice(0, 200)}`,
    );
  }
  return (
    (JSON.parse(text) as PermissionsDocument).data?.attributes?.permissions ??
    {}
  );
}

// The permissions the realm itself put in this session's realm token, or
// `undefined` when they cannot be read from it.
//
// `_realm-auth` mints one JWT per realm the user can reach and states that
// user's permissions in its claims, so a session already carries the answer
// and no extra round trip is needed — which matters because the check runs per
// writer and the endpoint that would answer it directly is owner-only.
//
// The token is decoded, not verified: this reads back what the server said
// about the holder, and a caller lying to itself about its own permissions
// gets a 403 from the realm either way.
export function realmPermissionsFor(
  session: Session,
  realmUrl: string,
): RealmPermission[] | undefined {
  let bare = realmUrl.replace(/\/$/, '');
  let token =
    session.realmTokens?.[realmUrl] ??
    session.realmTokens?.[bare] ??
    session.realmTokens?.[`${bare}/`];
  if (!token) {
    // No realm entry at all: the user has no grant on this realm, which is a
    // definite answer rather than an unreadable one.
    return [];
  }
  let claims = decodeJwtClaims(token);
  let permissions = claims?.permissions;
  if (!Array.isArray(permissions)) {
    return undefined;
  }
  return permissions.filter(
    (p): p is RealmPermission =>
      p === 'read' || p === 'write' || p === 'realm-owner',
  );
}

// The claims of a JWT, without verifying it. Returns `undefined` for anything
// that is not a three-part token with a JSON payload — a token shape this
// harness does not recognise has to read as "cannot tell", never as "no
// permissions".
export function decodeJwtClaims(
  token: string,
): Record<string, unknown> | undefined {
  let jwt = token.replace(/^Bearer /, '');
  let parts = jwt.split('.');
  if (parts.length !== 3) {
    return undefined;
  }
  try {
    let json = Buffer.from(parts[1], 'base64url').toString('utf8');
    let claims = JSON.parse(json) as unknown;
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
      return undefined;
    }
    return claims as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

// The Matrix ID a localpart names on this deployment. The credential file
// carries localparts and realm permissions are keyed by full Matrix ID, so
// every grant passes through here.
export function matrixIdFor(username: string, matrixDomain: string): string {
  return username.startsWith('@') ? username : `@${username}:${matrixDomain}`;
}

// The Matrix server name, as the deployed environments spell it: the Matrix
// URL's hostname with a leading `matrix…` label stripped.
//
// `hostname` rather than `host`, because the port is not part of a Matrix
// server name. A local `http://localhost:8008` derives `@user:localhost`,
// which is what synapse actually issues; taking `host` produced
// `@user:localhost:8008`, an id no account has. Both entry points accept a
// `--matrix-domain` override for deployments this heuristic does not fit.
export function matrixDomainFor(matrixUrl: string): string {
  return new URL(matrixUrl).hostname.replace(/^matrix[^.]*\./, '');
}
