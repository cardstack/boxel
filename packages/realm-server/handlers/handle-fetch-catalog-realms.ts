import Koa from 'koa';
import {
  fetchPublicRealms,
  logger,
  RealmInfo,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import { setContextResponse } from '../middleware';
import { CreateRoutesArgs } from '../routes';

type CatalogRealm = {
  type: 'catalog-realm';
  id: string;
  attributes: RealmInfo;
};
let catalogRealms: CatalogRealm[] | null = null;

const log = logger('realm-server');
export default function handleFetchCatalogRealmsRequest({
  dbAdapter,
  virtualNetwork,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    if (!catalogRealms) {
      let publicRealms = await fetchPublicRealms(dbAdapter);
      catalogRealms = (
        await Promise.all(
          publicRealms.map(async ({ realm_url: realmURL }) => {
            let realmInfoResponse = await virtualNetwork.handle(
              new Request(`${realmURL}_info`, {
                headers: {
                  Accept: SupportedMimeType.RealmInfo,
                },
              }),
            );
            if (realmInfoResponse.status != 200) {
              log.warn(
                `Failed to fetch realm info for public realm ${realmURL}: ${realmInfoResponse.status}`,
              );
              return null;
            }
            let json = await realmInfoResponse.json();
            let attributes = json.data.attributes;
            if (
              attributes.showAsCatalog != null &&
              attributes.showAsCatalog == false
            ) {
              return null;
            }

            return {
              type: 'catalog-realm',
              id: realmURL,
              attributes: json.data.attributes,
            };
          }),
        )
      ).filter(Boolean) as CatalogRealm[];
    }

    return setContextResponse(
      ctxt,
      new Response(JSON.stringify({ data: catalogRealms }), {
        headers: { 'content-type': SupportedMimeType.JSONAPI },
      }),
    );
  };
}

// This function is created for testing purpose
export function resetCatalogRealms() {
  catalogRealms = null;
}
