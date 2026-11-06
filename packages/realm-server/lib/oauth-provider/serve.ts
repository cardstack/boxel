import type Koa from 'koa';
import type Router from '@koa/router';
import type Provider from 'oidc-provider';
import { OAUTH_DISCOVERY_PATH } from './provider.ts';

// Registers the provider's routes on the realm server's router. The library
// is a whole Koa app that answers every path it knows (its signing keys, its
// own discovery under the OpenID name, each endpoint of a feature turned on),
// so it is reached only through the exact routes registered here; any other
// path never touches it. The router runs ahead of realm routing, so a realm
// mounted at the server's root can't shadow these. Each change that serves an
// endpoint registers it here.
export function registerOAuthProviderRoutes(
  router: Router,
  provider: Provider,
) {
  let handle = serveFromOAuthProvider(provider);
  router.get(OAUTH_DISCOVERY_PATH, handle);
}

function serveFromOAuthProvider(provider: Provider) {
  let callback = provider.callback();
  return async function (ctxt: Koa.Context) {
    // The library writes the response itself. Headers already set on it,
    // such as CORS, stay.
    ctxt.respond = false;
    await callback(ctxt.req, ctxt.res);
  };
}
