import type Koa from 'koa';
import type { DBAdapter } from '@cardstack/runtime-common';
import { logger, SupportedMimeType } from '@cardstack/runtime-common';
import {
  makeFederatedCardTypeSummaryDoc,
  type FederatedCardTypeSummaryEntry,
} from '@cardstack/runtime-common/document-types';
import { setContextResponse } from '../middleware';
import {
  getMultiRealmAuthorization,
  getSearchRequestPayload,
} from '../middleware/multi-realm-authorization';
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

    let payload = getSearchRequestPayload(ctxt) as
      | {
          realms?: string[];
          searchKey?: string;
          page?: { number: number; size: number };
        }
      | undefined;
    let searchKey = payload?.searchKey;
    let page = payload?.page;

    let allEntries: FederatedCardTypeSummaryEntry[] = [];

    for (let realmURL of realmList) {
      let realm = realmByURL.get(realmURL);
      if (!realm) {
        continue;
      }
      try {
        // `fetchCardTypeSummary` now returns the partitioned shape
        // `{ instances, files }`. Federate both arms into the flat response,
        // tagging each entry with its `kind` so clients (CardsGrid, etc.)
        // can partition the list back into "All Cards" vs "All Files" groups.
        let summaries =
          await realm.realmIndexQueryEngine.fetchCardTypeSummary();
        for (let summary of summaries.instances) {
          allEntries.push({
            type: 'card-type-summary',
            id: summary.code_ref,
            attributes: {
              displayName: summary.display_name,
              total: summary.total,
              iconHTML: summary.icon_html,
              kind: 'instance',
            },
            meta: {
              realmURL,
            },
          });
        }
        for (let summary of summaries.files) {
          allEntries.push({
            type: 'card-type-summary',
            id: summary.code_ref,
            attributes: {
              displayName: summary.display_name,
              total: summary.total,
              iconHTML: summary.icon_html,
              kind: 'file',
            },
            meta: {
              realmURL,
            },
          });
        }
      } catch (error) {
        log.warn(`Failed to fetch card type summary for ${realmURL}: ${error}`);
      }
    }

    if (searchKey) {
      let lowerSearch = searchKey.toLowerCase();
      allEntries = allEntries.filter(
        (entry) =>
          entry.attributes.displayName?.toLowerCase().includes(lowerSearch) ||
          entry.id?.toLowerCase().includes(lowerSearch),
      );
    }

    // Sort alphabetically by displayName so pagination returns a stable order
    allEntries.sort((a, b) =>
      (a.attributes.displayName ?? '').localeCompare(
        b.attributes.displayName ?? '',
      ),
    );

    let total = allEntries.length;

    if (page) {
      let start = page.number * page.size;
      allEntries = allEntries.slice(start, start + page.size);
    }

    let doc = makeFederatedCardTypeSummaryDoc(allEntries, total);

    let headers: Record<string, string> = {
      'content-type': SupportedMimeType.CardTypeSummary,
    };
    if (publicReadableRealms.size > 0) {
      headers['x-boxel-realms-public-readable'] =
        Array.from(publicReadableRealms).join(',');
    }

    await setContextResponse(
      ctxt,
      new Response(JSON.stringify(doc, null, 2), { headers }),
    );
  };
}
