import type Koa from 'koa';
import type { DBAdapter, RealmInfo } from '@cardstack/runtime-common';
import { logger, SupportedMimeType } from '@cardstack/runtime-common';

import { setContextResponse } from '../middleware';
import { getMultiRealmAuthorization } from '../middleware/multi-realm-authorization';
import { resolveRealmsForFederatedRequest } from '../lib/realm-routing';
import type { RealmRegistryReconciler } from '../lib/realm-registry-reconciler';
import { getPublicReadableRealms } from '../utils/realm-readability';

const log = logger('realm-server');

export default function handleRealmInfo({
  dbAdapter,
  reconciler,
}: {
  dbAdapter: DBAdapter;
  reconciler: RealmRegistryReconciler;
}): (ctxt: Koa.Context) => Promise<void> {
  return async function (ctxt: Koa.Context) {
    let { realmList } = getMultiRealmAuthorization(ctxt);
    let [publicReadableRealms, realmInstances] = await Promise.all([
      getPublicReadableRealms(dbAdapter, realmList),
      resolveRealmsForFederatedRequest(reconciler, realmList),
    ]);

    let data: { id: string; type: 'realm-info'; attributes: RealmInfo }[] = [];

    for (let i = 0; i < realmList.length; i++) {
      let realmURL = realmList[i];
      let realm = realmInstances[i];
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
