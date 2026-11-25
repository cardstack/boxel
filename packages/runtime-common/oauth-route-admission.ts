// The route-map check for OAuth access tokens (ADR 021 §1.3): whether a scope
// a verified caller holds admits the route its router selected. It is the one
// function every OAuth resource's controller calls right after the token
// lookup, on the realm server and in a realm alike, so it lives here, where
// both can import it. It reads only the scopes' route maps, the caller's
// scopes and the selected route, never the request, so how a token reached the
// server can't change what it admits.
//
// A leaf module: it imports only the MIME type list, so the realm server can
// use it without the runtime-common barrel.

import type { SupportedMimeType } from './supported-mime-type.ts';

export type OAuthRouteMethod =
  | 'GET'
  | 'HEAD'
  | 'QUERY'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE';

// A route a scope admits, named as its router registers it: the path is the
// registered pattern, never a pattern over URLs, and a controller matches the
// route its router selected, after any method override (ADR 021 §1.3). A realm
// route is named by its MIME type too, since realm routes share paths. The
// realm's fallback file and module serve, which answers whatever path and MIME
// type no router route claimed, is named with `path: '*'` and `mimeType: '*'`.
export type OAuthRoute =
  | { on: 'server'; method: OAuthRouteMethod; path: string }
  | {
      on: 'realm';
      method: OAuthRouteMethod;
      mimeType: SupportedMimeType | '*';
      path: string;
    };

export interface OAuthScope {
  name: string;
  // What consent says the scope lets the app do.
  description: string;
  // The short word Connected apps shows for it ("Read", "Change").
  label: string;
  // Whether consent marks it as one to think twice about.
  caution: boolean;
  // The routes a token holding this scope may reach. The provider never
  // reads these; the resource's controllers do.
  routes: readonly OAuthRoute[];
  // The most a realm lets a token holding this scope do, whatever its user
  // may (a ceiling, never a grant: the user's own permissions still decide).
  // A scope without one admits nothing in a realm, and no scope ever admits
  // administering one.
  realmPermission?: 'read' | 'write';
}

// The most a realm lets a caller holding `held` do: `write` if any held scope
// allows write, `read` if any allows read, and otherwise nothing.
export function realmPermissionCeiling(
  scopes: readonly OAuthScope[],
  held: readonly string[],
): 'read' | 'write' | undefined {
  let allowed = scopes
    .filter(({ name }) => held.includes(name))
    .map(({ realmPermission }) => realmPermission);
  return allowed.includes('write')
    ? 'write'
    : allowed.includes('read')
      ? 'read'
      : undefined;
}

// The route a request reached, as its router registered it, after any method
// override (§1.3). On the realm server a HEAD request reaches the GET route
// registered for its path. In a realm, `mimeType` names the route's MIME type,
// and a request that reached no router route (a capture or a hashed
// stylesheet, which dispatch on their path) has no selected route at all.
export type SelectedRoute =
  | { on?: 'server'; method: string; path: string }
  | { on: 'realm'; method: string; mimeType: string; path: string };

// Kept for the realm server's existing callers.
export type SelectedServerRoute = { method: string; path: string };

// Whether a scope the caller holds admits the route its router selected.
// When the caller is refused, `scopes` names the scopes that would admit the
// route, and is empty when none does.
export function admitsRoute(
  scopes: readonly OAuthScope[],
  caller: { scopes: readonly string[] },
  route: SelectedRoute,
): { admitted: true } | { admitted: false; scopes: string[] } {
  let admitting = scopes
    .filter((scope) => scope.routes.some((mapped) => matches(mapped, route)))
    .map(({ name }) => name);
  if (admitting.some((name) => caller.scopes.includes(name))) {
    return { admitted: true };
  }
  return { admitted: false, scopes: admitting };
}

function matches(mapped: OAuthRoute, route: SelectedRoute): boolean {
  let method = route.method.toUpperCase() as OAuthRouteMethod;
  if (route.on === 'realm') {
    return (
      mapped.on === 'realm' &&
      mapped.path === route.path &&
      mapped.mimeType === route.mimeType &&
      mapped.method === method
    );
  }
  if (mapped.on !== 'server' || mapped.path !== route.path) {
    return false;
  }
  return (
    mapped.method === method || (method === 'HEAD' && mapped.method === 'GET')
  );
}

// The scopes of a resource with only the routes a realm reaches, which the
// realm server hands each realm, since a realm can't read the registry
// (§1.3).
export function realmRouteScopes(scopes: readonly OAuthScope[]): OAuthScope[] {
  return scopes.map((scope) => ({
    ...scope,
    routes: scope.routes.filter(({ on }) => on === 'realm'),
  }));
}

// Whether a bearer token is an OAuth access token rather than one of Boxel's
// session JWTs. A JWT is three base64url segments joined by dots; the
// provider's access tokens are opaque base64url values with no dot. Anything
// that isn't JWT-shaped is looked up as an OAuth token, so a malformed value
// meets the lookup's refusal, not a JWT parser's.
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
export function isOAuthAccessTokenShaped(token: string): boolean {
  return token.length > 0 && !JWT_SHAPE.test(token);
}

// Who a valid OAuth access token speaks for (ADR 021 §1.5): exactly the user,
// the grant, the client, the token's scopes and when the grant was created,
// and nothing taken from the request. It never carries `secureSession`
// (§1.6), and it is never turned into a session token's claims.
export interface OAuthCaller {
  // The user's Matrix ID, the user a session token names.
  user: string;
  // The user's internal ID (`users.id`).
  userId: string;
  grantId: string;
  clientId: string;
  // The token's scopes that its grant still approves for the resource.
  scopes: readonly string[];
  // When the grant was created (its consent), in epoch seconds.
  grantCreatedAt: number;
}

export type OAuthLookupResult =
  | { ok: true; caller: OAuthCaller }
  | { ok: false; reason: string };

// What the realm server hands a realm so the realm can be one of a
// resource's controllers (§1.3, §1.5): the resource's identifier, its scopes
// with only their realm routes, the `WWW-Authenticate` challenge to answer a
// refusal with, and the shared lookup, which the realm calls at most once per
// request.
export interface RealmOAuthResource {
  resource: string;
  scopes: readonly OAuthScope[];
  challenge(options?: {
    error?: 'invalid_token' | 'insufficient_scope';
    scope?: string[];
  }): string;
  resolve(token: string): Promise<OAuthLookupResult>;
}
