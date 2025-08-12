import {
  type DBAdapter,
  type QueuePublisher,
  type Realm,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import Router from '@koa/router';
import handleCreateSessionRequest from './handlers/handle-create-session';
import handleCreateRealmRequest from './handlers/handle-create-realm';
import handleFetchCatalogRealmsRequest from './handlers/handle-fetch-catalog-realms';
import handleFetchUserRequest from './handlers/handle-fetch-user';
import handleStripeWebhookRequest from './handlers/handle-stripe-webhook';
import {
  healthCheck,
  jwtMiddleware,
  livenessCheck,
  grafanaAuthorization,
} from './middleware';
import Koa from 'koa';
import handleCreateUserRequest from './handlers/handle-create-user';
import handleQueueStatusRequest from './handlers/handle-queue-status';
import handleReindex from './handlers/handle-reindex';
import handleFullReindex from './handlers/handle-full-reindex';
import handleRemoveJob from './handlers/handle-remove-job';
import handleAddCredit from './handlers/handle-add-credit';
import handleCreateStripeSessionRequest from './handlers/handle-create-stripe-session';
import handleRequestForward from './handlers/handle-request-forward';

export type CreateRoutesArgs = {
  serverURL: string;
  dbAdapter: DBAdapter;
  matrixClient: MatrixClient;
  realmServerSecretSeed: string;
  grafanaSecret: string;
  realmSecretSeed: string;
  externalEndpointsConfig?: string;
  virtualNetwork: VirtualNetwork;
  queue: QueuePublisher;
  realms: Realm[];
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
    jwtMiddleware(args.realmSecretSeed),
    handleCreateRealmRequest(args),
  );
  router.get('/_catalog-realms', handleFetchCatalogRealmsRequest(args));
  router.get('/_queue-status', handleQueueStatusRequest(args));
  router.post('/_stripe-webhook', handleStripeWebhookRequest(args));
  router.post(
    '/_stripe-session',
    jwtMiddleware(args.realmSecretSeed),
    handleCreateStripeSessionRequest(args),
  );
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
  router.post(
    '/_request-forward',
    jwtMiddleware(args.realmSecretSeed),
    handleRequestForward({
      dbAdapter: args.dbAdapter,
      externalEndpointsConfig: args.externalEndpointsConfig ?? '[]',
    }),
  );

  // it's awkward that these are GET's but we are working around grafana's limitations
  router.get(
    '/_grafana-reindex',
    grafanaAuthorization(args.grafanaSecret),
    handleReindex(args),
  );
  router.get(
    '/_grafana-complete-job',
    grafanaAuthorization(args.grafanaSecret),
    handleRemoveJob(args),
  );
  router.get(
    '/_grafana-add-credit',
    grafanaAuthorization(args.grafanaSecret),
    handleAddCredit(args),
  );
  router.get(
    '/_grafana-full-reindex',
    grafanaAuthorization(args.grafanaSecret),
    handleFullReindex(args),
  );

  return router.routes();
}
