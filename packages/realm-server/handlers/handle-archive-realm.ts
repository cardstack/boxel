import type Koa from 'koa';
import {
  archiveRealm,
  createResponse,
  logger,
  SupportedMimeType,
  type Realm,
} from '@cardstack/runtime-common';
import * as Sentry from '@sentry/node';
import {
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import { resolveAndAuthorizeArchiveTarget } from './archive-realm-utils.ts';

const log = logger('handle-archive');

export default function handleArchiveRealm({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let target = await resolveAndAuthorizeArchiveTarget(
      ctxt,
      dbAdapter,
      'archive',
    );
    if (!target) {
      return;
    }
    let { realmURL, permissions } = target;

    try {
      await archiveRealm(dbAdapter, new URL(realmURL));

      let response = createResponse({
        body: JSON.stringify(
          {
            data: {
              type: 'realm',
              id: realmURL,
              attributes: { archived: true },
            },
          },
          null,
          2,
        ),
        init: {
          status: 200,
          headers: { 'content-type': SupportedMimeType.JSONAPI },
        },
        requestContext: {
          realm: { url: realmURL } as Realm,
          permissions,
        },
      });
      await setContextResponse(ctxt, response);
    } catch (error: any) {
      log.error(`Error archiving realm ${realmURL}:`, error);
      Sentry.captureException(error);
      await sendResponseForSystemError(ctxt, error.message);
    }
  };
}
