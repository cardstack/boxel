import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import type Koa from 'koa';
import { isExactVersionRRI, parseRRI } from '@cardstack/deck';
import {
  hashBytes,
  readStoredFile,
  readStoreMeta,
  resolveVersionSpec,
} from '@cardstack/deck/node';
import { readTree, readTreeFile } from '@cardstack/deck/object-store';
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
import {
  buildDeckVersionIndex,
  queryDeckVersionIndex,
} from '../lib/deck-version-index.ts';
import {
  hasDeckCollaboration,
  type DeckCollaborationPolicy,
} from '../lib/deck-collaboration-policy.ts';
import { openDeckRepositoryProtocol } from '../lib/deck-repository-protocol.ts';
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

const CAPABILITIES_PATH = '.deck/capabilities';
const BRANCH_PATH = '.deck/branch';
const TREE_FILE_PATH = '.deck/tree-file';

function mutableRealmURLForCapabilities(url: URL): URL | undefined {
  if (!url.pathname.endsWith(CAPABILITIES_PATH)) {
    return undefined;
  }
  let mutableURL = new URL(url);
  mutableURL.pathname = url.pathname.slice(0, -CAPABILITIES_PATH.length);
  mutableURL.search = '';
  mutableURL.hash = '';
  return mutableURL;
}

async function handleDeckCapabilitiesRequest(
  request: Request,
  deps: DeckVersionServingDeps,
): Promise<Response | null> {
  let mutableURL = mutableRealmURLForCapabilities(new URL(request.url));
  if (!mutableURL) {
    return null;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Deck capabilities are read-only', {
      status: 405,
      headers: { allow: 'GET, HEAD' },
    });
  }
  let realm = await (deps.resolveRealm
    ? deps.resolveRealm(mutableURL)
    : findOrMountRealm(mutableURL, deps));
  if (!realm?.dir) {
    return new Response('Not found', { status: 404 });
  }
  let packageName: unknown;
  try {
    packageName = JSON.parse(
      await readFile(join(realm.dir, 'package.json'), 'utf8'),
    ).name;
  } catch {
    return new Response('Not found', { status: 404 });
  }
  let realmRRI =
    typeof packageName === 'string' ? `${packageName.replace(/\/$/, '')}/` : '';
  if (!hasDeckCollaboration(deps.deckCollaboration, realmRRI)) {
    return new Response('Not found', { status: 404 });
  }
  let authorization = await authorizeRead(request, realm);
  if (authorization.response) {
    return authorization.response;
  }
  let body = JSON.stringify({
    deckCollaboration: true,
    realmRRI,
    protocol: 'deck-r0',
    sync: 'content-addressed',
    history: 'jj',
  });
  return new Response(request.method === 'HEAD' ? null : body, {
    headers: {
      'cache-control': 'private, no-store',
      'content-type': 'application/json',
      'x-boxel-deck-collaboration': 'true',
      'x-boxel-realm-rri': realmRRI,
      'access-control-expose-headers':
        'X-Boxel-Deck-Collaboration,X-Boxel-Realm-RRI',
    },
  });
}

function mutableRealmURLForBranch(url: URL): URL | undefined {
  if (!url.pathname.endsWith(BRANCH_PATH)) {
    return undefined;
  }
  let mutableURL = new URL(url);
  mutableURL.pathname = url.pathname.slice(0, -BRANCH_PATH.length);
  mutableURL.search = '';
  mutableURL.hash = '';
  return mutableURL;
}

async function handleDeckBranchRequest(
  request: Request,
  deps: DeckVersionServingDeps,
): Promise<Response | null> {
  let requestURL = new URL(request.url);
  let mutableURL = mutableRealmURLForBranch(requestURL);
  if (!mutableURL) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Deck branch observations are read-only', {
      status: 405,
      headers: { allow: 'GET, HEAD' },
    });
  }
  let branch = requestURL.searchParams.get('name');
  if (!branch) {
    return new Response('A branch name is required', { status: 400 });
  }
  let realm = await (deps.resolveRealm
    ? deps.resolveRealm(mutableURL)
    : findOrMountRealm(mutableURL, deps));
  let packageName = realm ? await realmPackageName(realm) : undefined;
  let realmRRI = packageName ? `@${packageName}/` : undefined;
  if (
    !realm?.dir ||
    !realmRRI ||
    !hasDeckCollaboration(deps.deckCollaboration, realmRRI)
  ) {
    return new Response('Not found', { status: 404 });
  }
  let authorization = await authorizeRead(request, realm);
  if (authorization.response) return authorization.response;
  let snapshot;
  try {
    snapshot = await openDeckRepositoryProtocol({
      realmDir: realm.dir,
      realmRRI,
      policy: deps.deckCollaboration,
    }).readBranch(branch);
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid branch name') {
      return new Response(error.message, { status: 400 });
    }
    throw error;
  }
  if (!snapshot) return new Response('Branch not found', { status: 404 });
  let treeHash = snapshot.repository.members[realmRRI];
  let packlist = await readTree(join(realm.dir, '.deck', 'store'), treeHash);
  if (!packlist) {
    throw new Error(`missing Repository member tree ${treeHash}`);
  }
  let files = Object.fromEntries(
    packlist.entries.map(({ path, sha256 }) => [path, sha256]),
  );
  let body = JSON.stringify({
    schema: 'boxel-deck-branch-observation-v1',
    realmRRI,
    branchId: `${realmRRI}:${branch}`,
    branchName: branch,
    repositoryHash: snapshot.head.repositoryHash,
    treeHash,
    lockHash: snapshot.repository.lockHash,
    refGeneration: snapshot.head.generation,
    checkpointHash: snapshot.head.latestCheckpointHash,
    files,
  });
  return new Response(request.method === 'HEAD' ? null : body, {
    headers: {
      'cache-control': 'private, no-store',
      'content-type': 'application/json',
      etag: `"${snapshot.head.repositoryHash}:${snapshot.head.generation}"`,
      'x-boxel-deck-collaboration': 'true',
      'x-boxel-realm-rri': realmRRI,
    },
  });
}

async function handleDeckTreeFileRequest(
  request: Request,
  deps: DeckVersionServingDeps,
): Promise<Response | null> {
  let requestURL = new URL(request.url);
  if (!requestURL.pathname.endsWith(TREE_FILE_PATH)) return null;
  let mutableURL = new URL(requestURL);
  mutableURL.pathname = requestURL.pathname.slice(0, -TREE_FILE_PATH.length);
  mutableURL.search = '';
  mutableURL.hash = '';
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Deck tree files are read-only', {
      status: 405,
      headers: { allow: 'GET, HEAD' },
    });
  }
  let treeHash = requestURL.searchParams.get('tree');
  let filePath = requestURL.searchParams.get('path');
  if (!treeHash || !filePath) {
    return new Response('A tree hash and file path are required', {
      status: 400,
    });
  }
  let realm = await (deps.resolveRealm
    ? deps.resolveRealm(mutableURL)
    : findOrMountRealm(mutableURL, deps));
  let packageName = realm ? await realmPackageName(realm) : undefined;
  let realmRRI = packageName ? `@${packageName}/` : undefined;
  if (
    !realm?.dir ||
    !realmRRI ||
    !hasDeckCollaboration(deps.deckCollaboration, realmRRI)
  ) {
    return new Response('Not found', { status: 404 });
  }
  let authorization = await authorizeRead(request, realm);
  if (authorization.response) return authorization.response;
  let bytes = await readTreeFile(
    join(realm.dir, '.deck', 'store'),
    treeHash,
    filePath,
  );
  if (!bytes) return new Response('Not found', { status: 404 });
  let etag = `"${hashBytes(bytes)}"`;
  let headers = new Headers({
    'cache-control': 'private, max-age=31536000, immutable',
    'content-length': String(bytes.byteLength),
    'content-type': inferContentType(filePath),
    etag,
    'x-boxel-deck-tree-hash': treeHash,
  });
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers });
  }
  let response = new Response(
    request.method === 'HEAD' ? null : new Uint8Array(bytes),
    { headers },
  ) as ResponseWithNodeStream;
  if (request.method === 'GET') response.nodeStream = Readable.from(bytes);
  return response;
}

const VERSIONS_PATH = '.deck/versions';

function mutableRealmURLForVersions(url: URL): URL | undefined {
  if (!url.pathname.endsWith(VERSIONS_PATH)) {
    return undefined;
  }
  let mutableURL = new URL(url);
  mutableURL.pathname = url.pathname.slice(0, -VERSIONS_PATH.length);
  mutableURL.search = '';
  mutableURL.hash = '';
  return mutableURL;
}

async function realmPackageName(realm: Realm): Promise<string | undefined> {
  if (!realm.dir) {
    return undefined;
  }
  try {
    let value = JSON.parse(
      await readFile(join(realm.dir, 'package.json'), 'utf8'),
    ).name;
    return typeof value === 'string' && value.startsWith('@')
      ? value.slice(1)
      : undefined;
  } catch {
    return undefined;
  }
}

async function handleDeckVersionIndexQuery(
  request: Request,
  deps: DeckVersionServingDeps,
): Promise<Response | null> {
  let requestURL = new URL(request.url);
  let mutableURL = mutableRealmURLForVersions(requestURL);
  if (!mutableURL) {
    return null;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Deck Version queries are read-only', {
      status: 405,
      headers: { allow: 'GET, HEAD' },
    });
  }
  let realm = await (deps.resolveRealm
    ? deps.resolveRealm(mutableURL)
    : findOrMountRealm(mutableURL, deps));
  let packageName = realm ? await realmPackageName(realm) : undefined;
  if (
    !realm?.dir ||
    !packageName ||
    !hasDeckCollaboration(deps.deckCollaboration, `@${packageName}/`)
  ) {
    return new Response('Not found', { status: 404 });
  }
  let authorization = await authorizeRead(request, realm);
  if (authorization.response) {
    return authorization.response;
  }
  let spec = requestURL.searchParams.get('spec');
  if (!spec) {
    return new Response('A Version, dist-tag, or semver range is required', {
      status: 400,
    });
  }
  let meta = await readStoreMeta(
    join(realm.dir, '.deck', 'store'),
    packageName,
  );
  if (!meta) {
    return new Response('Not found', { status: 404 });
  }
  let resolution = resolveVersionSpec(spec, meta);
  if (resolution.kind === 'invalid') {
    return new Response(resolution.detail, { status: 400 });
  }
  if (resolution.kind === 'not-found') {
    return new Response(resolution.detail, { status: 404 });
  }
  let version = resolution.version;
  let snapshot = await buildDeckVersionIndex({
    realmDir: realm.dir,
    packageName,
    version,
  });
  let cards = queryDeckVersionIndex(
    snapshot,
    requestURL.searchParams.get('q') ?? undefined,
  );
  let body = JSON.stringify({
    requested: spec,
    resolved: version,
    versionRRI: snapshot.packageRRI,
    treeHash: snapshot.treeHash,
    indexHash: snapshot.indexHash,
    cards,
  });
  return new Response(request.method === 'HEAD' ? null : body, {
    headers: {
      'cache-control': 'private, no-store',
      'content-type': 'application/json',
      'content-location': `${mutableURL.href.slice(0, -1)}@${version}/.deck/index`,
    },
  });
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

async function authorizeRead(request: Request, realm: Realm) {
  // Exact Versions are deliberately outside the mutable realm's URL prefix,
  // but they have exactly the same readers. Probe a guaranteed-missing path
  // through Realm.handle so JWT, delegated-session, revocation, archive and
  // public-realm rules stay in the Realm's single authorization boundary.
  // The probe is GET even for HEAD because Realm intentionally allows HEAD
  // without authentication.
  let headers = new Headers(request.headers);
  headers.set('accept', 'application/octet-stream');
  let response = await realm.handle(
    new Request(new URL('.deck/__deck_version_authorize__.bin', realm.url), {
      method: 'GET',
      headers,
    }),
  );
  if (response && response.status !== 404 && response.status >= 400) {
    return { response, publicReadable: false };
  }
  return {
    publicReadable:
      response?.headers.get('x-boxel-realm-public-readable') === 'true',
  };
}

export async function handleDeckVersionRequest(
  request: Request,
  deps: DeckVersionServingDeps,
): Promise<Response | null> {
  let treeFile = await handleDeckTreeFileRequest(request, deps);
  if (treeFile) {
    return treeFile;
  }
  let branch = await handleDeckBranchRequest(request, deps);
  if (branch) {
    return branch;
  }
  let versionQuery = await handleDeckVersionIndexQuery(request, deps);
  if (versionQuery) {
    return versionQuery;
  }
  let capabilities = await handleDeckCapabilitiesRequest(request, deps);
  if (capabilities) {
    return capabilities;
  }
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
  if (!hasDeckCollaboration(deps.deckCollaboration, mutableIdentifier)) {
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

  if (path === '.deck/index') {
    let snapshot = await buildDeckVersionIndex({
      realmDir: realm.dir,
      packageName: `${scope}/${name}`,
      version,
    });
    let body = JSON.stringify({
      requested: version,
      resolved: version,
      versionRRI: snapshot.packageRRI,
      treeHash: snapshot.treeHash,
      indexHash: snapshot.indexHash,
      cards: queryDeckVersionIndex(
        snapshot,
        new URL(request.url).searchParams.get('q') ?? undefined,
      ),
    });
    return new Response(request.method === 'HEAD' ? null : body, {
      headers: {
        'cache-control': `${authorization.publicReadable ? 'public' : 'private'}, max-age=31536000, immutable`,
        'content-type': 'application/json',
        'x-boxel-version-rri': identifier,
        'x-boxel-deck-collaboration': 'true',
      },
    });
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
    'x-boxel-deck-collaboration': 'true',
    'access-control-expose-headers':
      'X-Boxel-Realm-Url,X-Boxel-Realm-Public-Readable,X-Boxel-Version-RRI,X-Boxel-Deck-Collaboration,Cache-Control,ETag,Content-Length',
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
