import type Koa from 'koa';
import type { DBAdapter, RealmIndexCounts } from '@cardstack/runtime-common';
import {
  logger,
  sanitizeConsumingRealmHeader,
  SupportedMimeType,
  X_BOXEL_CONSUMING_REALM_HEADER,
} from '@cardstack/runtime-common';

import { setContextResponse } from '../middleware/index.ts';
import { getMultiRealmAuthorization } from '../middleware/multi-realm-authorization.ts';
import { resolveRealmsForFederatedRequest } from '../lib/realm-routing.ts';
import type { RealmRegistryReconciler } from '../lib/realm-registry-reconciler.ts';

const log = logger('realm-server');

// Cards / files / definitions per realm, for the workspace chooser's favorite
// tiles. Split out of `/_federated-info` because the underlying query
// aggregates every index row in a realm: the host loads realm *info* for every
// realm at boot, but only a favorited realm's tile renders a stats row, so it
// asks for counts separately and lazily for that much smaller set.
//
// Authorization is the shared `multiRealmAuthorization` middleware, so the
// caller must be able to read every realm it names — same contract as
// `/_federated-info` and `/_federated-search`.
export default function handleRealmIndexCounts({
  reconciler,
}: {
  dbAdapter: DBAdapter;
  reconciler: RealmRegistryReconciler;
}): (ctxt: Koa.Context) => Promise<void> {
  return async function (ctxt: Koa.Context) {
    let { realmList } = getMultiRealmAuthorization(ctxt);
    let consumingRealm = sanitizeConsumingRealmHeader(
      ctxt.get(X_BOXEL_CONSUMING_REALM_HEADER),
    );
    let realmInstances = await resolveRealmsForFederatedRequest(
      reconciler,
      realmList,
      { consumingRealm },
    );

    let data: {
      id: string;
      type: 'realm-index-counts';
      attributes: RealmIndexCounts;
    }[] = [];

    for (let [i, realmURL] of realmList.entries()) {
      let realm = realmInstances[i];
      if (!realm) {
        continue;
      }
      try {
        data.push({
          id: realmURL,
          type: 'realm-index-counts',
          attributes: await realm.getIndexCounts(),
        });
      } catch (error) {
        // Omit the realm rather than failing the batch: a missing entry leaves
        // that tile without a stats row, which is the same outcome as a realm
        // whose counts are unavailable.
        log.warn(`Failed to fetch index counts for ${realmURL}: ${error}`);
      }
    }

    await setContextResponse(
      ctxt,
      new Response(JSON.stringify({ data }, null, 2), {
        headers: { 'content-type': SupportedMimeType.JSONAPI },
      }),
    );
  };
}
