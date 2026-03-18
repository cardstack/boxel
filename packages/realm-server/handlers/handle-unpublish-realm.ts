import type Koa from 'koa';
import {
  query,
  SupportedMimeType,
  logger,
  createResponse,
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
import { removeMountedRealm } from './realm-destruction-utils';

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

      let existingPublishedRealm = realms.find(
        (r) => r.url === publishedRealmURL,
      );
      if (!existingPublishedRealm) {
        throw new Error(
          `No realm instance found for published realm ${publishedRealmURL}`,
        );
      }

      let publishedRealmPath = join(
        realmsRootPath,
        PUBLISHED_DIRECTORY_NAME,
        publishedRealmInfo.id,
      );
      await removeMountedRealm({
        realm: existingPublishedRealm,
        realmPath: publishedRealmPath,
        realms,
        virtualNetwork,
      });

      await query(dbAdapter, [
        `DELETE FROM published_realms WHERE published_realm_url =`,
        param(publishedRealmURL),
      ]);

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
              realm:
                realms.find(
                  (r) => r.url === publishedRealmInfo.source_realm_url,
                ) || realms[0],
              permissions: {
                [ownerUserId]: ['read'],
              },
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
