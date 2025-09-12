import Koa from 'koa';
import {
  query,
  SupportedMimeType,
  logger,
  createResponse,
  param,
  removeRealmPermissions,
  type PublishedRealmTable,
  fetchRealmPermissions,
} from '@cardstack/runtime-common';
import { removeSync } from 'fs-extra';
import { join } from 'path';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForForbiddenRequest,
  sendResponseForSystemError,
  sendResponseForNotFound,
  setContextResponse,
} from '../middleware';
import { type CreateRoutesArgs } from '../routes';
import { RealmServerTokenClaim } from '../utils/jwt';

const log = logger('handle-unpublish');

export default function handleUnpublishRealm({
  dbAdapter,
  virtualNetwork,
  realms,
  realmsRootPath,
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

    let { user: ownerUserId } = token;
    let permissions = await fetchRealmPermissions(
      dbAdapter,
      new URL(publishedRealmURL),
    );
    if (!permissions[ownerUserId]?.includes('realm-owner')) {
      await sendResponseForForbiddenRequest(
        ctxt,
        `${ownerUserId} does not have enough permission to unpublish this realm`,
      );
      return;
    }

    try {
      let publishedRealmData = (await query(dbAdapter, [
        `SELECT * FROM published_realms WHERE published_realm_url =`,
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
        await sendResponseForNotFound(
          ctxt,
          `Published realm ${publishedRealmURL} not found`,
        );
        return;
      }

      let publishedRealmInfo = publishedRealmData[0];

      // Find the realm instance
      let existingPublishedRealm = realms.find(
        (r) => r.url === publishedRealmURL,
      );

      if (existingPublishedRealm) {
        // Unmount the realm from virtual network
        virtualNetwork.unmount(existingPublishedRealm.handle);

        // Remove from realms array
        let index = realms.findIndex((r) => r.url === publishedRealmURL);
        if (index !== -1) {
          realms.splice(index, 1);
        }

        // Remove index entries using the new removeRealm method
        await existingPublishedRealm.realmIndexUpdater.removeRealm();
      }

      // Remove published realm directory from file system
      let publishedDir = join(realmsRootPath, 'published');
      let publishedRealmPath = join(publishedDir, publishedRealmInfo.id);
      try {
        removeSync(publishedRealmPath);
      } catch (e) {
        log.warn(
          `Failed to remove published realm directory ${publishedRealmPath}: ${e}`,
        );
      }

      // Remove from published_realms table
      await query(dbAdapter, [
        `DELETE FROM published_realms WHERE published_realm_url =`,
        param(publishedRealmURL),
      ]);

      // Remove all permissions for the published realm
      await removeRealmPermissions(dbAdapter, new URL(publishedRealmURL));

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
        requestContext: existingPublishedRealm
          ? {
              realm: existingPublishedRealm,
              permissions: {
                [ownerUserId]: ['read'],
              },
            }
          : {
              realm: realms[0], // Use first available realm as fallback
              permissions: {
                [ownerUserId]: ['read'],
              },
            },
      });
      await setContextResponse(ctxt, response);
      return;
    } catch (error: any) {
      log.error('Error unpublishing realm:', error);
      await sendResponseForSystemError(ctxt, error.message);
    }
  };
}
