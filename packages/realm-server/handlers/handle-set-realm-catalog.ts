import type Koa from 'koa';
import {
  fetchRealmPermissions,
  logger,
  notifyRealmIndexUpdated,
  param,
  query,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import {
  sendResponseForBadRequest,
  setContextResponse,
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import { normalizeRealmURL } from '../utils/realm-url.ts';
import { resetCatalogRealms } from './handle-fetch-catalog-realms.ts';

const log = logger('realm-server');

// Opts a public realm into, or out of, the catalog: the realms every signed-in
// user sees in the dashboard's Catalogs section (`/_catalog-realms`). Every
// other public realm stays reachable by URL without being listed. The choice
// is persisted in `realm_metadata.show_as_catalog`, which is also what the
// realm's `_info` reports as `showAsCatalog`.
export default function handleSetRealmCatalog({
  dbAdapter,
  reconciler,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let realm = ctxt.URL.searchParams.get('realm');
    if (!realm) {
      await sendResponseForBadRequest(ctxt, `realm param must be specified`);
      return;
    }
    let realmURL = normalizeRealmURL(realm);
    if (!realmURL) {
      await sendResponseForBadRequest(ctxt, `realm "${realm}" is not a URL`);
      return;
    }
    let catalogParam = ctxt.URL.searchParams.get('catalog');
    if (catalogParam !== 'true' && catalogParam !== 'false') {
      await sendResponseForBadRequest(
        ctxt,
        `catalog param must be "true" or "false"`,
      );
      return;
    }
    let showAsCatalog = catalogParam === 'true';

    let [registryRow] = (await query(dbAdapter, [
      `SELECT kind FROM realm_registry WHERE url =`,
      param(realmURL.href),
    ])) as { kind: string }[];
    if (!registryRow && !reconciler.mounted.has(realmURL.href)) {
      await sendResponseForBadRequest(
        ctxt,
        `${realmURL.href} is not a realm on this server`,
      );
      return;
    }
    if (registryRow?.kind === 'published') {
      await sendResponseForBadRequest(
        ctxt,
        `${realmURL.href} is a published realm; only source realms can be catalogs`,
      );
      return;
    }
    if (showAsCatalog) {
      let permissions = await fetchRealmPermissions(dbAdapter, realmURL);
      if (!permissions['*']?.includes('read')) {
        await sendResponseForBadRequest(
          ctxt,
          `${realmURL.href} is not publicly readable; only public realms can be catalogs`,
        );
        return;
      }
    }

    await query(dbAdapter, [
      `INSERT INTO realm_metadata (url, show_as_catalog) VALUES (`,
      param(realmURL.href),
      `,`,
      param(showAsCatalog),
      `) ON CONFLICT (url) DO UPDATE SET show_as_catalog = EXCLUDED.show_as_catalog, updated_at = now()`,
    ]);

    // The realm's cached `_info` carries `showAsCatalog`: drop it here and on
    // peer instances. This instance's catalog list is dropped too; peers'
    // lists expire on their own.
    reconciler.mounted.get(realmURL.href)?.clearRealmIndexCaches();
    await notifyRealmIndexUpdated(dbAdapter, realmURL.href);
    resetCatalogRealms();
    log.info(`set show_as_catalog=${showAsCatalog} on ${realmURL.href}`);

    return setContextResponse(
      ctxt,
      new Response(
        JSON.stringify({
          message: `${showAsCatalog ? 'Added' : 'Removed'} ${realmURL.href} ${showAsCatalog ? 'to' : 'from'} the catalog`,
          realm: realmURL.href,
          showAsCatalog,
        }),
        { headers: { 'content-type': SupportedMimeType.JSON } },
      ),
    );
  };
}
