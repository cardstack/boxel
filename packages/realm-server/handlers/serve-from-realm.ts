import type Koa from 'koa';
import type {
  DBAdapter,
  Realm,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import { logger } from '@cardstack/runtime-common';
import {
  fetchRequestFromContext,
  setContextResponse,
} from '../middleware/index.ts';
import { setupCloseHandler } from '../node-realm.ts';
import { findOrMountRealm } from '../lib/realm-routing.ts';
import type { RealmRegistryReconciler } from '../lib/realm-registry-reconciler.ts';

export type ServeFromRealmDeps = {
  realms: Realm[];
  reconciler: RealmRegistryReconciler;
  dbAdapter: DBAdapter;
  virtualNetwork: VirtualNetwork;
};

const log = logger('realm-server');

export function createServeFromRealm(
  deps: ServeFromRealmDeps,
): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  let { virtualNetwork } = deps;
  return async function serveFromRealm(ctxt: Koa.Context, _next: Koa.Next) {
    if (ctxt.request.path === '/_boom') {
      throw new Error('boom');
    }
    let request = await fetchRequestFromContext(ctxt);
    // Phase 3 lazy mount: trigger findOrMountRealm before dispatching to
    // virtualNetwork.handle so non-pinned realms (source/published) mount
    // on first request. virtualNetwork.handle returns 404 for any URL
    // whose handle isn't registered, which is exactly what happens for
    // a realm that the reconciler knows about (knownByUrl) but hasn't
    // mounted yet. findOrMountRealm walks knownByUrl, calls
    // reconciler.lookupOrMount() on a prefix match, and that
    // synchronously publishes the realm into virtualNetwork before the
    // dispatch below. Mount failures throw — the catch turns them into
    // 503 so the next request retries from scratch (ensureMounted's
    // failure path clears mounted/pendingMounts).
    let requestURL = new URL(
      `${ctxt.protocol}://${ctxt.host}${ctxt.originalUrl}`,
    );
    try {
      await findOrMountRealm(requestURL, deps);
    } catch (err: any) {
      log.warn(
        `failed to mount realm for request ${requestURL.href}: ${err?.message ?? err}`,
      );
      ctxt.status = 503;
      ctxt.body = `Realm mount failed: ${err?.message ?? err}`;
      return;
    }
    let realmResponse = await virtualNetwork.handle(
      request,
      (mappedRequest) => {
        // Setup this handler only after the request has been mapped because
        // the *mapped request* is the one that gets closed, not the original one
        setupCloseHandler(ctxt.res, mappedRequest);
      },
    );

    await setContextResponse(ctxt, realmResponse);
  };
}
