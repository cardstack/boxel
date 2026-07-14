import type {
  DBAdapter,
  DefinitionLookup,
  QueuePublisher,
  Realm,
  VirtualNetwork,
  Prerenderer,
} from '@cardstack/runtime-common';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import Router from '@koa/router';
import { createRequire } from 'module';
import handleCreateSessionRequest from './handlers/handle-create-session.ts';
import handleCreateRealmRequest, {
  type CreateRealmDeps,
} from './handlers/create-realm.ts';
import handleDeleteRealm from './handlers/handle-delete-realm.ts';
import handleFetchCatalogRealmsRequest from './handlers/handle-fetch-catalog-realms.ts';
import handleFetchUserRequest from './handlers/handle-fetch-user.ts';
import handleStripeWebhookRequest from './handlers/handle-stripe-webhook.ts';
import handlePublishRealm from './handlers/handle-publish-realm.ts';
import handleUnpublishRealm from './handlers/handle-unpublish-realm.ts';
import handleArchiveRealm from './handlers/handle-archive-realm.ts';
import handleUnarchiveRealm from './handlers/handle-unarchive-realm.ts';
import handleArchivedRealms from './handlers/handle-archived-realms.ts';
import {
  healthCheck,
  jwtMiddleware,
  grafanaAuthorization,
} from './middleware/index.ts';
import type Koa from 'koa';
import handleCreateUserRequest from './handlers/handle-create-user.ts';
import handleQueueStatusRequest from './handlers/handle-queue-status.ts';
import handleSkillValidation from './handlers/handle-skill-validation.ts';
import handleReindex from './handlers/handle-reindex.ts';
import handleFullReindex from './handlers/handle-full-reindex.ts';
import handleRemoveJob from './handlers/handle-remove-job.ts';
import handleAddCredit from './handlers/handle-add-credit.ts';
import handleUpsertRealmUserPermission from './handlers/handle-upsert-realm-user-permission.ts';
import handleCreateStripeSessionRequest from './handlers/handle-create-stripe-session.ts';
import handleRequestForward from './handlers/handle-request-forward.ts';
import handleOpenRouterPassthrough from './handlers/handle-openrouter-passthrough.ts';
import handlePostDeployment from './handlers/handle-post-deployment.ts';
import { handleCheckBoxelDomainAvailabilityRequest } from './handlers/handle-check-boxel-domain-availability.ts';
import handleRealmAuth from './handlers/handle-realm-auth.ts';
import handleDelegateSession from './handlers/handle-delegate-session.ts';
import handleWorkerRequest from './handlers/handle-worker-request.ts';
import handleGetBoxelClaimedDomainRequest from './handlers/handle-get-boxel-claimed-domain.ts';
import handleClaimBoxelDomainRequest from './handlers/handle-claim-boxel-domain.ts';
import handleDeleteBoxelClaimedDomainRequest from './handlers/handle-delete-boxel-claimed-domain.ts';
import handleUnlistedRealmPathRequest from './handlers/handle-unlisted-realm-path.ts';
import handlePrerenderProxy from './handlers/handle-prerender-proxy.ts';
import handleSearch from './handlers/handle-search.ts';
import type { JobScopedSearchCache } from './job-scoped-search-cache.ts';
import handleRealmInfo from './handlers/handle-realm-info.ts';
import handleFederatedTypes from './handlers/handle-federated-types.ts';
import { multiRealmAuthorization } from './middleware/multi-realm-authorization.ts';
import handleDownloadRealm from './handlers/handle-download-realm.ts';
import {
  handleBotRegistrationRequest,
  handleBotRegistrationsRequest,
  handleBotUnregistrationRequest,
} from './handlers/handle-bot-registration.ts';
import {
  handleBotCommandDeleteRequest,
  handleBotCommandsListRequest,
  handleBotCommandsRequest,
} from './handlers/handle-bot-commands.ts';
import {
  handleCreateIncomingWebhookRequest,
  handleListIncomingWebhooksRequest,
  handleDeleteIncomingWebhookRequest,
} from './handlers/handle-incoming-webhook.ts';
import {
  handleCreateWebhookCommandRequest,
  handleListWebhookCommandsRequest,
  handleDeleteWebhookCommandRequest,
} from './handlers/handle-webhook-commands.ts';
import handleWebhookReceiverRequest from './handlers/handle-webhook-receiver.ts';
import handleRunCommand from './handlers/handle-run-command.ts';
import handleScreenshotCard from './handlers/handle-screenshot-card.ts';
import { buildCreatePrerenderAuth } from './prerender/auth.ts';
import type { RealmRegistryReconciler } from './lib/realm-registry-reconciler.ts';

export type CreateRoutesArgs = {
  serverURL: string;
  dbAdapter: DBAdapter;
  definitionLookup: DefinitionLookup;
  matrixClient: MatrixClient;
  realmServerSecretSeed: string;
  grafanaSecret: string;
  realmSecretSeed: string;
  // Shared secret authenticating ai-bot's delegation requests (CS-11552).
  // Optional: when unset, the /_delegate-session endpoint responds 503 rather
  // than minting tokens, so the feature stays inert until a secret is
  // provisioned.
  aiBotDelegationSecret?: string;
  virtualNetwork: VirtualNetwork;
  queue: QueuePublisher;
  realms: Realm[];
  reconciler: RealmRegistryReconciler;
  realmsRootPath: string;
  getMatrixRegistrationSecret: () => Promise<string>;
  // Synapse admin credentials. Optional at the top: when both are unset the
  // grafana upsert handler falls back to a localhost-only default so local
  // dev / tests don't need to thread env vars through. When provided they
  // are used as-is for any environment (staging, prod).
  matrixAdminUsername?: string;
  matrixAdminPassword?: string;
  serveHostApp: (ctxt: Koa.Context, next: Koa.Next) => Promise<any>;
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
  // Reports the current host-shell token to the prerender manager. The
  // post-deployment hook calls it so the fleet's recycle signal is refreshed
  // once the new code is live and the service is stable.
  reportHostShell?: () => Promise<void>;
  searchCache: JobScopedSearchCache;
};

export function createRoutes(args: CreateRoutesArgs) {
  let createPrerenderAuth = buildCreatePrerenderAuth(
    args.realmSecretSeed,
    args.serverURL,
  );
  let router = new Router();
  // One job-scoped search cache per realm-server process, created by the
  // composition root (main.ts) and shared with the JobsFinishedListener so a
  // `jobs_finished` NOTIFY can evict a finished job's entries immediately. An
  // age-based janitor reclaims any entries a job leaves behind on a missed
  // NOTIFY.
  let searchCache = args.searchCache;

  let createRealmDeps: CreateRealmDeps = {
    serverURL: new URL(args.serverURL),
    realms: args.realms,
    dbAdapter: args.dbAdapter,
    virtualNetwork: args.virtualNetwork,
    realmsRootPath: args.realmsRootPath,
    reconciler: args.reconciler,
  };

  router.get(
    '/',
    healthCheck,
    args.serveIndex,
    args.serveHostApp,
    args.serveFromRealm,
  );
  router.get('/_standby', healthCheck, args.serveHostApp, args.serveFromRealm);
  router.post('/_server-session', handleCreateSessionRequest(args));
  router.post(
    '/_create-realm',
    jwtMiddleware(args.realmSecretSeed),
    handleCreateRealmRequest(createRealmDeps),
  );
  router.delete(
    '/_delete-realm',
    jwtMiddleware(args.realmSecretSeed),
    handleDeleteRealm(args),
  );
  router.get('/_catalog-realms', handleFetchCatalogRealmsRequest(args));
  router.get('/_queue-status', handleQueueStatusRequest(args));
  // Monitoring endpoint validating that every skill's command codeRefs
  // resolve in the deployed host. Self-authenticated with the monitoring
  // token, same as /_queue-status.
  router.get('/_skill-validation', handleSkillValidation(args));
  router.post(
    '/_run-command',
    jwtMiddleware(args.realmSecretSeed),
    handleRunCommand(args),
  );
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
  router.post(
    '/_openrouter/chat/completions',
    jwtMiddleware(args.realmSecretSeed),
    handleOpenRouterPassthrough({
      dbAdapter: args.dbAdapter,
    }),
  );
  router.all(
    '/_federated-search',
    multiRealmAuthorization(args),
    handleSearch({ reconciler: args.reconciler, searchCache }),
  );
  router.all(
    '/_federated-info',
    multiRealmAuthorization(args),
    handleRealmInfo({
      dbAdapter: args.dbAdapter,
      reconciler: args.reconciler,
    }),
  );
  router.all(
    '/_federated-types',
    multiRealmAuthorization(args),
    handleFederatedTypes({
      dbAdapter: args.dbAdapter,
      reconciler: args.reconciler,
    }),
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
    '/_screenshot-card',
    jwtMiddleware(args.realmSecretSeed),
    handleScreenshotCard(args),
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
  router.post(
    '/_archive-realm',
    jwtMiddleware(args.realmSecretSeed),
    handleArchiveRealm(args),
  );
  router.post(
    '/_unarchive-realm',
    jwtMiddleware(args.realmSecretSeed),
    handleUnarchiveRealm(args),
  );
  router.get(
    '/_archived-realms',
    jwtMiddleware(args.realmSecretSeed),
    handleArchivedRealms(args),
  );

  // Grafana operator-action endpoints. All POST-only with
  // `Authorization: Bearer <token>` against the shared `grafanaSecret`.
  // Handlers read params from `ctxt.URL.searchParams` (Grafana button
  // panels POST with the params on the querystring, not in a JSON body).
  let registerGrafanaEndpoint = (path: string, handler: Koa.Middleware) => {
    router.post(path, grafanaAuthorization(args.grafanaSecret), handler);
  };
  registerGrafanaEndpoint('/_grafana-reindex', handleReindex(args));
  registerGrafanaEndpoint('/_grafana-complete-job', handleRemoveJob(args));
  registerGrafanaEndpoint('/_grafana-add-credit', handleAddCredit(args));
  registerGrafanaEndpoint('/_grafana-full-reindex', handleFullReindex(args));
  registerGrafanaEndpoint(
    '/_grafana-upsert-realm-user-permission',
    handleUpsertRealmUserPermission(args),
  );
  router.post('/_post-deployment', handlePostDeployment(args));
  router.post(
    '/_realm-auth',
    jwtMiddleware(args.realmSecretSeed),
    handleRealmAuth(args),
  );
  // Shared-secret authenticated (HMAC over body + timestamp); auth is handled
  // inside the handler because the signature covers the request body.
  router.post('/_delegate-session', handleDelegateSession(args));
  // Handles a worker-originated request bridged in through the worker manager,
  // dispatched on its `type`. Shared-secret authenticated (HMAC over body +
  // timestamp), same as /_delegate-session — auth is inside the handler.
  router.post('/_worker-request', handleWorkerRequest(args));
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
    '/_unlisted-realm-path',
    jwtMiddleware(args.realmSecretSeed),
    handleUnlistedRealmPathRequest(args),
  );
  // Matrix tests don't need the GitHub PR integration, and skipping this route
  // keeps the realm server from loading Octokit's ESM entrypoint during boot.
  if (process.env.DISABLE_GITHUB_PR_ROUTE !== 'true') {
    router.post(
      '/_github-pr',
      jwtMiddleware(args.realmSecretSeed),
      handleGitHubPRRequestLazy(args),
    );
  }
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
  router.post(
    '/_bot-commands',
    jwtMiddleware(args.realmSecretSeed),
    handleBotCommandsRequest(args),
  );
  router.get(
    '/_bot-commands',
    jwtMiddleware(args.realmSecretSeed),
    handleBotCommandsListRequest(args),
  );
  router.delete(
    '/_bot-commands',
    jwtMiddleware(args.realmSecretSeed),
    handleBotCommandDeleteRequest(args),
  );
  router.post(
    '/_incoming-webhooks',
    jwtMiddleware(args.realmSecretSeed),
    handleCreateIncomingWebhookRequest(args),
  );
  router.get(
    '/_incoming-webhooks',
    jwtMiddleware(args.realmSecretSeed),
    handleListIncomingWebhooksRequest(args),
  );
  router.delete(
    '/_incoming-webhooks',
    jwtMiddleware(args.realmSecretSeed),
    handleDeleteIncomingWebhookRequest(args),
  );
  router.post(
    '/_webhook-commands',
    jwtMiddleware(args.realmSecretSeed),
    handleCreateWebhookCommandRequest(args),
  );
  router.get(
    '/_webhook-commands',
    jwtMiddleware(args.realmSecretSeed),
    handleListWebhookCommandsRequest(args),
  );
  router.delete(
    '/_webhook-commands',
    jwtMiddleware(args.realmSecretSeed),
    handleDeleteWebhookCommandRequest(args),
  );
  router.post('/_webhooks/:webhookPath', handleWebhookReceiverRequest(args));

  return router.routes();
}

function handleGitHubPRRequestLazy(args: CreateRoutesArgs) {
  let handler:
    | ((ctxt: Koa.Context, next: Koa.Next) => Promise<void>)
    | undefined;

  return async function (ctxt: Koa.Context, next: Koa.Next) {
    if (!handler) {
      handler = (
        createRequire(import.meta.filename)(
          './handlers/handle-github-pr',
        ) as typeof import('./handlers/handle-github-pr.ts')
      ).default(args);
    }
    return await handler(ctxt, next);
  };
}
