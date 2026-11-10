// The resources the OAuth provider issues tokens for. Each is an API named by
// one URL, the audience of its tokens. The list is code, so adding a resource
// is a reviewed change: every resource also needs a controller that checks
// its tokens. What a scope admits is decided by each resource's controller,
// not here (ADR 021 §1.3). Tests add a resource of their own through the
// realm server's test-only option; nothing in production can.

export type OAuthClientKinds =
  // Any client: one identified by a client ID metadata document, or one that
  // registers itself.
  | 'open'
  // Only the clients Boxel registers in code.
  | 'pre-registered';

export interface OAuthScope {
  name: string;
  // What consent says the scope lets the app do.
  description: string;
  // The short word Connected apps shows for it ("Read", "Change").
  label: string;
  // Whether consent marks it as one to think twice about.
  caution: boolean;
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
    },
    {
      name: 'boxel:write',
      description:
        'Create and change cards and files, create workspaces, and archive the ones you own.',
      label: 'Change',
      caution: true,
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
          scopes.map((scope) => Object.freeze({ ...scope })),
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
