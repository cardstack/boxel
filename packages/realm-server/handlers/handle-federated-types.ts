import type Koa from 'koa';
import type { DBAdapter } from '@cardstack/runtime-common';
import {
  ensureTrailingSlash,
  fetchUserPermissions,
  logger,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import { makeCardTypeSummaryDoc } from '@cardstack/runtime-common/document-types';
import { setContextResponse } from '../middleware';
import { getMultiRealmAuthorization } from '../middleware/multi-realm-authorization';
import {
  buildReadableRealms,
  getPublishedRealmURLs,
} from '../utils/realm-readability';

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

    let results = await Promise.allSettled(
      realmList.map(async (realmURL) => {
        let realm = realmByURL.get(realmURL);
        if (!realm) {
          return;
        }
        let summaries =
          await realm.realmIndexQueryEngine.fetchCardTypeSummary();
        data[realmURL] = makeCardTypeSummaryDoc(summaries);
      }),
    );

    for (let [index, result] of results.entries()) {
      if (result.status === 'rejected') {
        log.warn(
          `Failed to fetch card type summary for realm ${realmList[index]}: ${result.reason}`,
        );
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

async function getPublicReadableRealms(
  dbAdapter: DBAdapter,
  realmList: string[],
): Promise<Set<string>> {
  let publicPermissions = await fetchUserPermissions(dbAdapter, {
    userId: '*',
    onlyOwnRealms: false,
  });

  let publishedRealmURLs = await getPublishedRealmURLs(dbAdapter, realmList);
  let publicReadable = buildReadableRealms(
    publicPermissions,
    publishedRealmURLs,
  );

  let normalizedRealmList = realmList.map((realmURL) =>
    ensureTrailingSlash(realmURL),
  );
  return new Set(
    normalizedRealmList.filter((realmURL) => publicReadable.has(realmURL)),
  );
}
