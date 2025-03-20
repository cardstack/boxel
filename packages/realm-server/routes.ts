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
import handleCreateUserRequest from './handlers/handle-create-user';
import handleQueueStatusRequest from './handlers/handle-queue-status';

export type CreateRoutesArgs = {
  dbAdapter: DBAdapter;
  matrixClient: MatrixClient;
  realmServerSecretSeed: string;
  realmSecretSeed: string;
  virtualNetwork: VirtualNetwork;
  createRealm: ({
    ownerUserId,
    endpoint,
    name,
    backgroundURL,
    iconURL,
    copyFromSeedRealm,
  }: {
    ownerUserId: string;
    endpoint: string;
    name: string;
    backgroundURL?: string;
    iconURL?: string;
    copyFromSeedRealm?: boolean;
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
    jwtMiddleware(args.realmSecretSeed),
    handleCreateRealmRequest(args),
  );
  router.get('/_catalog-realms', handleFetchCatalogRealmsRequest(args));
  router.get('/_queue-status', handleQueueStatusRequest(args));
  router.post('/_stripe-webhook', handleStripeWebhookRequest(args));
  router.get(
    '/_user',
    jwtMiddleware(args.realmSecretSeed),
    handleFetchUserRequest(args),
  );
  router.post(
    '/_user',
    jwtMiddleware(args.realmSecretSeed),
    handleCreateUserRequest(args),
  );
  router.get('/_stripe-links', handleStripeLinksRequest());

  return router.routes();
}
