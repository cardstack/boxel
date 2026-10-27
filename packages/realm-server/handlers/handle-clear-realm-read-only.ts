import type Koa from 'koa';
import {
  type Realm,
  RealmPaths,
  SupportedMimeType,
  clearRealmReadOnly,
  realmReadOnly,
} from '@cardstack/runtime-common';
import {
  sendResponseForBadRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';

// The operator's way out of read-only for a realm whose recovery failed (see
// docs/realm-history-recovery-runbook.md). Runs the realm's recovery again and
// lifts the seal only if it succeeds, so a realm is never put back to taking
// writes while it still disagrees with its history. `force=true` lifts the
// seal without recovering, for a realm an operator has already repaired by
// hand; whatever disk then holds that history does not is taken in as drift by
// the next recovery.
//
// `realm=` resolves as for `/_grafana-reindex`, and only through the realm
// registry.
export default function handleClearRealmReadOnly({
  serverURL,
  dbAdapter,
  reconciler,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let realmPath = ctxt.URL.searchParams.get('realm')?.replace(/\/$/, '');
    if (!realmPath) {
      await sendResponseForBadRequest(
        ctxt,
        'Request missing "realm" query param',
      );
      return;
    }
    let force = ctxt.URL.searchParams.get('force') === 'true';
    let realmURL: string;
    try {
      realmURL = new RealmPaths(new URL(serverURL)).directoryURL(
        realmPath,
      ).href;
    } catch (e: any) {
      await sendResponseForBadRequest(
        ctxt,
        `invalid "realm" value: ${e.message}`,
      );
      return;
    }
    let realm: Realm | undefined;
    try {
      realm = await reconciler.lookupOrMount(realmURL);
    } catch (e: any) {
      await sendResponseForSystemError(ctxt, e.message);
      return;
    }
    if (!realm) {
      await sendResponseForBadRequest(
        ctxt,
        `realm ${realmURL} does not exist on this server`,
      );
      return;
    }
    if (!realm.history) {
      await sendResponseForBadRequest(
        ctxt,
        `realm ${realmURL} does not record history, so it is never read-only`,
      );
      return;
    }
    let body: Record<string, unknown>;
    if (force) {
      await clearRealmReadOnly(dbAdapter, realmURL);
      body = { realm: realmURL, readOnly: false, forced: true };
    } else {
      let result = await realm.recoverHistory({ trigger: 'operator' });
      let readOnly = await realmReadOnly(dbAdapter, realmURL);
      body = {
        realm: realmURL,
        readOnly: Boolean(readOnly),
        ...(readOnly ? { reason: readOnly.detail ?? readOnly.reason } : {}),
        ...(result ? { recovery: result.event } : {}),
      };
    }
    await setContextResponse(
      ctxt,
      new Response(JSON.stringify(body, null, 2), {
        status: body.readOnly ? 409 : 200,
        headers: { 'content-type': SupportedMimeType.JSON },
      }),
    );
  };
}
