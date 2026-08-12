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
import handlePublishProgress from './handlers/handle-publish-progress.ts';
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
import handleClientTelemetry from './handlers/handle-client-telemetry.ts';
import handleQueueStatusRequest from './handlers/handle-queue-status.ts';
import handleSkillValidation from './handlers/handle-skill-validation.ts';
import handleReindex from './handlers/handle-reindex.ts';
import handleFullReindex from './handlers/handle-full-reindex.ts';
import handleRemoveJob from './handlers/handle-remove-job.ts';
import handleAddCredit from './handlers/handle-add-credit.ts';
import handleUpsertRealmUserPermission from './handlers/handle-upsert-realm-user-permission.ts';
import handleRevokeUserSessions from './handlers/handle-revoke-user-sessions.ts';
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
import handleRealmIndexCounts from './handlers/handle-realm-index-counts.ts';
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
  // Root of the Deck object stores backing the versioned package address
  // space (`<realm>/_packages/<name>@<version>/<path>`). One store PER REALM
  // beneath this path — see `lib/package-store.ts` — so no realm's package
  // names can collide with another's and the server governs no namespace.
  // Optional: when unset the serve handler answers 501 and nothing else in
  // the server changes, so the address space stays inert until a store is
  // deliberately provisioned.
  packageStorePath?: string;
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
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleCreateRealmRequest(createRealmDeps, args.sendEvent),
  );
  router.delete(
    '/_delete-realm',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
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
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleRunCommand(args),
  );
  router.post('/_stripe-webhook', handleStripeWebhookRequest(args));
  router.post(
    '/_stripe-session',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleCreateStripeSessionRequest(args),
  );
  router.get(
    '/_user',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleFetchUserRequest(args),
  );
  router.post(
    '/_user',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleCreateUserRequest(args),
  );
  router.post(
    '/_request-forward',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleRequestForward({
      dbAdapter: args.dbAdapter,
    }),
  );
  // Batched client performance beacons. The host sends its server session
  // token as `Authorization: Bearer <token>`, so the standard jwtMiddleware
  // authenticates the caller and the authenticated matrix user id is used in
  // preference to the body's self-reported value.
  router.post(
    '/_client-telemetry',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleClientTelemetry(),
  );
  router.post(
    '/_openrouter/chat/completions',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
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
    '/_federated-index-counts',
    multiRealmAuthorization(args),
    handleRealmIndexCounts({
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
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handlePrerenderProxy({
      kind: 'card',
      prerenderer: args.prerenderer,
      dbAdapter: args.dbAdapter,
      createPrerenderAuth,
    }),
  );
  router.post(
    '/_prerender-module',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handlePrerenderProxy({
      kind: 'module',
      prerenderer: args.prerenderer,
      dbAdapter: args.dbAdapter,
      createPrerenderAuth,
    }),
  );
  router.post(
    '/_prerender-file-extract',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handlePrerenderProxy({
      kind: 'file-extract',
      prerenderer: args.prerenderer,
      dbAdapter: args.dbAdapter,
      createPrerenderAuth,
    }),
  );
  router.post(
    '/_screenshot-card',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleScreenshotCard(args),
  );
  router.post(
    '/_publish-realm',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handlePublishRealm(args),
  );
  router.get(
    '/_publish-progress',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handlePublishProgress(args),
  );
  router.post(
    '/_unpublish-realm',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleUnpublishRealm(args),
  );
  router.post(
    '/_archive-realm',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleArchiveRealm(args),
  );
  router.post(
    '/_unarchive-realm',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleUnarchiveRealm(args),
  );
  router.get(
    '/_archived-realms',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
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
  registerGrafanaEndpoint(
    '/_grafana-revoke-user-sessions',
    handleRevokeUserSessions(args),
  );
  router.post('/_post-deployment', handlePostDeployment(args));
  router.post(
    '/_realm-auth',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
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
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleCheckBoxelDomainAvailabilityRequest(args),
  );
  router.get(
    '/_boxel-claimed-domains',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleGetBoxelClaimedDomainRequest(args),
  );
  router.post(
    '/_boxel-claimed-domains',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleClaimBoxelDomainRequest(args),
  );
  router.delete(
    '/_boxel-claimed-domains/:claimedDomainId',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleDeleteBoxelClaimedDomainRequest(args),
  );
  router.post(
    '/_unlisted-realm-path',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleUnlistedRealmPathRequest(args),
  );
  // Matrix tests don't need the GitHub PR integration, and skipping this route
  // keeps the realm server from loading Octokit's ESM entrypoint during boot.
  if (process.env.DISABLE_GITHUB_PR_ROUTE !== 'true') {
    router.post(
      '/_github-pr',
      jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
      handleGitHubPRRequestLazy(args),
    );
  }
  router.get('/_download-realm', handleDownloadRealm(args));
  // THE SERVE DOORS ARE NOT ROUTES ANY MORE. `/_packages/…` and `/_source/…`
  // used to hang off the server root, which made this server the arbiter of a
  // global publisher namespace — see `lib/package-store.ts`. They now hang off
  // a REALM (`<realm>/_packages/…`), whose path is not a fixed number of
  // segments, so they are a middleware mounted ahead of the realm fallthrough
  // in `server.ts` rather than a pattern here. Nothing is registered at the
  // root on purpose: an address with no realm in it has no namespace owner,
  // and 404 is the honest answer.
  //
  // The write half of the same address space is realm-relative too
  // (`<realm>/_package-proposals/<name>`) and mounted the same way, in
  // `server.ts`. It has to be: a proposal record lives in its realm's store,
  // so `accept` and the queue listing cannot even be answered without knowing
  // which realm is meant.
  //
  // It stays at its own path rather than becoming a POST branch on the serve
  // door — that handler's header records "a GET must never be able to mutate
  // the store, and keeping the gate out of reach is cheaper than proving it is
  // never invoked", and sharing a prefix would put the gate back within reach
  // of a routing mistake. The queue is readable without a token because a
  // review nobody may read is not a review; proposing and accepting need one,
  // and the identity on the record comes from that token rather than the body.
  router.post(
    '/_bot-registration',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleBotRegistrationRequest(args),
  );
  router.get(
    '/_bot-registrations',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleBotRegistrationsRequest(args),
  );
  router.delete(
    '/_bot-registration',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleBotUnregistrationRequest(args),
  );
  router.post(
    '/_bot-commands',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleBotCommandsRequest(args),
  );
  router.get(
    '/_bot-commands',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleBotCommandsListRequest(args),
  );
  router.delete(
    '/_bot-commands',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleBotCommandDeleteRequest(args),
  );
  router.post(
    '/_incoming-webhooks',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleCreateIncomingWebhookRequest(args),
  );
  router.get(
    '/_incoming-webhooks',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleListIncomingWebhooksRequest(args),
  );
  router.delete(
    '/_incoming-webhooks',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleDeleteIncomingWebhookRequest(args),
  );
  router.post(
    '/_webhook-commands',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleCreateWebhookCommandRequest(args),
  );
  router.get(
    '/_webhook-commands',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleListWebhookCommandsRequest(args),
  );
  router.delete(
    '/_webhook-commands',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
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
