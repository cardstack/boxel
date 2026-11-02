import type Koa from 'koa';
import type {
  DBAdapter,
  Realm,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import { logger } from '@cardstack/runtime-common';
import {
  attributeSearchRequest,
  fetchRequestFromContext,
  setContextResponse,
  withSearchConnectionTenant,
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
    let request: Request = await fetchRequestFromContext(ctxt);
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
    let realm: Realm | undefined;
    try {
      realm = await findOrMountRealm(requestURL, deps);
      // A realm's own `_search` names that realm. Attributed here because this
      // is where the request is first resolved to one; the admission gate
      // counted it before anything knew which.
      if (realm) {
        attributeSearchRequest(ctxt, [realm.url]);
      }
    } catch (err: any) {
      log.warn(
        `failed to mount realm for request ${requestURL.href}: ${err?.message ?? err}`,
      );
      ctxt.status = 503;
      ctxt.body = `Realm mount failed: ${err?.message ?? err}`;
      return;
    }
    if (realm) {
      let forwarded = await siteOperationsForward(realm, request, requestURL);
      if (forwarded) {
        request = forwarded;
        realm = await findOrMountRealm(new URL(forwarded.url), deps);
      }
    }
    let realmResponse = await withSearchConnectionTenant(
      ctxt,
      realm ? [realm.url] : [],
      () =>
        virtualNetwork.handle(request, (mappedRequest) => {
          // Setup this handler only after the request has been mapped because
          // the *mapped request* is the one that gets closed, not the original one
          setupCloseHandler(ctxt.res, mappedRequest);
        }),
    );

    await setContextResponse(ctxt, realmResponse);
  };
}

// A published site's visitors can write only through the site's own
// `_operations`: Boxel Link opens no other write to them, and the published
// copy holds no live data and names no policy. A site that names the live
// realm its visitors act on, as `config.siteOperationsRealm` in its
// realm.json, has that route sent on to the live realm's `_operations`, on the
// same origin and without credentials, so the live realm's own ACL and policy
// judge each visitor exactly as they would a direct request from someone not
// signed in. A site that names no realm is untouched.
async function siteOperationsForward(
  realm: Realm,
  request: Request,
  requestURL: URL,
): Promise<Request | undefined> {
  if (request.method !== 'POST') {
    return undefined;
  }
  if (requestURL.pathname !== `${new URL(realm.url).pathname}_operations`) {
    return undefined;
  }
  let target = (await realm.getRealmConfig()).siteOperationsRealm;
  if (typeof target !== 'string') {
    return undefined;
  }
  let targetPath: string;
  try {
    targetPath = new URL(target).pathname.replace(/\/?$/, '/');
  } catch {
    log.warn(`${realm.url}: siteOperationsRealm "${target}" is not a URL`);
    return undefined;
  }
  let forwardURL = new URL(`${targetPath}_operations`, requestURL.origin);
  if (forwardURL.href === requestURL.href) {
    return undefined;
  }
  let headers = new Headers(request.headers);
  headers.delete('authorization');
  headers.delete('cookie');
  return new Request(forwardURL.href, {
    method: 'POST',
    headers,
    body: await request.text(),
  });
}
