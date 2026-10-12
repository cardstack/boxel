import type Koa from 'koa';
import type { RealmInfo } from '@cardstack/runtime-common';
import {
  fetchCatalogRealms,
  logger,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import { setContextResponse } from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';

type CatalogRealm = {
  type: 'catalog-realm';
  id: string;
  attributes: RealmInfo;
};

// The catalog list changes only when an operator opts a realm in or out
// (`/_grafana-set-realm-catalog`), which resets this instance's cache at once.
// Peer instances pick the change up when their copy expires.
const CATALOG_REALMS_TTL_MS = 60_000;
let catalogRealms: { realms: CatalogRealm[]; fetchedAt: number } | null = null;

const log = logger('realm-server');
export default function handleFetchCatalogRealmsRequest({
  dbAdapter,
  virtualNetwork,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    if (
      !catalogRealms ||
      Date.now() - catalogRealms.fetchedAt > CATALOG_REALMS_TTL_MS
    ) {
      let catalogRealmURLs = await fetchCatalogRealms(dbAdapter);
      let realms = (
        await Promise.all(
          catalogRealmURLs.map(async ({ realm_url: realmURL }) => {
            let realmInfoResponse = await virtualNetwork.handle(
              new Request(`${realmURL}_info`, {
                method: 'QUERY',
                headers: {
                  Accept: SupportedMimeType.RealmInfo,
                },
              }),
            );
            if (realmInfoResponse.status != 200) {
              log.warn(
                `Failed to fetch realm info for catalog realm ${realmURL}: ${realmInfoResponse.status}`,
              );
              return null;
            }
            let json = await realmInfoResponse.json();
            return {
              type: 'catalog-realm',
              id: realmURL,
              attributes: json.data.attributes,
            };
          }),
        )
      ).filter(Boolean) as CatalogRealm[];
      catalogRealms = { realms, fetchedAt: Date.now() };
    }

    return setContextResponse(
      ctxt,
      new Response(JSON.stringify({ data: catalogRealms.realms }), {
        headers: { 'content-type': SupportedMimeType.JSONAPI },
      }),
    );
  };
}

// Drops this instance's cached catalog list so the next request reads it
// afresh. Also used by tests.
export function resetCatalogRealms() {
  catalogRealms = null;
}
