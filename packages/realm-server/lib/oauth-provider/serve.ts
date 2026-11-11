import type Koa from 'koa';
import type Router from '@koa/router';
import { fullRequestURL } from '../../middleware/index.ts';
import {
  OAUTH_AUTHORIZATION_PATH,
  OAUTH_ERROR_PATH,
  OAUTH_INTERACTION_PATH,
} from './authorization.ts';
import {
  OAUTH_DISCOVERY_PATH,
  OAUTH_REGISTRATION_PATH,
  type OAuthProviderService,
} from './provider.ts';

// Registers the provider's routes on the realm server's router. The library
// is a whole Koa app that answers every path it knows (its signing keys, its
// own discovery under the OpenID name, each endpoint of a feature turned on),
// so it is reached only through the exact routes registered here; any other
// path never touches it. The router runs ahead of realm routing, so a realm
// mounted at the server's root can't shadow these. An endpoint is served only
// once it is registered here.
//
// The routes answer only on the issuer's host. The realm server also serves
// published sites on other hosts, whose pages users write, and the library
// sets its flow cookies on whatever host a request names. A request on any
// other host goes on to the realm server's own routing.
//
// A registration, and the request that starts a flow, go through Boxel's own
// handling first, which hands them on to the library only once Boxel allows
// them. The interaction and error routes are Boxel's alone.
export function registerOAuthProviderRoutes(
  router: Router,
  {
    provider,
    handleRegistration,
    handleAuthorization,
    handleInteraction,
    handleErrorDetails,
    handleErrorReturn,
  }: OAuthProviderService,
) {
  let issuerHost = new URL(provider.issuer).host;
  let callback = provider.callback();
  let serve = async (ctxt: Koa.Context) => {
    // The library writes the response itself. Headers already set on it,
    // such as CORS, stay.
    ctxt.respond = false;
    await callback(ctxt.req, ctxt.res);
  };
  let onIssuerHost =
    (handle: (ctxt: Koa.Context) => Promise<void>): Koa.Middleware =>
    async (ctxt, next) => {
      if (fullRequestURL(ctxt).host !== issuerHost) {
        return next();
      }
      await handle(ctxt);
    };
  let boxelOnly =
    (handle: Koa.Middleware) =>
    (ctxt: Koa.Context): Promise<void> =>
      Promise.resolve(handle(ctxt, async () => {}));

  router.get(OAUTH_DISCOVERY_PATH, onIssuerHost(serve));
  router.post(
    OAUTH_REGISTRATION_PATH,
    onIssuerHost((ctxt) => handleRegistration(ctxt, () => serve(ctxt))),
  );
  router.get(
    OAUTH_AUTHORIZATION_PATH,
    onIssuerHost((ctxt) => handleAuthorization(ctxt, () => serve(ctxt))),
  );
  router.get(
    `${OAUTH_INTERACTION_PATH}/:uid`,
    onIssuerHost(boxelOnly(handleInteraction)),
  );
  router.get(
    `${OAUTH_ERROR_PATH}/:ref`,
    onIssuerHost(boxelOnly(handleErrorDetails)),
  );
  router.get(
    `${OAUTH_ERROR_PATH}/:ref/return`,
    onIssuerHost(boxelOnly(handleErrorReturn)),
  );
}
