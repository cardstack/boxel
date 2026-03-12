import type Koa from 'koa';
import type { DBAdapter } from '@cardstack/runtime-common';
import { logger, SupportedMimeType } from '@cardstack/runtime-common';
import { makeCardTypeSummaryDoc } from '@cardstack/runtime-common/document-types';
import { setContextResponse } from '../middleware';
import { getMultiRealmAuthorization } from '../middleware/multi-realm-authorization';
import { getPublicReadableRealms } from '../utils/realm-readability';

const log = logger('realm-server');

export default function handleFederatedTypes({
  dbAdapter,
}: {
  dbAdapter: DBAdapter;
}): (ctxt: Koa.Context) => Promise<void> {
  return async function (ctxt: Koa.Context) {
    let { realmList, realmByURL } = getMultiRealmAuthorization(ctxt);
    let publicReadableRealms = await getPublicReadableRealms(
      dbAdapter,
      realmList,
    );

    let data: Record<string, ReturnType<typeof makeCardTypeSummaryDoc>> = {};

    for (let realmURL of realmList) {
      let realm = realmByURL.get(realmURL);
      if (!realm) {
        continue;
      }
      try {
        let summaries =
          await realm.realmIndexQueryEngine.fetchCardTypeSummary();
        data[realmURL] = makeCardTypeSummaryDoc(summaries);
      } catch (error) {
        log.warn(`Failed to fetch card type summary for ${realmURL}: ${error}`);
      }
    }

    let headers: Record<string, string> = {
      'content-type': SupportedMimeType.CardTypeSummary,
    };
    if (publicReadableRealms.size > 0) {
      headers['x-boxel-realms-public-readable'] =
        Array.from(publicReadableRealms).join(',');
    }

    await setContextResponse(
      ctxt,
      new Response(JSON.stringify({ data }, null, 2), { headers }),
    );
  };
}
