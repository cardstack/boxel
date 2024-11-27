import { DBAdapter, Realm, VirtualNetwork } from '@cardstack/runtime-common';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import Router from '@koa/router';
import handleCreateSessionRequest from './handlers/handle-create-session';
import handleCreateRealmRequest from './handlers/handle-create-realm';
import handleFetchCatalogRealmsRequest from './handlers/handle-fetch-catalog-realms';
import handleFetchUserRequest from './handlers/handle-fetch-user';
import handleStripeWebhookRequest from './handlers/handle-stripe-webhook';
import { healthCheck, jwtMiddleware, livenessCheck } from './middleware';
import Koa from 'koa';
import handleStripeLinksRequest from './handlers/handle-stripe-links';

export type CreateRoutesArgs = {
  dbAdapter: DBAdapter;
  matrixClient: MatrixClient;
  secretSeed: string;
  virtualNetwork: VirtualNetwork;
  createRealm: ({
    ownerUserId,
    endpoint,
    name,
    backgroundURL,
    iconURL,
  }: {
    ownerUserId: string;
    endpoint: string;
    name: string;
    backgroundURL?: string;
    iconURL?: string;
  }) => Promise<Realm>;
  serveIndex: (ctxt: Koa.Context, next: Koa.Next) => Promise<any>;
  serveFromRealm: (ctxt: Koa.Context, next: Koa.Next) => Promise<any>;
  sendEvent: (user: string, eventType: string) => Promise<void>;
};

export function createRoutes(args: CreateRoutesArgs) {
  let router = new Router();

  router.head('/', livenessCheck);
  router.get('/', healthCheck, args.serveIndex, args.serveFromRealm);
  router.post('/_server-session', handleCreateSessionRequest(args));
  router.post(
    '/_create-realm',
    jwtMiddleware(args.secretSeed),
    handleCreateRealmRequest(args),
  );
  router.get('/_catalog-realms', handleFetchCatalogRealmsRequest(args));
  router.post('/_stripe-webhook', handleStripeWebhookRequest(args));
  router.get(
    '/_user',
    jwtMiddleware(args.secretSeed),
    handleFetchUserRequest(args),
  );
  router.get('/_stripe-links', handleStripeLinksRequest());

  return router.routes();
}
