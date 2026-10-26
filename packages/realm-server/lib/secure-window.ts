import { getDomain } from 'tldts';
import {
  codeRefWithAbsoluteIdentifier,
  fetchRealmPermissions,
  isBotAccount,
  isDirectWriter,
  isPrefixForm,
  isResolvedCodeRef,
  param,
  query,
  RealmPaths,
  type CodeRef,
  type DBAdapter,
  type DefinitionLookup,
  type Realm,
  type RealmResourceIdentifier,
  type ResolvedCodeRef,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import { operationDisplayLabel } from '@cardstack/runtime-common/card-operations/label';
import { UserKeyError } from './user-keys.ts';

// What the secure window shows about what it was opened for, read here from
// the realm server's own records: the realm, the card definition and the
// operation, never anything the page that opened the window supplies. The
// window is given only names for these (a realm, a card or a type, an
// operation name) and asks this module what they are.
//
// It answers only when the user may read every realm the answer comes from:
// the realm named, the realm holding the card, and the realm holding the
// card's or type's module. Anything else is answered exactly as something
// that doesn't exist, so the window can't be used to learn what is in a realm
// the user has no access to, or whether a module exists there.
//
// Identifiers arrive in either form, URL or prefix (`@cardstack/catalog/…`).
// They are resolved only through the VirtualNetwork, and realm membership is
// decided with `RealmPaths`.

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
  | { kind: 'instance'; url: RealmResourceIdentifier }
  | {
      kind: 'type';
      module: RealmResourceIdentifier;
      name: string;
      realm: RealmResourceIdentifier;
    };

export interface SecureWindowContextRequest {
  realm?: RealmResourceIdentifier;
  target?: SecureWindowTarget;
  operation?: string;
}

const NOT_FOUND = 'no such realm, card or operation';
const MAX_IDENTIFIER_LENGTH = 2048;

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

// An identifier in either form, checked for shape as a string: an `http(s)`
// URL or a prefix-form identifier. What it names is decided later, by
// resolving it.
function identifier(value: unknown, what: string): RealmResourceIdentifier {
  if (
    typeof value !== 'string' ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    !(
      isPrefixForm(value) ||
      value.startsWith('https://') ||
      value.startsWith('http://')
    )
  ) {
    throw new UserKeyError(400, `${what} must be a URL or a prefix-form id`);
  }
  return value as RealmResourceIdentifier;
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
    request.realm = identifier(realm, 'realm');
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
      request.target = { kind: 'instance', url: identifier(t.url, 'url') };
    } else if (t.kind === 'type') {
      if (typeof t.name !== 'string' || t.name === '') {
        throw new UserKeyError(400, 'a type target names its export');
      }
      request.target = {
        kind: 'type',
        module: identifier(t.module, 'module'),
        name: t.name,
        realm: identifier(t.realm, 'realm'),
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

interface Deps {
  dbAdapter: DBAdapter;
  realms: Realm[];
  definitionLookup: DefinitionLookup;
  virtualNetwork: VirtualNetwork;
}

// The served URL an identifier names, or undefined when it names nothing this
// server can resolve.
function servedURL(
  virtualNetwork: VirtualNetwork,
  id: RealmResourceIdentifier,
): URL | undefined {
  try {
    return virtualNetwork.toURL(id);
  } catch {
    return undefined;
  }
}

// The innermost realm this server serves that holds `url`.
function realmHolding(realms: Realm[], url: URL): Realm | undefined {
  return realms
    .filter((r) => new RealmPaths(new URL(r.url)).inRealm(url))
    .sort((a, b) => b.url.length - a.url.length)[0];
}

// The realm `id` names: its root, written with or without the trailing slash.
function realmNamed(
  { realms, virtualNetwork }: Deps,
  id: RealmResourceIdentifier,
): Realm | undefined {
  let url = servedURL(virtualNetwork, id);
  if (!url) {
    return undefined;
  }
  let root = url.href.endsWith('/') ? url.href : `${url.href}/`;
  return realms.find((r) => r.url === root);
}

async function mayRead(
  dbAdapter: DBAdapter,
  realm: Realm,
  user: string,
): Promise<boolean> {
  let permissions = await fetchRealmPermissions(dbAdapter, new URL(realm.url));
  return [user, 'users', '*'].some((who) => permissions[who]?.includes('read'));
}

// The type an indexed card adopts from. A card is named with or without
// `.json`; the index keys its instance row by the `.json` file's served URL.
async function instanceType(
  dbAdapter: DBAdapter,
  realm: Realm,
  url: URL,
): Promise<ResolvedCodeRef | undefined> {
  let indexURL = url.href.endsWith('.json') ? url.href : `${url.href}.json`;
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
    indexURL as RealmResourceIdentifier,
    undefined,
  );
  return isResolvedCodeRef(absolute) ? absolute : undefined;
}

export async function secureWindowContext(
  deps: Deps,
  user: string,
  request: SecureWindowContextRequest,
): Promise<SecureWindowContext> {
  let { dbAdapter, realms, definitionLookup, virtualNetwork } = deps;
  let notFound = () => new UserKeyError(404, NOT_FOUND);
  let { target } = request;

  let realm: Realm | undefined;
  let instanceURL: URL | undefined;
  if (target?.kind === 'instance') {
    instanceURL = servedURL(virtualNetwork, target.url);
    realm = instanceURL ? realmHolding(realms, instanceURL) : undefined;
  } else {
    let named = target?.kind === 'type' ? target.realm : request.realm;
    realm = named ? realmNamed(deps, named) : undefined;
  }
  // A realm named beside a target must be the target's own.
  if (request.realm && target && realmNamed(deps, request.realm) !== realm) {
    throw new UserKeyError(400, 'the target is not in that realm');
  }
  if (!realm || !(await mayRead(dbAdapter, realm, user))) {
    throw notFound();
  }
  let info = await realm.getRealmInfo();
  let context: SecureWindowContext = {
    realm: {
      url: realm.url,
      name: info.name,
      directWriter: await isDirectWriter(dbAdapter, new URL(realm.url), user),
    },
  };
  if (!target) {
    return context;
  }

  let codeRef: ResolvedCodeRef | undefined =
    target.kind === 'type'
      ? { module: target.module, name: target.name }
      : await instanceType(dbAdapter, realm, instanceURL!);
  if (!codeRef) {
    throw notFound();
  }
  // The definition is read as the owner of whichever realm holds its module,
  // so that realm must be one the user may read too.
  let moduleURL = servedURL(
    virtualNetwork,
    codeRef.module as RealmResourceIdentifier,
  );
  let moduleRealm = moduleURL ? realmHolding(realms, moduleURL) : undefined;
  if (!moduleRealm || !(await mayRead(dbAdapter, moduleRealm, user))) {
    throw notFound();
  }
  let definition;
  try {
    definition = await definitionLookup
      .forRealm(realm)
      .lookupDefinition(codeRef);
  } catch {
    throw notFound();
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
    throw notFound();
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

export interface WritableRealm {
  url: string;
  name: string;
}

// The realms this server serves that `user` is a direct writer of, by name:
// the realms they may share a key into. A direct writer's own permission row
// grants write; a `*` or `users` row, a bot account or a policy grant makes no
// one a direct writer.
export async function writableRealms(
  { dbAdapter, realms }: Pick<Deps, 'dbAdapter' | 'realms'>,
  user: string,
): Promise<WritableRealm[]> {
  if (isBotAccount(user)) {
    return [];
  }
  let rows = (await query(dbAdapter, [
    `SELECT realm_url FROM realm_user_permissions WHERE write = true AND username =`,
    param(user),
  ])) as { realm_url: string }[];
  let urls = new Set(rows.map((row) => row.realm_url));
  let found: WritableRealm[] = [];
  for (let realm of realms) {
    if (urls.has(realm.url)) {
      found.push({ url: realm.url, name: (await realm.getRealmInfo()).name });
    }
  }
  return found.sort(
    (a, b) => a.name.localeCompare(b.name) || a.url.localeCompare(b.url),
  );
}
