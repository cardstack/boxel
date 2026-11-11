import type { IncomingMessage } from 'http';
import type Koa from 'koa';
import type Router from '@koa/router';
import { CLIENT_IP_HEADER } from '@cardstack/runtime-common';
import { fullRequestURL } from '../../middleware/index.ts';
import {
  OAUTH_AUTHORIZATION_PATH,
  OAUTH_ERROR_PATH,
  OAUTH_INTERACTION_PATH,
} from './authorization.ts';
import { inMetadataDocumentRequest } from './client-metadata-document.ts';
import { OAUTH_CONSENT_PATH } from './consent.ts';
import {
  OAUTH_DISCOVERY_PATH,
  OAUTH_REGISTRATION_PATH,
  type ConsentRouteDeps,
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
// them. The interaction, error and consent routes are Boxel's alone.
export function registerOAuthProviderRoutes(
  router: Router,
  {
    provider,
    handleRegistration,
    handleAuthorization,
    handleInteraction,
    handleErrorDetails,
    handleErrorReturn,
    consentHandlers,
  }: OAuthProviderService,
  consentDeps: ConsentRouteDeps,
) {
  let { handleConsentDetails, handleConsentDecision } =
    consentHandlers(consentDeps);
  let issuerURL = new URL(provider.issuer);
  let issuerHost = issuerURL.host;
  let callback = provider.callback();
  let serve = async (ctxt: Koa.Context) => {
    // The library writes the response itself. Headers already set on it,
    // such as CORS, stay.
    ctxt.respond = false;
    asTheIssuerServes(ctxt.req, issuerURL);
    await callback(ctxt.req, ctxt.res);
  };
  let onIssuerHost =
    (handle: (ctxt: Koa.Context) => Promise<void>): Koa.Middleware =>
    async (ctxt, next) => {
      if (fullRequestURL(ctxt).host !== issuerHost) {
        return next();
      }
      // Boxel's checks and the library may each look up a client identified
      // by a metadata document, and either may download it: both need the
      // caller's address to count the download against.
      let address = ctxt.req.headers[CLIENT_IP_HEADER];
      await inMetadataDocumentRequest(
        typeof address === 'string' ? address : undefined,
        () => handle(ctxt),
      );
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
  router.get(
    `${OAUTH_CONSENT_PATH}/:uid`,
    onIssuerHost(boxelOnly(handleConsentDetails)),
  );
  router.post(
    `${OAUTH_CONSENT_PATH}/:uid`,
    onIssuerHost(boxelOnly(handleConsentDecision)),
  );
}

// The library runs in proxy mode (`provider.ts`), so it reads the request's
// scheme and host from forwarding headers. Before it sees a request, the
// scheme is set to the issuer's, whatever the caller or a load balancer sent,
// so its cookies are `Secure` exactly when the issuer is HTTPS. The forwarded
// host is removed, so the library reads the host from `Host`, which has
// already been checked against the issuer's.
export function asTheIssuerServes(req: IncomingMessage, issuerURL: URL) {
  req.headers['x-forwarded-proto'] = issuerURL.protocol.slice(0, -1);
  delete req.headers['x-forwarded-host'];
}
