import { getDomain } from 'tldts';
import {
  codeRefWithAbsoluteIdentifier,
  fetchDirectWriterRealms,
  fetchRealmPermissions,
  isBotAccount,
  isDirectWriter,
  isPrefixForm,
  isResolvedCodeRef,
  param,
  query,
  type CodeRef,
  type DBAdapter,
  type Definition,
  type DefinitionLookup,
  type Realm,
  type RealmResourceIdentifier,
  type ResolvedCodeRef,
  type ServedRealm,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import { operationDisplayLabel } from '@cardstack/runtime-common/card-operations/label';
import { effectiveRealmPermissions } from '@cardstack/runtime-common/realm-permission-checker';
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
// They are resolved only through the VirtualNetwork, and the realm holding
// one is found as the server routes a request to it (`findRealm`), among every
// realm it serves, whether mounted yet or not.

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

export interface Deps {
  dbAdapter: DBAdapter;
  // The realm a URL is in, found among every realm this server serves,
  // mounted or not, and without mounting it (`findRealm`).
  findRealm: (url: URL) => Promise<ServedRealm | undefined>;
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

// The realm `id` names: its root, written with or without the trailing slash.
async function realmNamed(
  { findRealm, virtualNetwork }: Deps,
  id: RealmResourceIdentifier,
): Promise<ServedRealm | undefined> {
  let url = servedURL(virtualNetwork, id);
  if (!url) {
    return undefined;
  }
  let root = url.href.endsWith('/') ? url.href : `${url.href}/`;
  let found = await findRealm(new URL(root));
  return found?.url === root ? found : undefined;
}

// Read from the realm's permission rows, so a realm need not be mounted to be
// asked about, by the rule every realm request is checked by. A secure session
// is a registered Matrix user's, so the `users` row applies to it.
async function mayRead(
  dbAdapter: DBAdapter,
  realmURL: string,
  user: string,
): Promise<boolean> {
  let permissions = await fetchRealmPermissions(dbAdapter, new URL(realmURL));
  let actions = await effectiveRealmPermissions(
    permissions,
    user,
    async () => true,
  );
  return actions.includes('read');
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

// What a window's request names, resolved: the realm, mounted, and for a
// target, its type's definition and, for a card, the card's URL.
export interface ResolvedWindowRequest {
  realm: Realm;
  realmName: string;
  target?: {
    codeRef: ResolvedCodeRef;
    instanceURL?: URL;
    definition: Definition;
  };
}

// Resolves what a window's request names, answering 404 alike for anything
// the user can't read and anything that doesn't exist.
export async function resolveWindowRequest(
  deps: Deps,
  user: string,
  request: SecureWindowContextRequest,
): Promise<ResolvedWindowRequest> {
  let { dbAdapter, findRealm, definitionLookup, virtualNetwork } = deps;
  let notFound = () => new UserKeyError(404, NOT_FOUND);
  let { target } = request;

  // A realm is mounted only once the user is known to be able to read it.
  let served: ServedRealm | undefined;
  let instanceURL: URL | undefined;
  if (target?.kind === 'instance') {
    instanceURL = servedURL(virtualNetwork, target.url);
    served = instanceURL ? await findRealm(instanceURL) : undefined;
  } else {
    let named = target?.kind === 'type' ? target.realm : request.realm;
    served = named ? await realmNamed(deps, named) : undefined;
  }
  if (!served || !(await mayRead(dbAdapter, served.url, user))) {
    throw notFound();
  }
  // A realm named beside a target must be the target's own. Any other realm
  // answers as not found, so the answer says nothing about a realm the user
  // can't read.
  if (
    request.realm &&
    target &&
    (await realmNamed(deps, request.realm))?.url !== served.url
  ) {
    throw notFound();
  }
  let realm = await served.mount();
  if (!realm) {
    throw notFound();
  }
  let info = await realm.getRealmInfo();
  if (!target) {
    return { realm, realmName: info.name };
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
  let moduleRealm = moduleURL ? await findRealm(moduleURL) : undefined;
  if (!moduleRealm || !(await mayRead(dbAdapter, moduleRealm.url, user))) {
    throw notFound();
  }
  // The definition is looked up among mounted realms.
  if (!(await moduleRealm.mount())) {
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
  return {
    realm,
    realmName: info.name,
    target: { codeRef, instanceURL, definition },
  };
}

export async function secureWindowContext(
  deps: Deps,
  user: string,
  request: SecureWindowContextRequest,
): Promise<SecureWindowContext> {
  let { realm, realmName, target } = await resolveWindowRequest(
    deps,
    user,
    request,
  );
  let context: SecureWindowContext = {
    realm: {
      url: realm.url,
      name: realmName,
      directWriter: await isDirectWriter(
        deps.dbAdapter,
        new URL(realm.url),
        user,
      ),
    },
  };
  if (!target) {
    return context;
  }
  let { codeRef, definition } = target;
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

// What a realm is called before its `realm.json` is indexed, as a realm
// reports itself then.
const UNNAMED_REALM = 'Unnamed Workspace';

export interface WritableRealm {
  url: string;
  name: string;
}

// The realms this server serves that `user` is a direct writer of, by name:
// the realms they may share a key into, as `isDirectWriter` decides it. None
// of them is mounted to list it.
export async function writableRealms(
  { dbAdapter, findRealm }: Pick<Deps, 'dbAdapter' | 'findRealm'>,
  user: string,
): Promise<WritableRealm[]> {
  if (isBotAccount(user)) {
    return [];
  }
  let found: WritableRealm[] = [];
  for (let { url, name } of await fetchDirectWriterRealms(dbAdapter, user)) {
    // A permission row can outlive the realm it names.
    if ((await findRealm(new URL(url)))?.url === url) {
      found.push({ url, name: name ?? UNNAMED_REALM });
    }
  }
  return found.sort(
    (a, b) => a.name.localeCompare(b.name) || a.url.localeCompare(b.url),
  );
}

// The realms this server serves that `user` can read by a permission row of
// their own, by name: the realms they may approve a card's requests in. A
// realm readable by everyone isn't one of theirs, so it isn't listed. None of
// them is mounted to list it.
export async function readableRealms(
  { dbAdapter, findRealm }: Pick<Deps, 'dbAdapter' | 'findRealm'>,
  user: string,
): Promise<WritableRealm[]> {
  if (isBotAccount(user)) {
    return [];
  }
  let rows = (await query(dbAdapter, [
    `SELECT rup.realm_url,
            config.pristine_doc->'attributes'->'cardInfo'->>'name' AS name
     FROM realm_user_permissions rup
     LEFT JOIN realm_registry rr
       ON rr.url = rup.realm_url AND rr.kind = 'published'
     LEFT JOIN boxel_index config
       ON config.url = rup.realm_url || 'realm.json'
      AND config.realm_url = rup.realm_url
      AND config.type = 'instance'
      AND (config.is_deleted = FALSE OR config.is_deleted IS NULL)
     WHERE rr.url IS NULL AND rup.read = true AND rup.username =`,
    param(user),
    `AND rup.realm_url NOT IN (SELECT url FROM realm_metadata WHERE archived_at IS NOT NULL)
     ORDER BY rup.realm_url`,
  ])) as { realm_url: string; name: string | null }[];
  let found: WritableRealm[] = [];
  for (let { realm_url: url, name } of rows) {
    // A permission row can outlive the realm it names.
    if ((await findRealm(new URL(url)))?.url === url) {
      found.push({ url, name: name ?? UNNAMED_REALM });
    }
  }
  return found.sort(
    (a, b) => a.name.localeCompare(b.name) || a.url.localeCompare(b.url),
  );
}

export interface CardWithRequests {
  module: string;
  name: string;
  displayName: string;
}

// The most card types a realm's listing reads definitions for.
const MAX_LISTED_TYPES = 200;

// The card definitions the realm's cards adopt from that declare a `callApi`
// operation sending the caller's own key (`{{userKey}}`), by display name:
// the cards whose requests one of the user's keys can be approved for there.
// Each definition is read from the definition cache, and only from a realm
// the user may read.
export async function realmCardsWithRequests(
  deps: Deps,
  user: string,
  realmId: RealmResourceIdentifier,
): Promise<CardWithRequests[]> {
  let { dbAdapter, findRealm, definitionLookup, virtualNetwork } = deps;
  let { realm } = await resolveWindowRequest(deps, user, { realm: realmId });
  let rows = (await query(dbAdapter, [
    `SELECT DISTINCT url, pristine_doc->'meta'->'adoptsFrom' AS adopts_from
       FROM boxel_index
      WHERE realm_url =`,
    param(realm.url),
    `AND type = 'instance' AND (is_deleted = FALSE OR is_deleted IS NULL)
        AND pristine_doc->'meta'->'adoptsFrom' IS NOT NULL`,
  ])) as { url: string; adopts_from: CodeRef | string | null }[];
  let types = new Map<string, ResolvedCodeRef>();
  for (let { url, adopts_from } of rows) {
    let adoptsFrom =
      typeof adopts_from === 'string' ? JSON.parse(adopts_from) : adopts_from;
    if (!adoptsFrom) {
      continue;
    }
    let absolute = codeRefWithAbsoluteIdentifier(
      adoptsFrom,
      url as RealmResourceIdentifier,
      undefined,
    );
    if (isResolvedCodeRef(absolute)) {
      types.set(`${absolute.module}#${absolute.name}`, absolute);
    }
    if (types.size >= MAX_LISTED_TYPES) {
      break;
    }
  }
  let readable = new Map<string, boolean>();
  let found: CardWithRequests[] = [];
  for (let codeRef of types.values()) {
    let moduleURL = servedURL(
      virtualNetwork,
      codeRef.module as RealmResourceIdentifier,
    );
    let moduleRealm = moduleURL ? await findRealm(moduleURL) : undefined;
    if (!moduleRealm) {
      continue;
    }
    if (!readable.has(moduleRealm.url)) {
      readable.set(
        moduleRealm.url,
        (await mayRead(dbAdapter, moduleRealm.url, user)) &&
          Boolean(await moduleRealm.mount()),
      );
    }
    if (!readable.get(moduleRealm.url)) {
      continue;
    }
    let definition;
    try {
      definition = await definitionLookup
        .forRealm(realm)
        .lookupDefinition(codeRef);
    } catch {
      continue;
    }
    let sendsUserKey = Object.values(definition.operations ?? {}).some(
      (operation) =>
        operation.base === 'callApi' &&
        !operation.invalid &&
        operation.callApi?.slots.some((slot) => slot.key === 'userKey'),
    );
    if (sendsUserKey) {
      found.push({
        module: virtualNetwork.unresolveURL(String(codeRef.module)),
        name: codeRef.name,
        displayName: definition.displayName ?? codeRef.name,
      });
    }
  }
  return found.sort(
    (a, b) =>
      a.displayName.localeCompare(b.displayName) ||
      a.module.localeCompare(b.module) ||
      a.name.localeCompare(b.name),
  );
}
