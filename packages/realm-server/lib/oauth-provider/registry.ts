// The resources the OAuth provider issues tokens for. Each is an API named by
// one URL, the audience of its tokens. The list is code, so adding a resource
// is a reviewed change: every resource also needs a controller that checks
// its tokens. Each scope maps the routes it admits, and a controller refuses
// an OAuth token on any route its scopes don't map (ADR 021 §1.3). Tests add
// a resource of their own through the realm server's test-only option;
// nothing in production can.

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';
import type {
  OAuthRoute,
  OAuthRouteMethod,
  OAuthScope,
} from '@cardstack/runtime-common/oauth-route-admission';

// The route map's types and its check live in runtime-common, where a realm
// can reach them too (ADR 021 §1.3).
export type {
  OAuthRoute,
  OAuthRouteMethod,
  OAuthScope,
} from '@cardstack/runtime-common/oauth-route-admission';

export type OAuthClientKinds =
  // Any client: one identified by a client ID metadata document, or one that
  // registers itself.
  | 'open'
  // Only the clients Boxel registers in code.
  | 'pre-registered';

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
  // Set on a resource a test added, which the realm server serves a
  // test-only route for (`serve.ts`). Never set outside tests.
  testOnly?: true;
}

export const MCP_RESOURCE_PATH = '/mcp';

// `/mcp` is one route for every tool, so each scope maps it, and each tool
// names the scope it needs where it is defined (ADR 021 §1.3).
const MCP_ROUTES: readonly OAuthRoute[] = [
  { on: 'server', method: 'POST', path: MCP_RESOURCE_PATH },
];

const MCP: OAuthResourceDefinition = {
  path: MCP_RESOURCE_PATH,
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
      routes: MCP_ROUTES,
    },
    {
      name: 'boxel:write',
      description:
        'Create and change cards and files, create workspaces, and archive the ones you own.',
      label: 'Change',
      caution: true,
      routes: MCP_ROUTES,
    },
  ],
  clients: 'open',
};

// The Boxel API: the realm and realm-server routes Boxel's own apps call,
// starting with boxel-cli. Its controllers are `jwtMiddleware`,
// `multiRealmAuthorization` and `Realm.#admitOAuthToken` (ADR 021 §1.5).
//
// A scope maps only what boxel-cli calls and a realm's reads; every
// other route refuses its tokens, so a route added later refuses them until
// it is mapped here (§1.3). None of key management, a secure-session route,
// a route that mints a token or a signed URL, or a realm's permissions is
// mapped, nor may ever be (§1.6): the realm's `_session`, `_permissions` and
// `_sign-capture-urls`, and the realm server's `_server-session`,
// `_realm-auth`, `_delegate-session`, key, secure-session, secure-window and
// `_oauth` routes. Nor is `/_run-command`: its prerender tab holds sessions for
// every realm the user can reach, beside code the caller chooses, which would
// exchange the token for those sessions (§1.5).
// `oauth-provider-boxel-api-test.ts` checks the map against both routers.
const ROUTE_METHODS_READ: readonly OAuthRouteMethod[] = ['GET', 'QUERY'];

function realm(
  method: OAuthRouteMethod,
  path: string,
  mimeType: SupportedMimeType | '*',
): OAuthRoute {
  return { on: 'realm', method, path, mimeType };
}

function server(method: OAuthRouteMethod, path: string): OAuthRoute {
  return { on: 'server', method, path };
}

const BOXEL_API_READ_ROUTES: readonly OAuthRoute[] = [
  // Realm reads.
  ...ROUTE_METHODS_READ.map((method) =>
    realm(method, '/_info', SupportedMimeType.RealmInfo),
  ),
  realm('GET', '/_readiness-check', SupportedMimeType.RealmInfo),
  realm('QUERY', '/_lint', SupportedMimeType.JSON),
  realm('GET', '/_mtimes', SupportedMimeType.Mtimes),
  ...ROUTE_METHODS_READ.map((method) =>
    realm(method, '/_search', SupportedMimeType.CardJson),
  ),
  realm('HEAD', '/_search', SupportedMimeType.CardJson),
  realm('GET', '/_types', SupportedMimeType.CardTypeSummary),
  realm('GET', '/_dependencies', SupportedMimeType.JSONAPI),
  realm('GET', '/_publishability', SupportedMimeType.JSONAPI),
  realm('GET', '/_indexing-errors', SupportedMimeType.JSONAPI),
  realm('GET', '/_card-dependencies', SupportedMimeType.CardDependencies),
  // A `POST` that only reads: the realm requires `read` of it.
  realm('POST', '/_capabilities', SupportedMimeType.JSON),
  realm('QUERY', '/_operations', SupportedMimeType.BoxelOperations),
  realm('QUERY', '/_operations', SupportedMimeType.JSONAPI),
  ...[
    SupportedMimeType.CardJson,
    SupportedMimeType.CardHtml,
    SupportedMimeType.FileMetaHtml,
    SupportedMimeType.Markdown,
    SupportedMimeType.FileMeta,
    SupportedMimeType.CardSource,
  ].map((mimeType) => realm('GET', '/.*', mimeType)),
  realm('HEAD', '/.*', SupportedMimeType.CardJson),
  realm('HEAD', '/.*', SupportedMimeType.CardSource),
  realm('GET', '.*/', SupportedMimeType.DirectoryListing),
  // Realm discovery: a `HEAD` in every other bucket answers with the realm's
  // identity alone, and the health probe's `HEAD` is the same answer.
  ...Object.values(SupportedMimeType)
    .filter(
      (mimeType) =>
        mimeType !== SupportedMimeType.CardJson &&
        mimeType !== SupportedMimeType.CardSource,
    )
    .flatMap((mimeType) => [
      realm('HEAD', '/_readiness-check', mimeType),
      realm('HEAD', '/.*', mimeType),
    ]),
  // The file and module serve, for whatever no router route claimed.
  realm('GET', '*', '*'),
  realm('HEAD', '*', '*'),
  // Realm-server reads.
  ...[
    '/_federated-search',
    '/_federated-info',
    '/_federated-index-counts',
    '/_federated-types',
  ].flatMap((path) =>
    (['GET', 'QUERY', 'POST'] as const).map((method) => server(method, path)),
  ),
  server('GET', '/_archived-realms'),
  server('GET', '/_publish-progress'),
];

const BOXEL_API_WRITE_ROUTES: readonly OAuthRoute[] = [
  ...BOXEL_API_READ_ROUTES,
  // Realm writes. A write that would change what the realm's policy admits
  // is refused in the realm whatever route carries it (§1.6).
  realm('POST', '/_atomic', SupportedMimeType.JSONAPI),
  realm('POST', '/_operations', SupportedMimeType.BoxelOperations),
  realm('POST', '/_operations', SupportedMimeType.JSONAPI),
  realm('POST', '(/|/.+/)', SupportedMimeType.CardJson),
  realm('PATCH', '/.+(?<!.json)', SupportedMimeType.CardJson),
  realm('DELETE', '/|/.+(?<!.json)', SupportedMimeType.CardJson),
  realm('POST', '/.*', SupportedMimeType.CardSource),
  realm('POST', '/.*', SupportedMimeType.OctetStream),
  realm('DELETE', '/.+', SupportedMimeType.CardSource),
  realm('POST', '/_cancel-indexing-job', SupportedMimeType.JSON),
  realm('POST', '/_reindex', SupportedMimeType.JSON),
  realm('POST', '/_full-reindex', SupportedMimeType.JSON),
  // Realm-server writes: what boxel-cli does with a user's workspaces.
  // Creating a workspace writes only its caller's own owner row, on a realm
  // that didn't exist, and publishing writes read for everyone only on the
  // published copy, never on the realm published from, so neither changes
  // who can reach an existing realm of the user's (§1.6).
  server('POST', '/_create-realm'),
  server('DELETE', '/_delete-realm'),
  server('POST', '/_publish-realm'),
  server('POST', '/_unpublish-realm'),
  server('POST', '/_archive-realm'),
  server('POST', '/_unarchive-realm'),
];

const BOXEL_API: OAuthResourceDefinition = {
  path: '',
  name: 'Boxel',
  description:
    'Lets the app work in your Boxel account as you do: read and change your workspaces and their files.',
  coverage:
    'This covers every workspace you can open, including shared ones and ones you create later. It never covers your API keys, who can open a workspace, or your password.',
  scopes: [
    {
      name: 'boxel:read',
      description: 'See your workspaces and the cards and files in them.',
      label: 'Read',
      caution: false,
      routes: BOXEL_API_READ_ROUTES,
      realmPermission: 'read',
    },
    {
      name: 'boxel:write',
      description:
        'Create and change cards and files, and create, publish, archive and delete workspaces you own.',
      label: 'Change',
      caution: true,
      routes: BOXEL_API_WRITE_ROUTES,
      realmPermission: 'write',
    },
  ],
  clients: 'pre-registered',
};

// The Boxel API's entry. Its identifier is the issuer itself (`path: ''`),
// and only it is, since `buildRegistry` refuses a duplicate identifier.
export function boxelApiResource(
  registry: readonly OAuthResource[],
  issuer: string,
): OAuthResource {
  let id = oauthIssuer(issuer);
  let found = registry.find((entry) => !entry.testOnly && entry.id === id);
  if (!found) {
    throw new Error('the registry declares no Boxel API resource');
  }
  return found;
}

const RESOURCES: readonly OAuthResourceDefinition[] = [MCP, BOXEL_API];

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
  let registry = [
    ...RESOURCES.map((definition) => ({ definition, testOnly: false })),
    ...testOnlyResources.map((definition) => ({ definition, testOnly: true })),
  ].map(
    ({ definition: { path, scopes, ...resource }, testOnly }): OAuthResource =>
      Object.freeze({
        ...resource,
        ...(testOnly ? { testOnly: true as const } : {}),
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
