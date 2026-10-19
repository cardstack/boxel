import { join } from 'node:path';
import { Readable } from 'node:stream';

import type Koa from 'koa';
import { isExactVersionRRI, parseRRI, realmRRI } from '@cardstack/deck';
import { hashBytes, readStoredFile } from '@cardstack/deck/node';
import type { Realm, ResponseWithNodeStream } from '@cardstack/runtime-common';
import {
  SupportedMimeType,
  inferContentType,
  parseExactVersionTransportURL,
} from '@cardstack/runtime-common';
import { transpileJS } from '@cardstack/runtime-common/transpile';

import {
  fetchRequestFromContext,
  setContextResponse,
} from '../middleware/index.ts';
import { findOrMountRealm } from '../lib/realm-routing.ts';
import type { ServeFromRealmDeps } from './serve-from-realm.ts';

type DeckVersionServingDeps = ServeFromRealmDeps & {
  deckCollaboration?: DeckCollaborationPolicy;
  resolveRealm?: (url: URL) => Promise<Realm | undefined>;
  readVersionFile?: (
    storeDir: string,
    name: string,
    version: string,
    path: string,
  ) => Promise<Buffer | undefined>;
};

export interface DeckCollaborationPolicy {
  enabled: boolean;
  realmRRIs: ReadonlySet<string>;
}

export function deckCollaborationPolicyFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): DeckCollaborationPolicy {
  return {
    enabled: environment.BOXEL_DECK_COLLABORATION_ENABLED === 'true',
    realmRRIs: new Set(
      (environment.BOXEL_DECK_COLLABORATION_REALM_RRIS ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value !== '')
        .map((value) => realmRRI(value)),
    ),
  };
}

function hasDeckCollaboration(
  deps: DeckVersionServingDeps,
  realmRRI: string,
): boolean {
  return (
    deps.deckCollaboration?.enabled === true &&
    deps.deckCollaboration.realmRRIs.has(realmRRI)
  );
}

function notFound(rri: string): Response {
  return new Response(`${rri} not found`, {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

function projectsCardDocument(request: Request, path: string): boolean {
  return (
    !path.split('/').at(-1)?.includes('.') &&
    request.headers.get('accept')?.includes('application/vnd.card+json') ===
      true
  );
}

function requestsExecutableModule(request: Request, path: string): boolean {
  return (
    request.headers.get('accept') !== SupportedMimeType.CardSource &&
    ['.gts', '.gjs', '.ts'].some((extension) => path.endsWith(extension))
  );
}

function projectCardDocument(
  bytes: Buffer,
  cardURL: URL,
  realmURL: URL,
): Buffer {
  let document = JSON.parse(bytes.toString()) as {
    data?: {
      id?: string;
      meta?: Record<string, unknown>;
      links?: { self?: string };
    };
  };
  if (!document.data) {
    return bytes;
  }
  document.data.id = cardURL.href;
  document.data.meta = {
    ...document.data.meta,
    realmURL: realmURL.href,
  };
  document.data.links = {
    ...document.data.links,
    self: cardURL.href,
  };
  return Buffer.from(JSON.stringify(document));
}

// Exact Versions sit outside the mutable realm's URL prefix but have exactly
// the realm's readers. The realm ACL answers, so JWT, delegated-session,
// revocation, archive and public-realm rules stay in the Realm's single
// authorization boundary. A realm policy's grants reach cards and files, not
// a whole package's source, so they admit no one here.
async function authorizeRead(request: Request, realm: Realm) {
  let answer = await realm.aclAdmits(request, 'read');
  return answer.allowed
    ? { publicReadable: answer.publicReadable }
    : { response: answer.response, publicReadable: false };
}

export async function handleDeckVersionRequest(
  request: Request,
  deps: DeckVersionServingDeps,
): Promise<Response | null> {
  let transportURL = new URL(request.url);
  transportURL.search = '';
  transportURL.hash = '';
  let identifier: string = deps.virtualNetwork.unresolveURL(transportURL.href);
  let dynamic = isExactVersionRRI(identifier)
    ? undefined
    : parseExactVersionTransportURL(transportURL);
  if (!isExactVersionRRI(identifier) && !dynamic) {
    return null;
  }
  identifier = dynamic?.identifier ?? identifier;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Exact Deck Versions are read-only', {
      status: 405,
      headers: { allow: 'GET, HEAD' },
    });
  }

  let { scope, name, version, path } = parseRRI(identifier);
  let mutableIdentifier = `@${scope}/${name}/`;
  if (!hasDeckCollaboration(deps, mutableIdentifier)) {
    return null;
  }
  let mutableURL = dynamic
    ? dynamic.mutableURL
    : deps.virtualNetwork.toURL(mutableIdentifier);
  let realm = await (deps.resolveRealm
    ? deps.resolveRealm(mutableURL)
    : findOrMountRealm(mutableURL, deps));
  if (!realm || !realm.dir || !version || path === '') {
    return notFound(identifier);
  }

  let authorization = await authorizeRead(request, realm);
  if (authorization.response) {
    return authorization.response;
  }

  let storeDir = join(realm.dir, '.deck', 'store');
  let readVersionFile = deps.readVersionFile ?? readStoredFile;
  let cardProjection = projectsCardDocument(request, path);
  let storedPath = cardProjection ? `${path}.json` : path;
  let bytes = await readVersionFile(
    storeDir,
    `${scope}/${name}`,
    version,
    storedPath,
  );
  if (!bytes) {
    return notFound(identifier);
  }

  if (cardProjection) {
    bytes = projectCardDocument(bytes, transportURL, mutableURL);
  }

  let executableModule = requestsExecutableModule(request, path);
  if (executableModule) {
    bytes = Buffer.from(await transpileJS(bytes.toString(), `/${identifier}`));
  }

  let etag = `"${hashBytes(bytes)}"`;
  let headers = new Headers({
    'cache-control': `${authorization.publicReadable ? 'public' : 'private'}, max-age=31536000, immutable`,
    'content-length': String(bytes.byteLength),
    'content-type': cardProjection
      ? SupportedMimeType.CardJson
      : executableModule
        ? 'text/javascript'
        : inferContentType(path),
    etag,
    'x-boxel-realm-url': mutableURL.href,
    'x-boxel-realm-public-readable': String(authorization.publicReadable),
    'x-boxel-version-rri': identifier,
    'access-control-expose-headers':
      'X-Boxel-Realm-Url,X-Boxel-Realm-Public-Readable,X-Boxel-Version-RRI,Cache-Control,ETag,Content-Length',
  });
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers });
  }
  let response = new Response(
    request.method === 'HEAD' ? null : new Uint8Array(bytes),
    { headers },
  ) as ResponseWithNodeStream;
  // setContextResponse intentionally decodes ordinary web streams as text.
  // Supplying the Node stream preserves arbitrary package assets byte-for-byte
  // when this response crosses the Koa boundary.
  if (request.method === 'GET') {
    response.nodeStream = Readable.from(bytes);
  }
  return response;
}

export function createServeDeckVersion(
  deps: DeckVersionServingDeps,
): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function serveDeckVersion(ctxt, next) {
    let request = await fetchRequestFromContext(ctxt);
    let response = await handleDeckVersionRequest(request, deps);
    if (!response) {
      return next();
    }
    await setContextResponse(ctxt, response);
  };
}
