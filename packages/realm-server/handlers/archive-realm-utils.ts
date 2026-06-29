import type Koa from 'koa';
import {
  fetchRealmPermissions,
  param,
  query,
  type DBAdapter,
  type RealmPermissions,
} from '@cardstack/runtime-common';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForForbiddenRequest,
  sendResponseForNotFound,
  sendResponseForUnprocessableEntity,
  sendResponseForSystemError,
} from '../middleware/index.ts';
import { normalizeRealmURL } from '../utils/realm-url.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';

export interface ArchiveTarget {
  realmURL: string;
  permissions: RealmPermissions;
}

// Parse the JSON:API body, resolve the target realm URL, and authorize the
// request for both archive and unarchive. Returns the resolved target, or
// null after writing the appropriate error response (caller should return).
//
// Rules (shared by both endpoints):
//   - body id must be a valid realm URL, else 400;
//   - a source realm_registry row must exist for it, else 404 (a permission
//     row alone is not proof the realm exists — a stale/manual realm-owner
//     grant must not let an arbitrary URL be archived);
//   - published/bootstrap realms are not archivable, else 422;
//   - requester must be a realm-owner of the target realm, else 403;
//   - public/catalog realms (world-readable) are not archivable, else 422.
export async function resolveAndAuthorizeArchiveTarget(
  ctxt: Koa.Context,
  dbAdapter: DBAdapter,
  action: 'archive' | 'unarchive',
): Promise<ArchiveTarget | null> {
  let token = ctxt.state.token as RealmServerTokenClaim;
  if (!token) {
    await sendResponseForSystemError(
      ctxt,
      `token is required to ${action} realm`,
    );
    return null;
  }

  let request = await fetchRequestFromContext(ctxt);
  let body = await request.text();
  let json: Record<string, any>;
  try {
    json = JSON.parse(body);
  } catch (e) {
    await sendResponseForBadRequest(
      ctxt,
      'Request body is not valid JSON-API - invalid JSON',
    );
    return null;
  }

  let realmId = json?.data?.id;
  if (
    json?.data?.type !== 'realm' ||
    typeof realmId !== 'string' ||
    realmId.length === 0
  ) {
    await sendResponseForBadRequest(
      ctxt,
      'Request body must be JSON-API with { data: { type: "realm", id: <realmURL> } }',
    );
    return null;
  }

  // Normalize through the shared realm-URL normalizer (strips query/fragment,
  // exactly one trailing slash) so the lookup hits the canonical
  // realm_registry / realm_user_permissions / realm_metadata rows. Returns
  // null for an invalid URL → 400 rather than throwing a system error.
  let parsedRealmURL = normalizeRealmURL(realmId);
  if (!parsedRealmURL) {
    await sendResponseForBadRequest(
      ctxt,
      `Invalid realm URL supplied: ${realmId}`,
    );
    return null;
  }
  let realmURL = parsedRealmURL.href;

  // realm_registry is the source of truth for realm existence. Only source
  // realms are archivable: published snapshots and bootstrap (base/catalog)
  // realms are not.
  let registryRow = (await query(dbAdapter, [
    `SELECT kind FROM realm_registry WHERE url =`,
    param(realmURL),
  ])) as { kind: string }[];
  if (registryRow.length === 0) {
    await sendResponseForNotFound(ctxt, `Realm not found: ${realmURL}`);
    return null;
  }
  if (registryRow[0].kind !== 'source') {
    await sendResponseForUnprocessableEntity(
      ctxt,
      `Realm ${realmURL} is a ${registryRow[0].kind} realm and cannot be ${action}d`,
    );
    return null;
  }

  let { user: ownerUserId } = token;
  let permissions = await fetchRealmPermissions(dbAdapter, parsedRealmURL);

  if (!permissions[ownerUserId]?.includes('realm-owner')) {
    await sendResponseForForbiddenRequest(
      ctxt,
      `${ownerUserId} does not have enough permission to ${action} realm ${realmURL}`,
    );
    return null;
  }

  // Public/catalog realms are world-readable; archiving would hide a shared
  // resource, so reject them.
  if (permissions['*']?.includes('read')) {
    await sendResponseForUnprocessableEntity(
      ctxt,
      `Realm ${realmURL} is public and cannot be ${action}d`,
    );
    return null;
  }

  return { realmURL, permissions };
}
