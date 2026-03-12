import type Koa from 'koa';
import {
  asExpressions,
  fetchRealmPermissions,
  getMatrixUsername,
  param,
  PUBLISHED_DIRECTORY_NAME,
  query,
  removeRealmPermissions,
  SupportedMimeType,
  type PublishedRealmTable,
  update,
} from '@cardstack/runtime-common';
import { join } from 'path';
import * as Sentry from '@sentry/node';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForForbiddenRequest,
  sendResponseForNotFound,
  sendResponseForSystemError,
  sendResponseForUnprocessableEntity,
  setContextResponse,
} from '../middleware';
import type { CreateRoutesArgs } from '../routes';
import type { RealmServerTokenClaim } from '../utils/jwt';
import { removeMountedRealm } from './realm-destruction-utils';

interface DeleteRealmJSON {
  data: {
    type: 'realm';
    id: string;
  };
}

export default function handleDeleteRealm({
  dbAdapter,
  realms,
  realmsRootPath,
  virtualNetwork,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let token = ctxt.state.token as RealmServerTokenClaim;
    if (!token) {
      await sendResponseForSystemError(
        ctxt,
        'token is required to delete realm',
      );
      return;
    }

    let request = await fetchRequestFromContext(ctxt);
    let body = await request.text();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(body);
    } catch (_error) {
      await sendResponseForBadRequest(
        ctxt,
        'Request body is not valid JSON-API - invalid JSON',
      );
      return;
    }

    try {
      assertIsDeleteRealmJSON(json);
    } catch (error: any) {
      await sendResponseForBadRequest(
        ctxt,
        `Request body is not valid JSON-API - ${error.message}`,
      );
      return;
    }

    let realmURL = json.data.id.endsWith('/')
      ? json.data.id
      : `${json.data.id}/`;

    try {
      let sourceRealm = realms.find(
        (realm) => ensureTrailingSlash(realm.url) === realmURL,
      );
      if (!sourceRealm) {
        await sendResponseForNotFound(ctxt, `Realm not found: ${realmURL}`);
        return;
      }

      let publishedRealmMatch = (await query(dbAdapter, [
        `SELECT id FROM published_realms WHERE published_realm_url =`,
        param(realmURL),
      ])) as Pick<PublishedRealmTable, 'id'>[];
      if (publishedRealmMatch.length > 0) {
        await sendResponseForUnprocessableEntity(
          ctxt,
          'Published realms cannot be deleted directly',
        );
        return;
      }

      let permissions = await fetchRealmPermissions(
        dbAdapter,
        new URL(realmURL),
      );
      let { user: ownerUserId } = token;
      if (!permissions[ownerUserId]?.includes('realm-owner')) {
        await sendResponseForForbiddenRequest(
          ctxt,
          `${ownerUserId} does not have enough permission to delete this realm`,
        );
        return;
      }

      let ownerNamespace = getRealmNamespace(realmURL);
      if (
        !ownerNamespace ||
        ownerNamespace !== getMatrixUsername(ownerUserId)
      ) {
        await sendResponseForForbiddenRequest(
          ctxt,
          'You can only delete realms that you created',
        );
        return;
      }

      if (!sourceRealm.dir) {
        await sendResponseForNotFound(
          ctxt,
          `Realm files not found on disk for ${realmURL}`,
        );
        return;
      }

      let publishedRealms = (await query(dbAdapter, [
        `SELECT id, published_realm_url FROM published_realms WHERE source_realm_url =`,
        param(realmURL),
      ])) as Pick<PublishedRealmTable, 'id' | 'published_realm_url'>[];

      for (let publishedRealm of publishedRealms) {
        let mountedPublishedRealm = realms.find(
          (realm) =>
            ensureTrailingSlash(realm.url) ===
            ensureTrailingSlash(publishedRealm.published_realm_url),
        );
        if (!mountedPublishedRealm) {
          throw new Error(
            `No realm instance found for published realm ${publishedRealm.published_realm_url}`,
          );
        }

        let publishedRealmPath = join(
          realmsRootPath,
          PUBLISHED_DIRECTORY_NAME,
          publishedRealm.id,
        );
        await removeMountedRealm({
          realm: mountedPublishedRealm,
          realmPath: publishedRealmPath,
          realms,
          virtualNetwork,
        });
        await removeRealmPermissions(
          dbAdapter,
          new URL(publishedRealm.published_realm_url),
        );
      }

      await query(dbAdapter, [
        `DELETE FROM published_realms WHERE source_realm_url =`,
        param(realmURL),
      ]);

      let { nameExpressions, valueExpressions } = asExpressions({
        removed_at: Math.floor(Date.now() / 1000),
      });
      await query(dbAdapter, [
        ...update(
          'claimed_domains_for_sites',
          nameExpressions,
          valueExpressions,
        ),
        ` WHERE source_realm_url = `,
        param(realmURL),
        ` AND removed_at IS NULL`,
      ]);

      await removeMountedRealm({
        realm: sourceRealm,
        realmPath: sourceRealm.dir,
        realms,
        virtualNetwork,
      });
      await removeRealmPermissions(dbAdapter, new URL(realmURL));

      await setContextResponse(
        ctxt,
        new Response(null, {
          status: 204,
          headers: {
            'content-type': SupportedMimeType.JSONAPI,
          },
        }),
      );
    } catch (error: any) {
      Sentry.captureException(error);
      await sendResponseForSystemError(ctxt, error.message);
    }
  };
}

function assertIsDeleteRealmJSON(
  json: unknown,
): asserts json is DeleteRealmJSON {
  if (typeof json !== 'object' || json == null) {
    throw new Error('json must be an object');
  }
  if (!('data' in json) || typeof json.data !== 'object' || json.data == null) {
    throw new Error('json is missing "data" object');
  }
  let { data } = json;
  if (!('type' in data) || data.type !== 'realm') {
    throw new Error('json.data.type must be "realm"');
  }
  if (!('id' in data) || typeof data.id !== 'string') {
    throw new Error('json.data.id is required and must be a string');
  }
}

function ensureTrailingSlash(url: string) {
  return url.endsWith('/') ? url : `${url}/`;
}

function getRealmNamespace(realmURL: string): string | null {
  let segments = new URL(realmURL).pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    return null;
  }
  return segments[segments.length - 2] ?? null;
}
