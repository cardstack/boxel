import type Koa from 'koa';
import {
  SupportedMimeType,
  systemInitiatedPriority,
} from '@cardstack/runtime-common';
import {
  sendResponseForUnauthorizedRequest,
  setContextResponse,
} from '../middleware';
import type { CreateRoutesArgs } from '../routes';
import {
  compareCurrentBoxelUIChecksum,
  writeCurrentBoxelUIChecksum,
} from '../lib/boxel-ui-change-checker';

export default function handlePostDeployment({
  assetsURL,
  realms,
  queue,
  realmServerSecretSeed,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    if (ctxt.request.headers.authorization !== realmServerSecretSeed) {
      sendResponseForUnauthorizedRequest(ctxt, 'Unauthorized');
      return;
    }

    let boxelUiChangeCheckerResult =
      await compareCurrentBoxelUIChecksum(assetsURL);

    if (
      boxelUiChangeCheckerResult.currentChecksum !==
      boxelUiChangeCheckerResult.previousChecksum
    ) {
      await queue.publish<void>({
        jobType: `full-reindex`,
        concurrencyGroup: `full-reindex-group`,
        timeout: 6 * 60,
        priority: systemInitiatedPriority,
        args: {
          realmUrls: realms.map((r) => r.url),
        },
      });

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
