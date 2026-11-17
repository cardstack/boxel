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
import { OAUTH_CONNECTIONS_PATH } from './connections.ts';
import { OAUTH_CONSENT_PATH } from './consent.ts';
import {
  OAUTH_PROTECTED_RESOURCE_PATH,
  protectedResourceMetadataHandler,
  resourcePath,
} from './resource.ts';
import {
  OAUTH_DISCOVERY_PATH,
  OAUTH_REGISTRATION_PATH,
  OAUTH_TOKEN_PATH,
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
// A registration, the request that starts a flow, a token request, and the
// request that resumes a finished one go through Boxel's own handling first, which hands them on to
// the library only once Boxel allows them. The interaction, finish, error,
// consent and connections routes are Boxel's alone, though finishing hands the result to the
// library, which answers the request.
export function registerOAuthProviderRoutes(
  router: Router,
  {
    provider,
    handleRegistration,
    handleAuthorization,
    handleToken,
    handleInteraction,
    handleFinish,
    handleResume,
    handleErrorDetails,
    handleErrorReturn,
    consentHandlers,
    connectionsHandlers,
    issuer,
    registry,
    resourceController,
  }: OAuthProviderService,
  consentDeps: ConsentRouteDeps,
) {
  let { handleConsentDetails, handleConsentDecision } =
    consentHandlers(consentDeps);
  let { handleConnectionsList, handleConnectionsDisconnect } =
    connectionsHandlers(consentDeps);
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
  for (let resource of registry) {
    // Each resource's protected-resource metadata (RFC 9728), which a client
    // reads from the challenge a resource answers without a token.
    router.get(
      `${OAUTH_PROTECTED_RESOURCE_PATH}${resourcePath(resource)}`,
      onIssuerHost(protectedResourceMetadataHandler(issuer, resource)),
    );
    // A resource a test adds has no route of its own, so each server route
    // its scopes map is served here, behind its controller, answering the
    // verified caller and whether the token reached it in any header. So is
    // one route no scope maps, `<resource path>/unmapped`, which the
    // controller refuses. Nothing in production adds a test resource
    // (`registry.ts`).
    if (!resource.testOnly) {
      continue;
    }
    let controller = resourceController(resource);
    let routes = new Map<string, { method: string; path: string }>();
    for (let scope of resource.scopes) {
      for (let route of scope.routes) {
        if (route.on === 'server') {
          routes.set(`${route.method} ${route.path}`, route);
        }
      }
    }
    let unmapped = `${resourcePath(resource)}/unmapped`;
    routes.set(`GET ${unmapped}`, { method: 'GET', path: unmapped });
    for (let { method, path } of routes.values()) {
      router.register(
        path,
        [method],
        [
          onIssuerHost((ctxt) =>
            Promise.resolve(
              controller(ctxt, async () => {
                ctxt.status = 200;
                ctxt.body = {
                  caller: ctxt.state.oauthCaller,
                  authorization: ctxt.get('Authorization') || null,
                  rawAuthorization: ctxt.req.rawHeaders.filter(
                    (_value, i, raw) =>
                      i % 2 === 1 &&
                      raw[i - 1].toLowerCase() === 'authorization',
                  ),
                };
              }),
            ),
          ),
        ],
      );
    }
  }
  router.post(
    OAUTH_REGISTRATION_PATH,
    onIssuerHost((ctxt) => handleRegistration(ctxt, () => serve(ctxt))),
  );
  router.get(
    OAUTH_AUTHORIZATION_PATH,
    onIssuerHost((ctxt) => handleAuthorization(ctxt, () => serve(ctxt))),
  );
  // The token endpoint answers its own CORS, by the client a request names
  // (`clientBasedCORS`), and its preflight; the realm server's CORS leaves
  // the route to it.
  router.post(
    OAUTH_TOKEN_PATH,
    onIssuerHost((ctxt) => handleToken(ctxt, () => serve(ctxt))),
  );
  router.options(OAUTH_TOKEN_PATH, onIssuerHost(serve));
  router.get(
    `${OAUTH_INTERACTION_PATH}/:uid`,
    onIssuerHost(boxelOnly(handleInteraction)),
  );
  router.get(
    `${OAUTH_INTERACTION_PATH}/:uid/finish`,
    onIssuerHost(boxelOnly(handleFinish)),
  );
  router.get(
    `${OAUTH_AUTHORIZATION_PATH}/:uid`,
    onIssuerHost((ctxt) => handleResume(ctxt, () => serve(ctxt))),
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
  router.get(
    OAUTH_CONNECTIONS_PATH,
    onIssuerHost(boxelOnly(handleConnectionsList)),
  );
  router.delete(
    `${OAUTH_CONNECTIONS_PATH}/:grantId`,
    onIssuerHost(boxelOnly(handleConnectionsDisconnect)),
  );
}

// The realm server's CORS, except on the routes where the library answers
// CORS itself, by the client a request names: the token endpoint's `POST`
// and its preflight, on the issuer's host. The library leaves CORS alone on
// a response that already has it, so the realm server's would let any origin
// call those routes. Every other request keeps the realm server's CORS,
// including one to the same path when the provider is off (`issuer`
// undefined), on another host, or with another method, since the provider
// doesn't serve it and it goes on to the realm server's own routing.
export function leaveCORSToOAuthProvider(
  cors: Koa.Middleware,
  issuer: string | undefined,
): Koa.Middleware {
  let issuerHost = issuer ? new URL(issuer).host : undefined;
  return (ctxt, next) =>
    issuerHost &&
    (ctxt.method === 'POST' || ctxt.method === 'OPTIONS') &&
    isTokenPath(ctxt.path) &&
    fullRequestURL(ctxt).host === issuerHost
      ? next()
      : cors(ctxt, next);
}

// Whether a path reaches the token route. Both the realm server's router and
// the library's match a path in any case and with or without a trailing
// slash, so this does too.
function isTokenPath(pathname: string): boolean {
  let path = pathname.toLowerCase();
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  return path === OAUTH_TOKEN_PATH.toLowerCase();
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
