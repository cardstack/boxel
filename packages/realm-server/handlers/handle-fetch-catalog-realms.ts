import type Koa from 'koa';
import type { DBAdapter, RealmInfo } from '@cardstack/runtime-common';
import {
  fetchCatalogRealms,
  logger,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import { setContextResponse } from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';

type VirtualNetwork = CreateRoutesArgs['virtualNetwork'];

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
// One refresh at a time: requests that arrive while the cache is being
// refilled wait on the same refresh rather than each starting their own.
let refresh: Promise<CatalogRealm[]> | null = null;
// Bumped by every reset, so a refresh that started before a reset neither
// caches its now-stale list nor clears a newer refresh.
let generation = 0;

const log = logger('realm-server');
export default function handleFetchCatalogRealmsRequest({
  dbAdapter,
  virtualNetwork,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let realms = await currentCatalogRealms(dbAdapter, virtualNetwork);
    return setContextResponse(
      ctxt,
      new Response(JSON.stringify({ data: realms }), {
        headers: { 'content-type': SupportedMimeType.JSONAPI },
      }),
    );
  };
}

async function currentCatalogRealms(
  dbAdapter: DBAdapter,
  virtualNetwork: VirtualNetwork,
): Promise<CatalogRealm[]> {
  if (
    catalogRealms &&
    Date.now() - catalogRealms.fetchedAt <= CATALOG_REALMS_TTL_MS
  ) {
    return catalogRealms.realms;
  }
  if (!refresh) {
    let startedIn = generation;
    refresh = loadCatalogRealms(dbAdapter, virtualNetwork)
      .then((realms) => {
        if (generation === startedIn) {
          catalogRealms = { realms, fetchedAt: Date.now() };
        }
        return realms;
      })
      .finally(() => {
        if (generation === startedIn) {
          refresh = null;
        }
      });
  }
  return refresh;
}

async function loadCatalogRealms(
  dbAdapter: DBAdapter,
  virtualNetwork: VirtualNetwork,
): Promise<CatalogRealm[]> {
  let catalogRealmURLs = await fetchCatalogRealms(dbAdapter);
  return (
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
}

// Drops this instance's cached catalog list, and any refresh in flight, so
// the next request reads it afresh. Also used by tests.
export function resetCatalogRealms() {
  catalogRealms = null;
  refresh = null;
  generation++;
}
