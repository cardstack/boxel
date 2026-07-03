import type Koa from 'koa';
import {
  createResponse,
  query,
  SupportedMimeType,
  logger,
  notifyAllFileChanges,
  param,
  removeRealmPermissions,
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
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import type { Realm } from '@cardstack/runtime-common';
import {
  collectAllFilePaths,
  removeRealmFiles,
} from './realm-destruction-utils.ts';
import { deleteRegistryRowByUrl } from '../lib/realm-registry-writes.ts';

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
      let publishedRealmData = (await query(dbAdapter, [
        `SELECT disk_id, owner_username, source_url, url, last_published_at FROM realm_registry WHERE kind = 'published' AND url =`,
        param(publishedRealmURL),
      ])) as {
        disk_id: string;
        owner_username: string;
        source_url: string;
        url: string;
        last_published_at: string | number | null;
      }[];

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
        new URL(publishedRealmInfo.source_url),
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
        publishedRealmInfo.disk_id,
      );

      // Mount the published realm on this instance (no-op if already
      // mounted) so we have a Realm instance to drive the tombstone
      // path before deleting files. Phase 3 sibling-instance behavior
      // is unchanged: those instances see deleteRegistryRowByUrl's
      // NOTIFY realm_registry and unmount via the reconciler.
      let publishedRealm = await reconciler.lookupOrMount(publishedRealmURL);

      // Tombstone *before* the lock: realm.deleteAll enqueues an indexer
      // job whose execution runs on a worker connection of its own, so it
      // is not transactional with the lock-holder's DB cleanup either way.
      // Doing it before the tx keeps the tombstones (which mark every
      // boxel_index entry as deleted + bump generation) in place if
      // the registry/permissions DELETEs fail — a retry of the same
      // unpublish will succeed without re-tombstoning the same content.
      if (publishedRealm) {
        let allFilePaths = collectAllFilePaths(publishedRealmPath);
        if (allFilePaths.length > 0) {
          await publishedRealm.deleteAll(allFilePaths);
        }
      }

      // Serialize concurrent writers for this realm URL via the per-
      // URL advisory lock and group all DB cleanup into one transaction:
      // CS-10898 routes the registry-row delete and the permissions
      // delete through the lock-holder's pinned querier, so any failure
      // mid-cleanup rolls back both DELETEs together. realms[] /
      // virtualNetwork mutation stays in the reconciler's hands — it
      // reacts to the registry DELETE + NOTIFY emitted below.
      await dbAdapter.withWriteLock(publishedRealmURL, async (txQuerier) => {
        await deleteRegistryRowByUrl(dbAdapter, publishedRealmURL, txQuerier);
        await removeRealmPermissions(
          dbAdapter,
          new URL(publishedRealmURL),
          txQuerier,
        );
      });

      // FS removal happens after the DB transaction commits. If the rm
      // fails, the realm's row + permissions are already gone and the
      // user-visible state is "unpublished"; orphan files are
      // recoverable by an out-of-band sweep (residual gap documented in
      // CS-10898). Doing it inside the tx would risk the worse failure
      // mode where we delete files but the registry row sticks around.
      removeRealmFiles(publishedRealmPath);

      // CS-11156. Broadcast a bulk cache-invalidation to peer replicas so
      // any that still have this realm mounted drop their #sourceCache /
      // #transpiledModuleCache before the reconciler unmount lands. The per-file
      // deleteAll above already emitted per-path NOTIFYs covering bytes
      // that existed on disk; this bulk emit closes the brief window
      // between the registry-row delete commit and the peers' reaction.
      // Best-effort, fire-and-forget.
      await notifyAllFileChanges(dbAdapter, publishedRealmURL);

      // Removing this derivative just changed the source realm's
      // `RealmInfo.lastPublishedAt` map (rows where `source_url =
      // sourceRealmURL`). Without invalidating the source's cached
      // realm info, its card+json ETag (which folds a hash of the
      // realm info in) would keep matching pre-unpublish If-None-Match
      // headers and serve a 304 with stale `meta.realmInfo`. (CS-11010)
      let sourceRealmURL = publishedRealmInfo.source_url;
      if (sourceRealmURL) {
        try {
          let sourceRealm = await reconciler.lookupOrMount(sourceRealmURL);
          sourceRealm?.invalidateCachedRealmInfo();
        } catch (err) {
          log.warn(
            `Could not invalidate source realm cached realm-info for ${sourceRealmURL} after unpublish: ${err}`,
          );
        }
      }

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
              id: publishedRealmInfo.disk_id,
              attributes: {
                sourceRealmURL: publishedRealmInfo.source_url,
                publishedRealmURL: publishedRealmInfo.url,
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
