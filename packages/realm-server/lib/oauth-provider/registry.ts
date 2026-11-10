// The resources the OAuth provider issues tokens for. Each is an API named by
// one URL, the audience of its tokens. The list is code, so adding a resource
// is a reviewed change: every resource also needs a controller that checks
// its tokens. Each scope maps the routes it admits, and a controller refuses
// an OAuth token on any route its scopes don't map (ADR 021 §1.3). Tests add
// a resource of their own through the realm server's test-only option;
// nothing in production can.

import type { SupportedMimeType } from '@cardstack/runtime-common';

export type OAuthClientKinds =
  // Any client: one identified by a client ID metadata document, or one that
  // registers itself.
  | 'open'
  // Only the clients Boxel registers in code.
  | 'pre-registered';

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
// route its router selected, after any method override (ADR 021 §1.3).
export type OAuthRoute =
  | { on: 'server'; method: OAuthRouteMethod; path: string }
  | {
      on: 'realm';
      method: OAuthRouteMethod;
      mimeType: SupportedMimeType;
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
}

// A resource as declared, before the server's URL is known.
export interface OAuthResourceDefinition {
  // Appended to the issuer to make the resource's identifier. Empty for a
  // resource identified by the issuer itself.
  path: string;
  name: string;
  description: string;
  // One sentence consent shows, saying what a grant reaches.
  coverage: string;
  scopes: readonly OAuthScope[];
  clients: OAuthClientKinds;
}

export interface OAuthResource extends Omit<OAuthResourceDefinition, 'path'> {
  // The resource's URL: the `resource` a client asks for, and the audience
  // of its tokens. Clients compare it as a string, so it never ends in a
  // slash.
  id: string;
}

// `/mcp` is one route for every tool, so both scopes map it. Each tool names
// the scope it needs where it is defined, and `/mcp`'s controller checks that
// too.
const MCP_ROUTE: OAuthRoute = { on: 'server', method: 'POST', path: '/mcp' };

const MCP: OAuthResourceDefinition = {
  path: '/mcp',
  name: 'Boxel workspaces',
  description:
    'Lets the app find, read and change cards and files in your workspaces.',
  coverage:
    'This covers every workspace you can open, including shared ones and ones you create later.',
  scopes: [
    {
      name: 'boxel:read',
      description: 'See the cards and files in your workspaces.',
      label: 'Read',
      caution: false,
      routes: [MCP_ROUTE],
    },
    {
      name: 'boxel:write',
      description:
        'Create and change cards and files, create workspaces, and archive the ones you own.',
      label: 'Change',
      caution: true,
      routes: [MCP_ROUTE],
    },
  ],
  clients: 'open',
};

const RESOURCES: readonly OAuthResourceDefinition[] = [MCP];

// The issuer is the realm server's URL, which clients compare as a string
// with the one they derived it from, so it carries no trailing slash.
export function oauthIssuer(serverURL: URL | string): string {
  return String(serverURL).replace(/\/+$/, '');
}

// The registry is frozen, all the way down, since it must not change while
// the server runs (ADR 021 §1.3).
export function buildRegistry(
  issuer: string,
  testOnlyResources: readonly OAuthResourceDefinition[] = [],
): readonly OAuthResource[] {
  let base = oauthIssuer(issuer);
  let registry = [...RESOURCES, ...testOnlyResources].map(
    ({ path, scopes, ...resource }): OAuthResource =>
      Object.freeze({
        ...resource,
        scopes: Object.freeze(
          scopes.map(({ routes, ...scope }) =>
            Object.freeze({
              ...scope,
              routes: Object.freeze(
                routes.map((route) => Object.freeze({ ...route })),
              ),
            }),
          ),
        ),
        id: oauthIssuer(`${base}${path}`),
      }),
  );
  let seen = new Set<string>();
  for (let { id } of registry) {
    if (seen.has(id)) {
      throw new Error(`OAuth resource ${id} is declared twice`);
    }
    seen.add(id);
  }
  return Object.freeze(registry);
}

// Every scope any resource declares, each once, in declaration order.
export function registryScopes(registry: readonly OAuthResource[]): string[] {
  return [
    ...new Set(
      registry.flatMap(({ scopes }) => scopes.map(({ name }) => name)),
    ),
  ];
}
