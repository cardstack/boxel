import { getDomain } from 'tldts';
import {
  codeRefWithAbsoluteIdentifier,
  fetchRealmPermissions,
  isDirectWriter,
  isResolvedCodeRef,
  param,
  query,
  type CodeRef,
  type DBAdapter,
  type DefinitionLookup,
  type Realm,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { operationDisplayLabel } from '@cardstack/runtime-common/card-operations/label';
import { normalizeRealmURL } from '../utils/realm-url.ts';
import { UserKeyError } from './user-keys.ts';

// What the secure window shows about what it was opened for, read here from
// the realm server's own records: the realm, the card definition and the
// operation, never anything the page that opened the window supplies. The
// window is given only names for these (a realm URL, a card or type, an
// operation name) and asks this module what they are.
//
// It answers only about a realm the user may read, and answers a realm or
// card the user can't read exactly as one that doesn't exist, so the window
// can't be used to learn what is in a realm the user has no access to.

export interface DestinationDisplay {
  // The destination as lowered: an origin and a path prefix ending in `/`.
  href: string;
  host: string;
  path: string;
  // The part of the host a person recognizes as who they are dealing with:
  // `github.com` for `api.github.com`, `foo.co.uk` for `api.foo.co.uk`. A host
  // with no registrable domain, such as an IP address or `localhost`, is its
  // own.
  registrableDomain: string;
}

export interface SecureWindowOperation {
  name: string;
  label: string;
  base: string;
  method?: string;
  destination?: DestinationDisplay;
  // The credentials the request takes: `userKey` for the caller's own,
  // `apiKey` for one a realm share holds.
  slots: { name: string; key: string }[];
}

export interface SecureWindowContext {
  realm: { url: string; name: string; directWriter: boolean };
  card?: { name: string; module: string; exportName: string };
  operation?: SecureWindowOperation;
}

export type SecureWindowTarget =
  | { kind: 'instance'; url: string }
  | { kind: 'type'; module: string; name: string; realm: string };

export interface SecureWindowContextRequest {
  realm?: string;
  target?: SecureWindowTarget;
  operation?: string;
}

const NOT_FOUND = 'no such realm, card or operation';

export function registrableDomain(host: string): string {
  return getDomain(host, { allowPrivateDomains: true }) ?? host;
}

export function describeDestination(destination: string): DestinationDisplay {
  let url = new URL(destination);
  return {
    href: url.href,
    host: url.host,
    path: url.pathname,
    registrableDomain: registrableDomain(url.hostname),
  };
}

function parseURL(value: unknown, what: string): URL {
  if (typeof value !== 'string') {
    throw new UserKeyError(400, `${what} must be a URL`);
  }
  try {
    return new URL(value);
  } catch {
    throw new UserKeyError(400, `${what} must be a URL`);
  }
}

// The request's names, checked for shape only.
export function validateContextRequest(
  attributes: Record<string, unknown>,
): SecureWindowContextRequest {
  for (let name of Object.keys(attributes)) {
    if (!['realm', 'target', 'operation'].includes(name)) {
      throw new UserKeyError(400, `'${name}' can't be asked about here`);
    }
  }
  let { realm, target, operation } = attributes;
  let request: SecureWindowContextRequest = {};
  if (realm !== undefined) {
    request.realm = normalizeRealmURL(parseURL(realm, 'realm').href)!.href;
  }
  if (operation !== undefined) {
    if (typeof operation !== 'string' || operation === '') {
      throw new UserKeyError(400, 'operation must be an operation’s name');
    }
    request.operation = operation;
  }
  if (target !== undefined) {
    let t = target as Record<string, unknown>;
    if (!t || typeof t !== 'object') {
      throw new UserKeyError(400, 'target must be an object');
    }
    if (t.kind === 'instance') {
      request.target = { kind: 'instance', url: parseURL(t.url, 'url').href };
    } else if (t.kind === 'type') {
      if (typeof t.name !== 'string' || t.name === '') {
        throw new UserKeyError(400, 'a type target names its export');
      }
      request.target = {
        kind: 'type',
        module: parseURL(t.module, 'module').href,
        name: t.name,
        realm: normalizeRealmURL(parseURL(t.realm, 'realm').href)!.href,
      };
    } else {
      throw new UserKeyError(400, `target.kind is 'instance' or 'type'`);
    }
  }
  if (request.operation !== undefined && !request.target) {
    throw new UserKeyError(400, 'an operation is asked about on a target');
  }
  if (!request.realm && !request.target) {
    throw new UserKeyError(400, 'ask about a realm or a target');
  }
  return request;
}

async function mayRead(
  dbAdapter: DBAdapter,
  realmURL: URL,
  user: string,
): Promise<boolean> {
  let permissions = await fetchRealmPermissions(dbAdapter, realmURL);
  return [user, 'users', '*'].some((who) => permissions[who]?.includes('read'));
}

// The type an indexed card adopts from.
async function instanceType(
  dbAdapter: DBAdapter,
  realm: Realm,
  url: string,
): Promise<ResolvedCodeRef | undefined> {
  let indexURL = url.replace(/\.json$/, '');
  let [row] = (await query(dbAdapter, [
    `SELECT pristine_doc FROM boxel_index WHERE url =`,
    param(indexURL),
    `AND realm_url =`,
    param(realm.url),
    `AND type = 'instance' AND (is_deleted = FALSE OR is_deleted IS NULL)`,
  ])) as { pristine_doc: { meta?: { adoptsFrom?: CodeRef } } | null }[];
  let adoptsFrom = row?.pristine_doc?.meta?.adoptsFrom;
  if (!adoptsFrom) {
    return undefined;
  }
  let absolute = codeRefWithAbsoluteIdentifier(
    adoptsFrom,
    new URL(indexURL),
    undefined,
  );
  return isResolvedCodeRef(absolute) ? absolute : undefined;
}

export async function secureWindowContext(
  {
    dbAdapter,
    realms,
    definitionLookup,
  }: {
    dbAdapter: DBAdapter;
    realms: Realm[];
    definitionLookup: DefinitionLookup;
  },
  user: string,
  request: SecureWindowContextRequest,
): Promise<SecureWindowContext> {
  let { target } = request;
  let realmURL: string | undefined;
  if (target?.kind === 'type') {
    realmURL = target.realm;
  } else if (target?.kind === 'instance') {
    // The innermost realm the card's URL is in.
    realmURL = realms
      .filter((r) => target.url.startsWith(r.url))
      .sort((a, b) => b.url.length - a.url.length)[0]?.url;
  } else {
    realmURL = request.realm;
  }
  if (request.realm && realmURL !== request.realm) {
    throw new UserKeyError(400, 'the target is not in that realm');
  }
  let realm = realmURL ? realms.find((r) => r.url === realmURL) : undefined;
  if (!realm || !(await mayRead(dbAdapter, new URL(realm.url), user))) {
    throw new UserKeyError(404, NOT_FOUND);
  }
  let info = await realm.getRealmInfo();
  let context: SecureWindowContext = {
    realm: {
      url: realm.url,
      name: info.name,
      directWriter: await isDirectWriter(dbAdapter, new URL(realm.url), user),
    },
  };
  if (!request.target) {
    return context;
  }

  let codeRef =
    request.target.kind === 'type'
      ? { module: request.target.module, name: request.target.name }
      : await instanceType(dbAdapter, realm, request.target.url);
  if (!codeRef) {
    throw new UserKeyError(404, NOT_FOUND);
  }
  let definition;
  try {
    definition = await definitionLookup
      .forRealm(realm)
      .lookupDefinition(codeRef as ResolvedCodeRef);
  } catch {
    throw new UserKeyError(404, NOT_FOUND);
  }
  context.card = {
    name: definition.displayName ?? codeRef.name,
    module: codeRef.module,
    exportName: codeRef.name,
  };
  if (request.operation === undefined) {
    return context;
  }
  let operation = Object.hasOwn(definition.operations ?? {}, request.operation)
    ? definition.operations![request.operation]
    : undefined;
  if (!operation) {
    throw new UserKeyError(404, NOT_FOUND);
  }
  context.operation = {
    name: request.operation,
    label: operationDisplayLabel(request.operation, operation),
    base: operation.base,
    slots: (operation.callApi?.slots ?? []).map(({ name, key }) => ({
      name,
      key,
    })),
    ...(operation.callApi
      ? {
          method: operation.callApi.method,
          destination: describeDestination(operation.callApi.destination),
        }
      : {}),
  };
  return context;
}
