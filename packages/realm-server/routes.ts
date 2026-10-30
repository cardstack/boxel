import type {
  DBAdapter,
  DefinitionLookup,
  MediaCacheAdapter,
  QueuePublisher,
  Realm,
  VirtualNetwork,
  Prerenderer,
  LinkShapePolicy,
} from '@cardstack/runtime-common';
import { DBRateLimitStore } from '@cardstack/runtime-common';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import Router from '@koa/router';
import { createRequire } from 'module';
import handleCreateSessionRequest from './handlers/handle-create-session.ts';
import handleCreateRealmRequest, {
  type CreateRealmDeps,
} from './handlers/create-realm.ts';
import handleDeleteRealm from './handlers/handle-delete-realm.ts';
import {
  handleDataKeyReseal,
  handleDataKeyStatus,
} from './handlers/handle-data-keys.ts';
import {
  handleAddSystemKey,
  handleDeleteSystemKey,
  handleListSystemKeys,
  handleReplaceSystemKey,
  handleShowSystemKey,
} from './handlers/handle-system-keys.ts';
import { handleDiagnosticRenderToken } from './handlers/handle-diagnostic-render-token.ts';
import handleFetchCatalogRealmsRequest from './handlers/handle-fetch-catalog-realms.ts';
import handleFetchPublicRealmsRequest from './handlers/handle-fetch-public-realms.ts';
import handleFetchUserRequest from './handlers/handle-fetch-user.ts';
import handleStripeWebhookRequest from './handlers/handle-stripe-webhook.ts';
import handlePublishRealm from './handlers/handle-publish-realm.ts';
import handlePublishProgress from './handlers/handle-publish-progress.ts';
import handleHostRoute from './handlers/handle-host-route.ts';
import handleUnpublishRealm from './handlers/handle-unpublish-realm.ts';
import handleArchiveRealm from './handlers/handle-archive-realm.ts';
import handleUnarchiveRealm from './handlers/handle-unarchive-realm.ts';
import handleArchivedRealms from './handlers/handle-archived-realms.ts';
import {
  healthCheck,
  jwtMiddleware,
  grafanaAuthorization,
  operatorAuthorization,
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
import handleRealmEventRooms from './handlers/handle-realm-event-rooms.ts';
import handleSetRealmCatalog from './handlers/handle-set-realm-catalog.ts';
import handleDelegateSession from './handlers/handle-delegate-session.ts';
import handleWorkerRequest from './handlers/handle-worker-request.ts';
import handleGetBoxelClaimedDomainRequest from './handlers/handle-get-boxel-claimed-domain.ts';
import handleClaimBoxelDomainRequest from './handlers/handle-claim-boxel-domain.ts';
import handleDeleteBoxelClaimedDomainRequest from './handlers/handle-delete-boxel-claimed-domain.ts';
import handleUnlistedRealmPathRequest from './handlers/handle-unlisted-realm-path.ts';
import handlePrerenderProxy from './handlers/handle-prerender-proxy.ts';
import handleSearch from './handlers/handle-search.ts';
import type { JobScopedSearchCache } from './job-scoped-search-cache.ts';
import type { LiveSearchCache } from './live-search-cache.ts';
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
  handleRotateIncomingWebhookSecretRequest,
} from './handlers/handle-incoming-webhook.ts';
import {
  handleCreateWebhookCommandRequest,
  handleListWebhookCommandsRequest,
  handleDeleteWebhookCommandRequest,
} from './handlers/handle-webhook-commands.ts';
import handleWebhookReceiverRequest from './handlers/handle-webhook-receiver.ts';
import handleRunCommand from './handlers/handle-run-command.ts';
import handleCapture from './handlers/handle-capture.ts';
import { buildCreatePrerenderAuth } from './prerender/auth.ts';
import type { RealmRegistryReconciler } from './lib/realm-registry-reconciler.ts';
import {
  KEY_BINDINGS_PATH,
  KEY_SHARE_NOTICES_PATH,
  KEY_SHARES_PATH,
  KEY_WRITE_TICKETS_PATH,
  OAUTH_PATH,
  OPENROUTER_PASSTHROUGH_PATH,
  PLATFORM_OAUTH_CLIENTS_PATH,
  REQUEST_FORWARD_PATH,
  SECURE_SESSION_PATH,
  SECURE_SESSIONS_PATH,
  SECURE_WINDOW_PATH,
  USER_KEY_GRANTS_PATH,
  USER_KEYS_PATH,
} from './lib/request-telemetry.ts';
import {
  handleCheckSecureSession,
  handleEndSecureSession,
  handleEndWindowSessions,
  handleGoogleSignIn,
  handleGoogleSignInStart,
  handleMintLoginToken,
  handleRenewSecureSession,
  handlePasswordChange,
  handlePasswordSignIn,
  handleSecureOriginInfo,
  resumePasswordChangeDeviceSweeps,
} from './handlers/handle-secure-session.ts';
import { SignInLimiter } from './lib/sign-in-limiter.ts';
import { SECURE_SESSION_TTL_SECONDS } from './lib/secure-session.ts';
import type { GoogleSignInConfig } from './lib/google-sign-in.ts';
import {
  handleAddUserKey,
  handleDeleteUserKey,
  handleListUserKeys,
  handleMintKeyWriteTicket,
  handleReplaceUserKey,
  handleShowUserKey,
} from './handlers/handle-user-keys.ts';
import {
  handleCreateUserKeyGrant,
  handleRemoveUserKeyGrant,
} from './handlers/handle-user-key-grants.ts';
import {
  handleApproveKeyBindings,
  handleListKeyBindings,
  handlePreviewKeyBindings,
  handleKeyBindingBatch,
  handleRevokeKeyBinding,
} from './handlers/handle-key-bindings.ts';
import {
  handleListKeyShareNotices,
  handleListKeyShares,
  handleResumeKeyShare,
  handleShareKey,
  handleSuspendKeyShare,
  handleSwapKeyIntoShare,
  handleUnshareKey,
} from './handlers/handle-key-shares.ts';
import {
  handleSecureWindowContext,
  handleSecureWindowRealms,
  handleSecureWindowCards,
} from './handlers/handle-secure-window.ts';
import {
  handleAddPlatformClient,
  handleCompleteConnect,
  handleDeletePlatformClient,
  handleListConnectableClients,
  handleListPlatformClients,
  handleOAuthCallback,
  handleReplacePlatformClient,
  handleStartConnect,
} from './handlers/handle-oauth.ts';

export type CreateRoutesArgs = {
  serverURL: string;
  dbAdapter: DBAdapter;
  definitionLookup: DefinitionLookup;
  // MediaCache object store; absent means the POST capture endpoint
  // captures without persisting (and returns no served URL).
  mediaCacheAdapter?: MediaCacheAdapter;
  // Bounded sync-wait budget for the POST capture endpoint. Defaults to
  // CAPTURE_SYNC_WAIT_BUDGET_MS; tests shrink it to exercise the
  // 503 + Retry-After path without holding real time.
  captureSyncWaitMs?: number;
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
  // The host app's origin, where the render route is served.
  hostURL: URL;
  prerenderer?: Prerenderer;
  // Reports the current host-shell token to the prerender manager. The
  // post-deployment hook calls it so the fleet's recycle signal is refreshed
  // once the new code is live and the service is stable.
  reportHostShell?: () => Promise<void>;
  searchCache: JobScopedSearchCache;
  // Per-process coalescing + short-TTL cache for live `_federated-search`
  // traffic. Injectable so a test can supply one configured with `ttlMs: 0`
  // (coalescing on, retention off) to force each caller to compute; when
  // unset the handler constructs its own with production defaults.
  liveSearchCache?: LiveSearchCache;
  // Decides how much of each result's link graph a live search carries.
  linkShapePolicy?: LinkShapePolicy;
  // The secure origin's shell URL, when this server serves one. Signing in on
  // the secure origin is answered only for requests from its origin, and key
  // write tickets are minted for requests from its origin and for the CLI.
  secureOriginURL?: URL;
  // The Google client the secure window signs in with. Unset, the secure
  // window offers only a password.
  googleSignIn?: GoogleSignInConfig;
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
  router.get(
    '/_public-realms',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleFetchPublicRealmsRequest(args),
  );
  router.get('/_queue-status', handleQueueStatusRequest(args));
  // Monitoring endpoint validating that every skill's command codeRefs
  // resolve in the deployed host. Self-authenticated with the monitoring
  // token, same as /_queue-status.
  router.get('/_skill-validation', handleSkillValidation(args));
  router.post(
    '/_run-command',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleRunCommand({
      dbAdapter: args.dbAdapter,
      matrixClient: args.matrixClient,
      prerenderer: args.prerenderer,
      createPrerenderAuth,
    }),
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
  router.get('/_secure-origin', handleSecureOriginInfo(args));
  router.post(
    SECURE_SESSION_PATH,
    handlePasswordSignIn(args, createRealmDeps, new SignInLimiter()),
  );
  router.get(`${SECURE_SESSION_PATH}/google`, handleGoogleSignInStart(args));
  router.post(
    `${SECURE_SESSION_PATH}/google`,
    handleGoogleSignIn(args, createRealmDeps),
  );
  router.get(
    SECURE_SESSION_PATH,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleCheckSecureSession(args),
  );
  router.delete(
    SECURE_SESSION_PATH,
    // Signing out only ends a session, and a window's session bound to an
    // app device outlives its token, so any expired token is taken here too.
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter, {
      expiredWithinSeconds: Number.POSITIVE_INFINITY,
    }),
    handleEndSecureSession(args),
  );
  router.post(
    `${SECURE_SESSION_PATH}/login-token`,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleMintLoginToken(args),
  );
  router.post(
    `${SECURE_SESSION_PATH}/renewal`,
    // A window's session outlives its token while the app device it is bound
    // to exists, so any expired token is taken here; the row it names decides.
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter, {
      expiredWithinSeconds: Number.POSITIVE_INFINITY,
    }),
    handleRenewSecureSession(args),
  );
  router.delete(
    SECURE_SESSIONS_PATH,
    // The app asks for this as it signs out, with whatever session it holds,
    // which may have expired while a refresh was due (a slept laptop). A
    // session that expired no longer ago than a secure session lasts is still
    // the user's, and all this route can do is sign them out.
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter, {
      expiredWithinSeconds: SECURE_SESSION_TTL_SECONDS,
    }),
    handleEndWindowSessions(args),
  );
  router.post(
    `${SECURE_SESSIONS_PATH}/password-change`,
    handlePasswordChange(args),
  );
  resumePasswordChangeDeviceSweeps(args);
  router.post(
    KEY_WRITE_TICKETS_PATH,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleMintKeyWriteTicket(args),
  );
  router.get(
    USER_KEYS_PATH,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleListUserKeys(args),
  );
  router.post(
    USER_KEYS_PATH,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleAddUserKey(args),
  );
  router.get(
    `${USER_KEYS_PATH}/:keyId`,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleShowUserKey(args),
  );
  router.patch(
    `${USER_KEYS_PATH}/:keyId`,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleReplaceUserKey(args),
  );
  router.delete(
    `${USER_KEYS_PATH}/:keyId`,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleDeleteUserKey(args),
  );
  router.post(
    USER_KEY_GRANTS_PATH,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleCreateUserKeyGrant(args),
  );
  router.delete(
    `${USER_KEY_GRANTS_PATH}/:grantId`,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleRemoveUserKeyGrant(args),
  );
  router.get(
    KEY_BINDINGS_PATH,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleListKeyBindings(args),
  );
  router.get(
    `${KEY_BINDINGS_PATH}/preview`,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handlePreviewKeyBindings(args),
  );
  router.post(
    KEY_BINDINGS_PATH,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleApproveKeyBindings(args),
  );
  router.post(
    `${KEY_BINDINGS_PATH}/batch`,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleKeyBindingBatch(args),
  );
  router.delete(
    `${KEY_BINDINGS_PATH}/:bindingId`,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleRevokeKeyBinding(args),
  );
  router.get(
    KEY_SHARES_PATH,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleListKeyShares(args),
  );
  router.post(
    KEY_SHARES_PATH,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleShareKey(args),
  );
  router.delete(
    `${KEY_SHARES_PATH}/:shareId`,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleUnshareKey(args),
  );
  router.post(
    `${KEY_SHARES_PATH}/:shareId/suspend`,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleSuspendKeyShare(args),
  );
  router.post(
    `${KEY_SHARES_PATH}/:shareId/resume`,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleResumeKeyShare(args),
  );
  router.post(
    `${KEY_SHARES_PATH}/:shareId/swap`,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleSwapKeyIntoShare(args),
  );
  router.get(
    KEY_SHARE_NOTICES_PATH,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleListKeyShareNotices(args),
  );
  router.get(
    `${OAUTH_PATH}/clients`,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleListConnectableClients(args),
  );
  router.post(
    `${OAUTH_PATH}/connections`,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleStartConnect(args),
  );
  router.post(
    `${OAUTH_PATH}/connections/complete`,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleCompleteConnect(args),
  );
  // The vendor sends the person here with no Boxel session; it only hands
  // the code on to the secure window, which finishes under its own session.
  router.get(`${OAUTH_PATH}/callback`, handleOAuthCallback(args));
  router.post(
    `${SECURE_WINDOW_PATH}/context`,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleSecureWindowContext(args),
  );
  router.get(
    `${SECURE_WINDOW_PATH}/realms`,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleSecureWindowRealms(args),
  );
  router.post(
    `${SECURE_WINDOW_PATH}/cards`,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleSecureWindowCards(args),
  );
  router.post(
    REQUEST_FORWARD_PATH,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleRequestForward({
      dbAdapter: args.dbAdapter,
    }),
  );
  // Batched client performance beacons. The host sends its server session
  // token as `Authorization: Bearer <token>`, and the secure origin's pages
  // their window's own session once they have one. The handler authenticates
  // the session itself, since a beacon without one is accepted too (rate
  // limited, and attributed to nobody).
  router.post(
    '/_client-telemetry',
    handleClientTelemetry({
      realmSecretSeed: args.realmSecretSeed,
      dbAdapter: args.dbAdapter,
      rateLimitStore: new DBRateLimitStore(args.dbAdapter),
    }),
  );
  router.post(
    OPENROUTER_PASSTHROUGH_PATH,
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleOpenRouterPassthrough({
      dbAdapter: args.dbAdapter,
    }),
  );
  router.all(
    '/_federated-search',
    multiRealmAuthorization(args, { unreadableRealms: 'carry' }),
    handleSearch({
      reconciler: args.reconciler,
      realmsRootPath: args.realmsRootPath,
      searchCache,
      dbAdapter: args.dbAdapter,
      virtualNetwork: args.virtualNetwork,
      liveSearchCache: args.liveSearchCache,
      linkShapePolicy: args.linkShapePolicy,
    }),
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
      matrixURL: args.matrixClient.matrixURL.href,
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
      matrixURL: args.matrixClient.matrixURL.href,
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
      matrixURL: args.matrixClient.matrixURL.href,
      createPrerenderAuth,
    }),
  );
  // Captures a card or a file in a realm (see handle-capture). The
  // endpoint's former names answer through the same handler: `boxel-cli` is
  // installed and pinned independently of this server, and a host tab can run
  // an older build than the server it talks to, so released clients post
  // there for as long as those versions are in use.
  for (let path of ['/_capture', '/_capture-card', '/_screenshot-card']) {
    router.post(
      path,
      jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
      handleCapture(args),
    );
  }
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
  // Public: what a site serves at a path, and where it serves a card, for
  // the host app's in-app navigation. Answers only for public realms.
  router.get('/_host-route', handleHostRoute(args));
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

  // Rotating the data key that seals stored secrets. Only an operator token
  // signed with the realm secret seed reaches these.
  router.get(
    '/_data-keys',
    operatorAuthorization(args.realmSecretSeed, 'data-keys', args.serverURL),
    handleDataKeyStatus(args),
  );
  router.post(
    '/_data-keys/reseal',
    operatorAuthorization(args.realmSecretSeed, 'data-keys', args.serverURL),
    handleDataKeyReseal(args),
  );

  // System keys: the platform's own vendor keys that `_request-forward`
  // attaches. Only an operator token for `system-keys` reaches these, and
  // none of them answers with a value.
  let systemKeysAuthorization = operatorAuthorization(
    args.realmSecretSeed,
    'system-keys',
    args.serverURL,
  );
  router.get(
    '/_system-keys',
    systemKeysAuthorization,
    handleListSystemKeys(args),
  );
  router.post(
    '/_system-keys',
    systemKeysAuthorization,
    handleAddSystemKey(args),
  );
  router.get(
    '/_system-keys/:id',
    systemKeysAuthorization,
    handleShowSystemKey(args),
  );
  router.patch(
    '/_system-keys/:id',
    systemKeysAuthorization,
    handleReplaceSystemKey(args),
  );
  router.delete(
    '/_system-keys/:id',
    systemKeysAuthorization,
    handleDeleteSystemKey(args),
  );
  // The OAuth clients Boxel registers itself, which connect mode offers
  // everyone. The same operator token as system keys reaches these.
  router.get(
    PLATFORM_OAUTH_CLIENTS_PATH,
    systemKeysAuthorization,
    handleListPlatformClients(args),
  );
  router.post(
    PLATFORM_OAUTH_CLIENTS_PATH,
    systemKeysAuthorization,
    handleAddPlatformClient(args),
  );
  router.patch(
    `${PLATFORM_OAUTH_CLIENTS_PATH}/:name`,
    systemKeysAuthorization,
    handleReplacePlatformClient(args),
  );
  router.delete(
    `${PLATFORM_OAUTH_CLIENTS_PATH}/:name`,
    systemKeysAuthorization,
    handleDeletePlatformClient(args),
  );

  // Diagnostic sessions: what an operator renders a live card under to see it
  // as the indexer does. Only an operator token for `diagnostic-render`
  // reaches this.
  router.post(
    '/_diagnostic-render-token',
    operatorAuthorization(
      args.realmSecretSeed,
      'diagnostic-render',
      args.serverURL,
    ),
    handleDiagnosticRenderToken(args),
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
  registerGrafanaEndpoint(
    '/_grafana-set-realm-catalog',
    handleSetRealmCatalog(args),
  );
  router.post('/_post-deployment', handlePostDeployment(args));
  router.post(
    '/_realm-auth',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleRealmAuth(args),
  );
  router.post(
    '/_realm-event-rooms',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleRealmEventRooms(args),
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
    '/_incoming-webhooks/rotate-signing-secret',
    jwtMiddleware(args.realmSecretSeed, args.dbAdapter),
    handleRotateIncomingWebhookSecretRequest(args),
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
