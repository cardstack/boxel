import type Koa from 'koa';
import {
  ensureTrailingSlash,
  fetchRealmPermissions,
  type DBAdapter,
  type RealmPermissions,
} from '@cardstack/runtime-common';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForForbiddenRequest,
  sendResponseForUnprocessableEntity,
  sendResponseForSystemError,
} from '../middleware/index.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';

export interface ArchiveTarget {
  realmURL: string;
  ownerUserId: string;
  permissions: RealmPermissions;
}

// Parse the JSON:API body, resolve the target realm URL, and authorize the
// request for both archive and unarchive. Returns the resolved target, or
// null after writing the appropriate error response (caller should return).
//
// Authorization rules (shared by both endpoints):
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
  if (typeof realmId !== 'string' || realmId.length === 0) {
    await sendResponseForBadRequest(
      ctxt,
      'Request body must be JSON-API with { data: { type: "realm", id: <realmURL> } }',
    );
    return null;
  }

  let realmURL = ensureTrailingSlash(realmId);
  let { user: ownerUserId } = token;
  let permissions = await fetchRealmPermissions(dbAdapter, new URL(realmURL));

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

  return { realmURL, ownerUserId, permissions };
}
