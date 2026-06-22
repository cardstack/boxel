import type Koa from 'koa';
import {
  SupportedMimeType,
  systemInitiatedPriority,
} from '@cardstack/runtime-common';
import {
  sendResponseForUnauthorizedRequest,
  setContextResponse,
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import { boxelUIChecker } from '../lib/boxel-ui-change-checker.ts';
import { getFullReindexRealmUrls } from '../lib/full-reindex-realm-urls.ts';

export default function handlePostDeployment({
  assetsURL,
  dbAdapter,
  definitionLookup,
  queue,
  realmServerSecretSeed,
  reportHostShell,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    if (ctxt.request.headers.authorization !== realmServerSecretSeed) {
      sendResponseForUnauthorizedRequest(ctxt, 'Unauthorized');
      return;
    }

    // This hook fires after the deploy reports the service stable, so the new
    // host shell is live and load-balancer-routable. Re-report the host-shell
    // token to the prerender manager from here so the fleet's recycle signal
    // reflects the now-serving shell, closing the rolling-deploy window where
    // the boot-time report could precede the new task receiving traffic.
    // Fire-and-forget — best-effort, must not affect the hook's response.
    void reportHostShell?.();

    await definitionLookup.clearAllDefinitions();

    let boxelUiChangeCheckerResult =
      await boxelUIChecker.compareCurrentBoxelUIChecksum(assetsURL);

    if (
      boxelUiChangeCheckerResult.currentChecksum !==
      boxelUiChangeCheckerResult.previousChecksum
    ) {
      let realmUrls = await getFullReindexRealmUrls(dbAdapter);

      await queue.publish<void>({
        jobType: `full-reindex`,
        concurrencyGroup: `full-reindex-group`,
        timeout: 6 * 60,
        priority: systemInitiatedPriority,
        args: {
          realmUrls,
        },
      });

      boxelUIChecker.writeCurrentBoxelUIChecksum(
        boxelUiChangeCheckerResult.currentChecksum,
      );
    }

    await setContextResponse(
      ctxt,
      new Response(JSON.stringify(boxelUiChangeCheckerResult, null, 2), {
        headers: { 'content-type': SupportedMimeType.JSON },
      }),
    );
  };
}
