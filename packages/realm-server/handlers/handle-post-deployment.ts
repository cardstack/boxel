import Koa from 'koa';
import {
  SupportedMimeType,
  systemInitiatedPriority,
} from '@cardstack/runtime-common';
import {
  sendResponseForUnauthorizedRequest,
  setContextResponse,
} from '../middleware';
import { type CreateRoutesArgs } from '../routes';
import {
  compareCurrentBoxelUIChecksum,
  writeCurrentBoxelUIChecksum,
} from '../lib/boxel-ui-change-checker';
import { reindex } from './handle-reindex';

export default function handlePostDeployment({
  assetsURL,
  realms,
  queue,
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    if (
      ctxt.request.headers.authorization !== process.env.REALM_SERVER_SECRET
    ) {
      sendResponseForUnauthorizedRequest(ctxt, 'Unauthorized');
    }

    let boxelUiChangeCheckerResult =
      await compareCurrentBoxelUIChecksum(assetsURL);

    if (
      boxelUiChangeCheckerResult.currentChecksum !==
      boxelUiChangeCheckerResult.previousChecksum
    ) {
      for (let realm of realms) {
        await reindex({
          realm,
          queue,
          dbAdapter,
          priority: systemInitiatedPriority,
        });
      }
      writeCurrentBoxelUIChecksum(boxelUiChangeCheckerResult.currentChecksum);
    }

    await setContextResponse(
      ctxt,
      new Response(JSON.stringify(boxelUiChangeCheckerResult, null, 2), {
        headers: { 'content-type': SupportedMimeType.JSON },
      }),
    );
  };
}
