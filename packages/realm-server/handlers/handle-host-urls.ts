import type Koa from 'koa';
import {
  dbAdapterQuerier,
  deriveRealmName,
  fetchRealmOwnerUserId,
  fetchRealmPermissions,
  isRealmAdministrator,
  logger,
  param,
  publishedSpaceSubdomain,
  query,
  SupportedMimeType,
  type DBAdapter,
  type Querier,
} from '@cardstack/runtime-common';
import { getMatrixUsername } from '@cardstack/runtime-common/matrix-client';
import { getUserByMatrixUserId } from '@cardstack/billing/billing-queries';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForError,
  sendResponseForForbiddenRequest,
  sendResponseForNotFound,
  sendResponseForSystemError,
  sendResponseForUnprocessableEntity,
  setContextResponse,
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import { normalizeRealmURL } from '../utils/realm-url.ts';
import { domainHostFromKey } from '../lib/domain-host.ts';
import { announceHostURLChanges } from '../lib/realm-host-urls.ts';
import type {
  AcceptedHostURL,
  HostURLKind,
} from '../lib/realm-host-urls-domains.ts';
import {
  checkAnonymousHomePage,
  type AnonymousHomePageReport,
} from '../lib/anonymous-home-page.ts';

// The endpoints that list, add (mount) and remove (unmount) a realm's host
// URLs, and mark one canonical (ADR 033). Each change is stored, then
// announced, before the response is sent, so it takes effect at once
// (ADR 033 §1.3).
//
//   GET    /_host-urls?realm=<realm URL>  the realm's host URLs
//   POST   /_host-urls                    mount: add a host URL
//   PATCH  /_host-urls/:id                mark a host URL canonical
//   DELETE /_host-urls/:id                unmount: remove a host URL
//
// A host URL is a JSON:API resource of type `host-url`:
//
//   { "type": "host-url", "id": "<uuid>",
//     "attributes": { "realmURL": "...", "url": "...",
//                     "kind": "boxel-space" | "site-name" | "custom-domain",
//                     "isCanonical": true } }
//
// Only an administrator of the realm, a user whose own permission row grants
// `write`, may use them. A grant in the realm's policy does not admit them
// (ADR 033 §1.6).

const log = logger('realm-server:host-urls');

const HOST_URL_TYPE = 'host-url';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface HostURLRow {
  id: string;
  realm_id: string;
  kind: HostURLKind;
  host: string;
  path_prefix: string;
  is_canonical: boolean;
}

interface RealmRow {
  id: string;
  url: string;
  kind: string;
}

type Outcome<T> = { ok: T } | { status: number; message: string };

export function handleListHostURLs(
  args: CreateRoutesArgs,
): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context) {
    try {
      let rawRealmURL = ctxt.query.realm;
      let realmURL =
        typeof rawRealmURL === 'string' ? normalizeRealmURL(rawRealmURL) : null;
      if (!realmURL) {
        await sendResponseForBadRequest(
          ctxt,
          'The realm query parameter must be a realm URL',
        );
        return;
      }
      let realm = await administeredRealm(ctxt, args, realmURL.href);
      if (!realm) {
        return;
      }
      let rows = await hostURLsOf(dbAdapterQuerier(args.dbAdapter), realm.id);
      await sendDocument(ctxt, 200, {
        data: rows.map((row) => serialize(row, realm.url, args.serverURL)),
      });
    } catch (error) {
      log.error('Error listing host URLs:', error);
      await sendResponseForSystemError(ctxt, 'Internal server error', error);
    }
  };
}

export function handleMountHostURL(
  args: CreateRoutesArgs,
): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  let { dbAdapter, hostURLDomains, hostURLResolver, reconciler } = args;
  return async function (ctxt: Koa.Context) {
    try {
      let body = await jsonBody(ctxt);
      if (!body) {
        return;
      }
      let attributes = resourceAttributes(body);
      if (
        !attributes ||
        typeof attributes.realmURL !== 'string' ||
        typeof attributes.url !== 'string'
      ) {
        await sendResponseForBadRequest(
          ctxt,
          `The request body must be a ${HOST_URL_TYPE} resource with the attributes realmURL and url`,
        );
        return;
      }
      let realmURL = normalizeRealmURL(attributes.realmURL);
      if (!realmURL) {
        await sendResponseForBadRequest(ctxt, 'realmURL is not a valid URL');
        return;
      }
      let hostURL: URL;
      try {
        hostURL = new URL(attributes.url);
      } catch {
        await sendResponseForBadRequest(ctxt, 'url is not a valid URL');
        return;
      }

      let realm = await administeredRealm(ctxt, args, realmURL.href);
      if (!realm) {
        return;
      }
      if (realm.kind !== 'source') {
        await sendResponseForUnprocessableEntity(
          ctxt,
          `Realm ${realm.url} is not a realm that can be mounted at a host URL`,
        );
        return;
      }

      let check = hostURLDomains.check(hostURL, realm.url);
      if ('refused' in check) {
        await sendResponseForUnprocessableEntity(ctxt, check.refused);
        return;
      }
      let accepted = check.accepted;

      if (accepted.kind === 'boxel-space') {
        let refused = await boxelSpaceRefusal(args, realm, accepted);
        if (refused) {
          await sendResponseForUnprocessableEntity(ctxt, refused);
          return;
        }
      }

      // While v1 published realms exist, an address can be one's URL. A host
      // URL there would hide the published realm without removing it.
      if (await isPublishedRealmAddress(dbAdapter, accepted)) {
        await sendResponseForError(
          ctxt,
          409,
          'Conflict',
          `A published realm is served at ${accepted.host}${accepted.pathPrefix}. Unpublish it before you mount a realm there.`,
        );
        return;
      }

      let mounted = await reconciler.lookupOrMount(realm.url);
      if (!mounted) {
        await sendResponseForNotFound(ctxt, `Realm not found: ${realm.url}`);
        return;
      }
      let report = await checkAnonymousHomePage(mounted);
      if (!report.anonymousCanView) {
        await sendResponseForUnprocessableEntity(ctxt, homePageRefusal(report));
        return;
      }

      let token = ctxt.state.token as RealmServerTokenClaim;
      let outcome = await changeHostURLs(
        dbAdapter,
        realm.id,
        async (q): Promise<Outcome<HostURLRow>> => {
          if (accepted.kind === 'site-name') {
            let bound = await bindSiteName(
              q,
              dbAdapter,
              token.user,
              realm,
              accepted.host,
            );
            if ('status' in bound) {
              return bound;
            }
          }
          // The realm's first host URL is canonical (ADR 033 §1.4).
          let existing = await hostURLsOf(q, realm.id);
          let rows = (await q([
            `INSERT INTO realm_host_urls (realm_id, kind, host, path_prefix, is_canonical, created_by) VALUES (`,
            param(realm.id),
            `,`,
            param(accepted.kind),
            `,`,
            param(accepted.host),
            `,`,
            param(accepted.pathPrefix),
            `,`,
            param(existing.length === 0),
            `,`,
            param(token.user),
            `) ON CONFLICT (host, path_prefix) DO NOTHING`,
            `RETURNING id, realm_id, kind, host, path_prefix, is_canonical`,
          ])) as unknown as HostURLRow[];
          if (rows.length === 0) {
            let isThisRealms = existing.some(
              (row) =>
                row.host === accepted.host &&
                row.path_prefix === accepted.pathPrefix,
            );
            return {
              status: 409,
              message: isThisRealms
                ? `The realm is already mounted at ${accepted.host}${accepted.pathPrefix}`
                : `Another realm is mounted at ${accepted.host}${accepted.pathPrefix}`,
            };
          }
          return { ok: rows[0] };
        },
      );
      if ('status' in outcome) {
        await sendResponseForError(
          ctxt,
          outcome.status,
          statusText(outcome.status),
          outcome.message,
        );
        return;
      }
      await announceHostURLChanges(dbAdapter, hostURLResolver, [
        outcome.ok.host,
      ]);
      await sendDocument(ctxt, 201, {
        data: serialize(outcome.ok, realm.url, args.serverURL),
      });
    } catch (error) {
      log.error('Error mounting a host URL:', error);
      await sendResponseForSystemError(ctxt, 'Internal server error', error);
    }
  };
}

export function handleSetCanonicalHostURL(
  args: CreateRoutesArgs,
): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  let { dbAdapter, hostURLResolver } = args;
  return async function (ctxt: Koa.Context) {
    try {
      let body = await jsonBody(ctxt);
      if (!body) {
        return;
      }
      let attributes = resourceAttributes(body);
      if (!attributes || attributes.isCanonical !== true) {
        await sendResponseForBadRequest(
          ctxt,
          `The request body must be a ${HOST_URL_TYPE} resource with the attribute isCanonical set to true. To stop a host URL being canonical, mark another one canonical.`,
        );
        return;
      }
      let target = await administeredHostURL(ctxt, args);
      if (!target) {
        return;
      }
      let { realm, hostURL } = target;
      let outcome = await changeHostURLs(
        dbAdapter,
        realm.id,
        async (q): Promise<Outcome<HostURLRow[]>> => {
          await q([
            `UPDATE realm_host_urls SET is_canonical = false WHERE is_canonical AND realm_id =`,
            param(realm.id),
            `AND id <>`,
            param(hostURL.id),
          ]);
          let updated = await q([
            `UPDATE realm_host_urls SET is_canonical = true WHERE id =`,
            param(hostURL.id),
            `RETURNING id`,
          ]);
          if (updated.length === 0) {
            return { status: 404, message: 'Host URL not found' };
          }
          return { ok: await hostURLsOf(q, realm.id) };
        },
      );
      if ('status' in outcome) {
        await sendResponseForNotFound(ctxt, outcome.message);
        return;
      }
      // Each host's entries name the realm's canonical host URL, so every
      // host of the realm changed.
      await announceHostURLChanges(
        dbAdapter,
        hostURLResolver,
        outcome.ok.map((row) => row.host),
      );
      let row = outcome.ok.find(({ id }) => id === hostURL.id)!;
      await sendDocument(ctxt, 200, {
        data: serialize(row, realm.url, args.serverURL),
      });
    } catch (error) {
      log.error('Error marking a host URL canonical:', error);
      await sendResponseForSystemError(ctxt, 'Internal server error', error);
    }
  };
}

export function handleUnmountHostURL(
  args: CreateRoutesArgs,
): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  let { dbAdapter, hostURLResolver } = args;
  return async function (ctxt: Koa.Context) {
    try {
      let target = await administeredHostURL(ctxt, args);
      if (!target) {
        return;
      }
      let { realm, hostURL } = target;
      let outcome = await changeHostURLs(
        dbAdapter,
        realm.id,
        async (q): Promise<Outcome<HostURLRow>> => {
          let rows = await hostURLsOf(q, realm.id);
          let row = rows.find(({ id }) => id === hostURL.id);
          if (!row) {
            return { status: 404, message: 'Host URL not found' };
          }
          // The canonical host URL goes last (ADR 033 §1.4).
          if (row.is_canonical && rows.length > 1) {
            return {
              status: 422,
              message:
                'This host URL is canonical. Mark another host URL canonical before you remove this one.',
            };
          }
          await q([`DELETE FROM realm_host_urls WHERE id =`, param(row.id)]);
          // A removed site name is free for anyone to claim. Only the claim
          // bound to this realm is released, never another user's claim on
          // the same name.
          if (row.kind === 'site-name') {
            await q([
              `UPDATE claimed_domains_for_sites SET removed_at =`,
              param(Math.floor(Date.now() / 1000)),
              `WHERE removed_at IS NULL AND realm_id =`,
              param(row.realm_id),
              `AND hostname IN (`,
              param(row.host),
              `,`,
              param(domainHostFromKey(row.host).hostname),
              `)`,
            ]);
          }
          return { ok: row };
        },
      );
      if ('status' in outcome) {
        await sendResponseForError(
          ctxt,
          outcome.status,
          statusText(outcome.status),
          outcome.message,
        );
        return;
      }
      await announceHostURLChanges(dbAdapter, hostURLResolver, [
        outcome.ok.host,
      ]);
      await setContextResponse(ctxt, new Response(null, { status: 204 }));
    } catch (error) {
      log.error('Error unmounting a host URL:', error);
      await sendResponseForSystemError(ctxt, 'Internal server error', error);
    }
  };
}

// Host URL changes for one realm are serialized on their own key, not on the
// realm's write lock, so they never wait for the realm's file writes. A
// realm delete still can't leave a host URL behind: the row's foreign key on
// the registry makes a mount that races it fail.
function hostURLsLockKey(realmId: string): string {
  return `host-urls:${realmId}`;
}

class RefusedChange<T> extends Error {
  readonly outcome: Outcome<T>;
  constructor(outcome: Outcome<T>) {
    super('The host URL change was refused');
    this.outcome = outcome;
  }
}

// Runs `fn` in one transaction, holding the realm's host-URL lock. A refused
// outcome rolls the transaction back, so a refusal never commits a write `fn`
// made before it refused: a site name bound before a mount at it lost to a
// conflict, or the canonical mark cleared before its target turned out to be
// gone.
async function changeHostURLs<T>(
  dbAdapter: DBAdapter,
  realmId: string,
  fn: (q: Querier) => Promise<Outcome<T>>,
): Promise<Outcome<T>> {
  try {
    return await dbAdapter.withWriteLock(
      hostURLsLockKey(realmId),
      async (txQuerier) => {
        let outcome = await fn(txQuerier ?? dbAdapterQuerier(dbAdapter));
        if ('status' in outcome) {
          throw new RefusedChange(outcome);
        }
        return outcome;
      },
    );
  } catch (error) {
    if (error instanceof RefusedChange) {
      return error.outcome as Outcome<T>;
    }
    throw error;
  }
}

// The realm at `realmURL`, when the caller administers it. Otherwise answers
// the request and returns undefined.
async function administeredRealm(
  ctxt: Koa.Context,
  { dbAdapter, matrixClient, serverURL }: CreateRoutesArgs,
  realmURL: string,
): Promise<RealmRow | undefined> {
  let token = ctxt.state.token as RealmServerTokenClaim | undefined;
  if (!token) {
    await sendResponseForSystemError(ctxt, 'token is required');
    return undefined;
  }
  let [realm] = (await query(dbAdapter, [
    `SELECT id, url, kind FROM realm_registry WHERE url =`,
    param(realmURL),
  ])) as unknown as RealmRow[];
  if (!realm) {
    await sendResponseForNotFound(ctxt, `Realm not found: ${realmURL}`);
    return undefined;
  }
  let permissions = await fetchRealmPermissions(dbAdapter, new URL(realm.url));
  if (
    !isRealmAdministrator(
      permissions,
      token.user,
      matrixClient.serverName,
      new URL(realm.url),
      new URL(serverURL),
    )
  ) {
    await sendResponseForForbiddenRequest(
      ctxt,
      `${token.user} does not have enough permission to manage the host URLs of this realm`,
    );
    return undefined;
  }
  return realm;
}

// The host URL `:id` names, and its realm, when the caller administers the
// realm. Otherwise answers the request and returns undefined.
async function administeredHostURL(
  ctxt: Koa.Context,
  args: CreateRoutesArgs,
): Promise<{ realm: RealmRow; hostURL: HostURLRow } | undefined> {
  let id = ctxt.params.id as string | undefined;
  if (!id || !UUID_RE.test(id)) {
    await sendResponseForNotFound(ctxt, 'Host URL not found');
    return undefined;
  }
  let [row] = (await query(args.dbAdapter, [
    `SELECT h.id, h.realm_id, h.kind, h.host, h.path_prefix, h.is_canonical, r.url AS realm_url`,
    `FROM realm_host_urls h JOIN realm_registry r ON r.id = h.realm_id`,
    `WHERE h.id =`,
    param(id),
  ])) as unknown as (HostURLRow & { realm_url: string })[];
  if (!row) {
    await sendResponseForNotFound(ctxt, 'Host URL not found');
    return undefined;
  }
  let realm = await administeredRealm(ctxt, args, row.realm_url);
  if (!realm) {
    return undefined;
  }
  return { realm, hostURL: row };
}

async function hostURLsOf(q: Querier, realmId: string): Promise<HostURLRow[]> {
  return (await q([
    `SELECT id, realm_id, kind, host, path_prefix, is_canonical FROM realm_host_urls WHERE realm_id =`,
    param(realmId),
    `ORDER BY created_at, id`,
  ])) as unknown as HostURLRow[];
}

// A Boxel Space host URL is the realm's own name under its owner's Space
// (ADR 033 §1.6). Undefined when it is.
async function boxelSpaceRefusal(
  { dbAdapter, matrixClient }: CreateRoutesArgs,
  realm: RealmRow,
  accepted: Extract<AcceptedHostURL, { kind: 'boxel-space' }>,
): Promise<string | undefined> {
  let owner = await fetchRealmOwnerUserId(
    dbAdapter,
    realm.url,
    matrixClient.serverName,
  );
  if (!owner) {
    return 'The realm has no owner, so it has no Boxel Space to be mounted in';
  }
  let ownerSubdomain = publishedSpaceSubdomain(getMatrixUsername(owner));
  if (accepted.subdomain !== ownerSubdomain) {
    return `A Boxel Space host URL must be in the realm owner's Space, ${ownerSubdomain}`;
  }
  let realmName = deriveRealmName(realm.url);
  if (accepted.pathPrefix !== `/${realmName}/`) {
    return `A Boxel Space host URL must be at the realm's name, /${realmName}/`;
  }
  return undefined;
}

// A site name must be claimed by the caller, or already bound to this realm
// (ADR 033 §1.6). Mounting at a site name the caller claimed binds the claim
// to this realm. The claims are locked until the transaction ends, so a claim
// released while the mount runs is either seen as released here, or waits for
// the mount and then sees its host URL.
async function bindSiteName(
  q: Querier,
  dbAdapter: DBAdapter,
  matrixUserId: string,
  realm: RealmRow,
  host: string,
): Promise<Outcome<true>> {
  let claims = (await q([
    `SELECT id, user_id, realm_id FROM claimed_domains_for_sites WHERE removed_at IS NULL AND hostname IN (`,
    param(host),
    `,`,
    param(domainHostFromKey(host).hostname),
    `) FOR UPDATE`,
  ])) as { id: string; user_id: string; realm_id: string | null }[];
  if (claims.some((claim) => claim.realm_id === realm.id)) {
    return { ok: true };
  }
  let user = await getUserByMatrixUserId(dbAdapter, matrixUserId);
  let own = user
    ? claims.find((claim) => claim.user_id === user.id)
    : undefined;
  if (!own) {
    return {
      status: 422,
      message:
        claims.length > 0
          ? `The site name ${host} is claimed by another user`
          : `The site name ${host} is not claimed. Claim it before you mount a realm there.`,
    };
  }
  await q([
    `UPDATE claimed_domains_for_sites SET realm_id =`,
    param(realm.id),
    `, source_realm_url =`,
    param(realm.url),
    `WHERE id =`,
    param(own.id),
  ]);
  return { ok: true };
}

async function isPublishedRealmAddress(
  dbAdapter: DBAdapter,
  accepted: AcceptedHostURL,
): Promise<boolean> {
  let address = `${accepted.host}${accepted.pathPrefix}`;
  let rows = await query(dbAdapter, [
    `SELECT 1 AS found FROM realm_registry WHERE kind = 'published' AND url IN (`,
    param(`https://${address}`),
    `,`,
    param(`http://${address}`),
    `)`,
  ]);
  return rows.length > 0;
}

// Names what keeps a visitor who isn't signed in from seeing the realm's
// home page.
function homePageRefusal(report: AnonymousHomePageReport): string {
  if (report.redirectTo) {
    return `The realm can't be mounted: its root redirects to ${report.redirectTo}, so it serves no home page.`;
  }
  let missing: string[] = [];
  if (!report.homeCardReadable) {
    missing.push(
      `read its home card ${report.homeCardId} (the realm answered ${report.homeCardStatus})`,
    );
  }
  if (report.unloadableModules.length > 0) {
    missing.push(
      `load the home card's code: ${report.unloadableModules
        .map(({ url, status }) => `${url} (the realm answered ${status})`)
        .join(', ')}`,
    );
  }
  return `The realm can't be mounted: a visitor who is not signed in can't ${missing.join(', or ')}. Let visitors who are not signed in read the home card and its modules first.`;
}

function serialize(row: HostURLRow, realmURL: string, serverURL: string) {
  let protocol = new URL(serverURL).protocol;
  return {
    type: HOST_URL_TYPE,
    id: row.id,
    attributes: {
      realmURL,
      url: `${protocol}//${row.host}${row.path_prefix}`,
      kind: row.kind,
      isCanonical: Boolean(row.is_canonical),
    },
  };
}

async function jsonBody(
  ctxt: Koa.Context,
): Promise<Record<string, unknown> | undefined> {
  let request = await fetchRequestFromContext(ctxt);
  try {
    let json = JSON.parse(await request.text());
    if (json && typeof json === 'object' && !Array.isArray(json)) {
      return json;
    }
  } catch {
    // answered below
  }
  await sendResponseForBadRequest(ctxt, 'Request body is not valid JSON');
  return undefined;
}

function resourceAttributes(
  body: Record<string, unknown>,
): Record<string, unknown> | undefined {
  let data = body.data as Record<string, unknown> | undefined;
  if (
    !data ||
    typeof data !== 'object' ||
    data.type !== HOST_URL_TYPE ||
    !data.attributes ||
    typeof data.attributes !== 'object'
  ) {
    return undefined;
  }
  return data.attributes as Record<string, unknown>;
}

function statusText(status: number): string {
  switch (status) {
    case 404:
      return 'Not Found';
    case 409:
      return 'Conflict';
    default:
      return 'Unprocessable Entity';
  }
}

async function sendDocument(
  ctxt: Koa.Context,
  status: number,
  document: unknown,
): Promise<void> {
  await setContextResponse(
    ctxt,
    new Response(JSON.stringify(document, null, 2), {
      status,
      headers: { 'content-type': SupportedMimeType.JSONAPI },
    }),
  );
}
