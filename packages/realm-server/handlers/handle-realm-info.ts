import type Koa from 'koa';
import type { DBAdapter, RealmInfo } from '@cardstack/runtime-common';
import { logger, SupportedMimeType } from '@cardstack/runtime-common';

import { setContextResponse } from '../middleware';
import { getMultiRealmAuthorization } from '../middleware/multi-realm-authorization';
import { getPublicReadableRealms } from '../utils/realm-readability';

const log = logger('realm-server');

export default function handleRealmInfo({
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

    let data: { id: string; type: 'realm-info'; attributes: RealmInfo }[] = [];

    for (let realmURL of realmList) {
      let realm = realmByURL.get(realmURL);
      if (!realm) {
        continue;
      }
      try {
        let info = await realm.getRealmInfo();
        data.push({ id: realmURL, type: 'realm-info', attributes: info });
      } catch (error) {
        log.warn(`Failed to fetch realm info for ${realmURL}: ${error}`);
      }
    }

    let headers: Record<string, string> = {
      'content-type': SupportedMimeType.RealmInfo,
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
