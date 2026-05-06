import type Koa from 'koa';
import {
  createResponse,
  query,
  SupportedMimeType,
  logger,
  param,
  removeRealmPermissions,
  type PublishedRealmTable,
  fetchRealmPermissions,
  PUBLISHED_DIRECTORY_NAME,
} from '@cardstack/runtime-common';
import { join } from 'path';
import * as Sentry from '@sentry/node';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForUnprocessableEntity,
  sendResponseForForbiddenRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware';
import type { CreateRoutesArgs } from '../routes';
import type { RealmServerTokenClaim } from '../utils/jwt';
import type { Realm } from '@cardstack/runtime-common';
import {
  collectAllFilePaths,
  removeRealmFiles,
} from './realm-destruction-utils';
import { deleteFromRegistryByUrl } from '../lib/realm-registry-writes';
import { withRealmWriteLock } from '../lib/realm-advisory-locks';

const log = logger('handle-unpublish');

export default function handleUnpublishRealm({
  dbAdapter,
  realmsRootPath,
  reconciler,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let token = ctxt.state.token as RealmServerTokenClaim;
    if (!token) {
      await sendResponseForSystemError(
        ctxt,
        'token is required to unpublish realm',
      );
      return;
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
      return;
    }

    if (!json.publishedRealmURL) {
      await sendResponseForBadRequest(ctxt, 'publishedRealmURL is required');
      return;
    }

    let publishedRealmURL = json.publishedRealmURL.endsWith('/')
      ? json.publishedRealmURL
      : `${json.publishedRealmURL}/`;

    try {
      // Phase 4: read from realm_registry; alias the columns so the
      // downstream field accessors stay the same as when this read
      // pointed at published_realms.
      let publishedRealmData = (await query(dbAdapter, [
        `SELECT disk_id AS id, owner_username, source_url AS source_realm_url, url AS published_realm_url, last_published_at FROM realm_registry WHERE kind = 'published' AND url =`,
        param(publishedRealmURL),
      ])) as Pick<
        PublishedRealmTable,
        | 'id'
        | 'owner_username'
        | 'source_realm_url'
        | 'published_realm_url'
        | 'last_published_at'
      >[];

      if (!publishedRealmData.length) {
        await sendResponseForUnprocessableEntity(
          ctxt,
          `Published realm ${publishedRealmURL} not found`,
        );
        return;
      }

      let publishedRealmInfo = publishedRealmData[0];

      let { user: ownerUserId } = token;
      let permissions = await fetchRealmPermissions(
        dbAdapter,
        new URL(publishedRealmInfo.source_realm_url),
      );
      if (!permissions[ownerUserId]?.includes('realm-owner')) {
        await sendResponseForForbiddenRequest(
          ctxt,
          `${ownerUserId} does not have enough permission to unpublish this realm`,
        );
        return;
      }

      let publishedRealmPath = join(
        realmsRootPath,
        PUBLISHED_DIRECTORY_NAME,
        publishedRealmInfo.id,
      );

      // Mount the published realm on this instance (no-op if already
      // mounted) so we have a Realm instance to drive the tombstone
      // path before deleting files. Phase 3 sibling-instance behavior
      // is unchanged: those instances see deleteFromRegistryByUrl's
      // NOTIFY realm_registry and unmount via the reconciler.
      let publishedRealm = await reconciler.lookupOrMount(publishedRealmURL);

      // Serialize concurrent writers for this realm URL via the per-
      // URL advisory lock, then drive tombstones via realm.deleteAll
      // (bumps realm_version + marks every boxel_index entry as
      // deleted, matching the legacy unpublish behavior), then do FS
      // + DB cleanup. realms[] / virtualNetwork mutation stays in the
      // reconciler's hands — it reacts to the registry DELETE +
      // NOTIFY below.
      await withRealmWriteLock(dbAdapter, publishedRealmURL, async () => {
        if (publishedRealm) {
          let allFilePaths = collectAllFilePaths(publishedRealmPath);
          if (allFilePaths.length > 0) {
            await publishedRealm.deleteAll(allFilePaths);
          }
        }
        removeRealmFiles(publishedRealmPath);

        await query(dbAdapter, [
          `DELETE FROM published_realms WHERE published_realm_url =`,
          param(publishedRealmURL),
        ]);

        await deleteFromRegistryByUrl(dbAdapter, publishedRealmURL);

        await removeRealmPermissions(dbAdapter, new URL(publishedRealmURL));
      });

      // Permissions for the published realm were removed inside the
      // write lock above, so fetchRealmPermissions(publishedRealmURL)
      // would return nothing useful for X-Boxel-Realm-Public-Readable.
      // Pass an empty permissions map — createResponse just needs
      // realm.url for X-Boxel-Realm-Url.
      let realmForResponse = publishedRealm ?? {
        url: publishedRealmURL,
      };
      let response = createResponse({
        body: JSON.stringify(
          {
            data: {
              type: 'unpublished_realm',
              id: publishedRealmInfo.id,
              attributes: {
                sourceRealmURL: publishedRealmInfo.source_realm_url,
                publishedRealmURL: publishedRealmInfo.published_realm_url,
                lastPublishedAt: publishedRealmInfo.last_published_at,
              },
            },
          },
          null,
          2,
        ),
        init: {
          status: 200,
          headers: {
            'content-type': SupportedMimeType.JSONAPI,
          },
        },
        requestContext: {
          realm: realmForResponse as Realm,
          permissions: {},
        },
      });
      await setContextResponse(ctxt, response);
      return;
    } catch (error: any) {
      log.error(`Error unpublishing realm ${publishedRealmURL}:`, error);
      Sentry.captureException(error);
      await sendResponseForSystemError(ctxt, error.message);
    }
  };
}
