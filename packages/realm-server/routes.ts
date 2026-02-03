import type { RealmInfo } from '@cardstack/runtime-common';
import type {
  DBAdapter,
  QueuePublisher,
  Realm,
  VirtualNetwork,
  Prerenderer,
} from '@cardstack/runtime-common';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import Router from '@koa/router';
import handleCreateSessionRequest from './handlers/handle-create-session';
import handleCreateRealmRequest from './handlers/handle-create-realm';
import handleFetchCatalogRealmsRequest from './handlers/handle-fetch-catalog-realms';
import handleFetchUserRequest from './handlers/handle-fetch-user';
import handleStripeWebhookRequest from './handlers/handle-stripe-webhook';
import handlePublishRealm from './handlers/handle-publish-realm';
import handleUnpublishRealm from './handlers/handle-unpublish-realm';
import {
  healthCheck,
  jwtMiddleware,
  livenessCheck,
  grafanaAuthorization,
} from './middleware';
import type Koa from 'koa';
import handleCreateUserRequest from './handlers/handle-create-user';
import handleQueueStatusRequest from './handlers/handle-queue-status';
import handleReindex from './handlers/handle-reindex';
import handleFullReindex from './handlers/handle-full-reindex';
import handleRemoveJob from './handlers/handle-remove-job';
import handleAddCredit from './handlers/handle-add-credit';
import handleCreateStripeSessionRequest from './handlers/handle-create-stripe-session';
import handleRequestForward from './handlers/handle-request-forward';
import handlePostDeployment from './handlers/handle-post-deployment';
import { handleCheckBoxelDomainAvailabilityRequest } from './handlers/handle-check-boxel-domain-availability';
import handleRealmAuth from './handlers/handle-realm-auth';
import handleGetBoxelClaimedDomainRequest from './handlers/handle-get-boxel-claimed-domain';
import handleClaimBoxelDomainRequest from './handlers/handle-claim-boxel-domain';
import handleDeleteBoxelClaimedDomainRequest from './handlers/handle-delete-boxel-claimed-domain';
import handlePrerenderProxy from './handlers/handle-prerender-proxy';
import handleSearch from './handlers/handle-search';
import handleSearchPrerendered from './handlers/handle-search-prerendered';
import handleRealmInfo from './handlers/handle-realm-info';
import { multiRealmAuthorization } from './middleware/multi-realm-authorization';
import handleGitHubPRRequest from './handlers/handle-github-pr';
import handleDownloadRealm from './handlers/handle-download-realm';
import {
  handleBotRegistrationRequest,
  handleBotRegistrationsRequest,
  handleBotUnregistrationRequest,
} from './handlers/handle-bot-registration';
import { buildCreatePrerenderAuth } from './prerender/auth';

export type CreateRoutesArgs = {
  serverURL: string;
  dbAdapter: DBAdapter;
  matrixClient: MatrixClient;
  realmServerSecretSeed: string;
  grafanaSecret: string;
  realmSecretSeed: string;
  virtualNetwork: VirtualNetwork;
  queue: QueuePublisher;
  realms: Realm[];
  realmsRootPath: string;
  getMatrixRegistrationSecret: () => Promise<string>;
  createAndMountRealm: (
    path: string,
    url: string,
    copiedFromRealm?: URL,
    enableFileWatcher?: boolean,
    fromScratchIndexPriority?: number,
  ) => Realm;
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
  }) => Promise<{ realm: Realm; info: Partial<RealmInfo> }>;
  serveIndex: (ctxt: Koa.Context, next: Koa.Next) => Promise<any>;
  serveFromRealm: (ctxt: Koa.Context, next: Koa.Next) => Promise<any>;
  sendEvent: (
    user: string,
    eventType: string,
    data?: Record<string, any>,
  ) => Promise<void>;
  domainsForPublishedRealms?: {
    boxelSpace?: string;
    boxelSite?: string;
  };
  assetsURL: URL;
  prerenderer?: Prerenderer;
};

export function createRoutes(args: CreateRoutesArgs) {
  let createPrerenderAuth = buildCreatePrerenderAuth(
    args.realmSecretSeed,
    args.serverURL,
  );
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
    }),
  );
  router.all('/_search', multiRealmAuthorization(args), handleSearch());
  router.all(
    '/_info',
    multiRealmAuthorization(args),
    handleRealmInfo({ dbAdapter: args.dbAdapter }),
  );
  router.all(
    '/_search-prerendered',
    multiRealmAuthorization(args),
    handleSearchPrerendered(),
  );
  router.post(
    '/_prerender-card',
    jwtMiddleware(args.realmSecretSeed),
    handlePrerenderProxy({
      kind: 'card',
      prerenderer: args.prerenderer,
      dbAdapter: args.dbAdapter,
      createPrerenderAuth,
    }),
  );
  router.post(
    '/_prerender-module',
    jwtMiddleware(args.realmSecretSeed),
    handlePrerenderProxy({
      kind: 'module',
      prerenderer: args.prerenderer,
      dbAdapter: args.dbAdapter,
      createPrerenderAuth,
    }),
  );
  router.post(
    '/_prerender-file-extract',
    jwtMiddleware(args.realmSecretSeed),
    handlePrerenderProxy({
      kind: 'file-extract',
      prerenderer: args.prerenderer,
      dbAdapter: args.dbAdapter,
      createPrerenderAuth,
    }),
  );
  router.post(
    '/_publish-realm',
    jwtMiddleware(args.realmSecretSeed),
    handlePublishRealm(args),
  );
  router.post(
    '/_unpublish-realm',
    jwtMiddleware(args.realmSecretSeed),
    handleUnpublishRealm(args),
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
  router.post('/_post-deployment', handlePostDeployment(args));
  router.post(
    '/_realm-auth',
    jwtMiddleware(args.realmSecretSeed),
    handleRealmAuth(args),
  );
  router.get(
    '/_check-boxel-domain-availability',
    jwtMiddleware(args.realmSecretSeed),
    handleCheckBoxelDomainAvailabilityRequest(args),
  );
  router.get(
    '/_boxel-claimed-domains',
    jwtMiddleware(args.realmSecretSeed),
    handleGetBoxelClaimedDomainRequest(args),
  );
  router.post(
    '/_boxel-claimed-domains',
    jwtMiddleware(args.realmSecretSeed),
    handleClaimBoxelDomainRequest(args),
  );
  router.delete(
    '/_boxel-claimed-domains/:claimedDomainId',
    jwtMiddleware(args.realmSecretSeed),
    handleDeleteBoxelClaimedDomainRequest(args),
  );
  router.post(
    '/_github-pr',
    jwtMiddleware(args.realmSecretSeed),
    handleGitHubPRRequest(args),
  );
  router.get('/_download-realm', handleDownloadRealm(args));
  router.post(
    '/_bot-registration',
    jwtMiddleware(args.realmSecretSeed),
    handleBotRegistrationRequest(args),
  );
  router.get(
    '/_bot-registrations',
    jwtMiddleware(args.realmSecretSeed),
    handleBotRegistrationsRequest(args),
  );
  router.delete(
    '/_bot-registration',
    jwtMiddleware(args.realmSecretSeed),
    handleBotUnregistrationRequest(args),
  );

  return router.routes();
}
