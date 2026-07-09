import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { getOwner } from '@ember/owner';
import type RouterService from '@ember/routing/router-service';
import { debounce } from '@ember/runloop';
import Service, { service } from '@ember/service';
import { isTesting } from '@embroider/macros';
import { cached, tracked } from '@glimmer/tracking';

import {
  dropTask,
  rawTimeout,
  restartableTask,
  task,
  timeout,
} from 'ember-concurrency';
import window from 'ember-window-mock';
import { cloneDeep } from 'lodash-es';

import { Filter } from 'matrix-js-sdk';
import {
  type SlidingSync,
  type MSC3575List,
  SlidingSyncEvent,
  SlidingSyncState,
  type MSC3575SlidingSyncResponse,
} from 'matrix-js-sdk/lib/sliding-sync';
import stringify from 'safe-stable-stringify';
import { TrackedMap } from 'tracked-built-ins';
import { v4 as uuidv4 } from 'uuid';

import type {
  LooseCardResource,
  ResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  aiBotUsername,
  submissionBotUsername,
  logger,
  Deferred,
  ri,
  SEARCH_MARKER,
  REPLACE_MARKER,
  SEPARATOR_MARKER,
  isCardErrorJSONAPI,
  stringifyErrorForLog,
} from '@cardstack/runtime-common';

import { getPromptParts } from '@cardstack/runtime-common/ai';
import { getMatrixUsername } from '@cardstack/runtime-common/matrix-client';

import {
  APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
  APP_BOXEL_CODE_PATCH_RESULT_MSGTYPE,
  APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE,
  APP_BOXEL_TOOL_RESULT_EVENT_TYPE,
  APP_BOXEL_TOOL_RESULT_REL_TYPE,
  APP_BOXEL_TOOL_RESULT_WITH_NO_OUTPUT_MSGTYPE,
  APP_BOXEL_TOOL_RESULT_WITH_OUTPUT_MSGTYPE,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_REALM_EVENT_TYPE,
  APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE,
  APP_BOXEL_REALMS_EVENT_TYPE,
  APP_BOXEL_REALM_SERVERS_EVENT_TYPE,
  APP_BOXEL_WORKSPACE_FAVORITES_EVENT_TYPE,
  APP_BOXEL_ACTIVE_LLM,
  APP_BOXEL_LLM_MODE,
  DEFAULT_FALLBACK_MODELS,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  APP_BOXEL_STOP_GENERATING_EVENT_TYPE,
  INITIAL_SLIDING_SYNC_LIST_TIMELINE_LIMIT,
  SLIDING_SYNC_AI_ROOM_LIST_NAME,
  SLIDING_SYNC_AI_ROOM_TIMELINE_LIMIT,
  SLIDING_SYNC_AUTH_ROOM_LIST_NAME,
  SLIDING_SYNC_AUTH_ROOM_TIMELINE_LIMIT,
  SLIDING_SYNC_LIST_RANGE_END,
  SLIDING_SYNC_TIMEOUT,
  type LLMMode,
  getToolRequests,
  APP_BOXEL_SYSTEM_CARD_EVENT_TYPE,
} from '@cardstack/runtime-common/matrix-constants';

import {
  type Submode,
  Submodes,
} from '@cardstack/host/components/submode-switcher';
import ENV from '@cardstack/host/config/environment';

import type IndexController from '@cardstack/host/controllers/index';

import type { TempEvent } from '@cardstack/host/lib/matrix-classes/room';
import Room from '@cardstack/host/lib/matrix-classes/room';
import { getRandomBackgroundURL, iconURLFor } from '@cardstack/host/lib/utils';
import { getMatrixProfile } from '@cardstack/host/resources/matrix-profile';
import { clearLocalStorage } from '@cardstack/host/utils/local-storage-keys';

import { isSkillCard } from '../lib/file-def-manager';
import { getSkillSourceTools, loadSkillSource } from '../lib/skill-tools';
import { getUniqueValidToolDefinitions } from '../lib/tool-definitions';
import {
  sourceCodeEditingSkillUrl,
  devSkillId,
  envSkillId,
} from '../lib/utils';
import { importResource } from '../resources/import';

import { getRoom } from '../resources/room';
import UpdateRoomSkillsTool from '../tools/update-room-skills';
import { addPatchTools } from '../tools/utils';

import type CardService from './card-service';
import type LoaderService from './loader-service';
import type LocalPersistenceService from './local-persistence-service';
import type {
  PendingSendStatus,
  StoredPendingFile,
} from './local-persistence-service';
import type LoggerService from './logger-service';
import type MatrixSDKLoader from './matrix-sdk-loader';
import type { ExtendedClient, ExtendedMatrixSDK } from './matrix-sdk-loader';
import type MessageService from './message-service';
import type NetworkService from './network';
import type { SerializedState as OperatorModeSerializedState } from './operator-mode-state-service';
import type RealmService from './realm';
import type RealmServerService from './realm-server';
import type ResetService from './reset';
import type StoreService from './store';
import type ToolService from './tool-service';
import type { RoomResource } from '../resources/room';
import type * as CardAPI from '@cardstack/base/card-api';
import type { BaseDef, CardDef } from '@cardstack/base/card-api';
import type {
  CardForAttachmentCard,
  FileForAttachmentCard,
} from '@cardstack/base/command';
import type { FileDef } from '@cardstack/base/file-api';
import type * as FileAPI from '@cardstack/base/file-api';
import type {
  ActiveLLMEvent,
  BoxelContext,
  BotTriggerContent,
  CardMessageContent,
  MatrixEvent as DiscreteMatrixEvent,
  CodePatchResultContent,
  CodePatchStatus,
  ToolResultWithNoOutputContent,
  ToolResultWithOutputContent,
  RealmEventContent,
  Tool,
  ToolResultStatus,
} from '@cardstack/base/matrix-event';
import type * as SkillModule from '@cardstack/base/skill';
import type { SystemCard } from '@cardstack/base/system-card';
import type { MatrixClient } from 'matrix-js-sdk';
import type {
  LoginResponse,
  MatrixEvent,
  RoomMember,
  EmittedEvents,
} from 'matrix-js-sdk';

import type * as MatrixSDK from 'matrix-js-sdk';

const { matrixURL } = ENV;
const STATE_EVENTS_OF_INTEREST = ['m.room.create', 'm.room.name'];
// Backoff for retrying trusted servers that were unreachable at boot. Bounded
// so a persistently-down server doesn't spin forever.
const UNREACHABLE_RETRY_INTERVAL_MS = 10_000;
const MAX_UNREACHABLE_RETRY_ATTEMPTS = 6;

const realmEventsLogger = logger('realm:events');

export default class MatrixService extends Service {
  @service declare private loaderService: LoaderService;
  @service declare private loggerService: LoggerService;
  @service declare private cardService: CardService;
  @service declare private toolService: ToolService;
  @service declare private realm: RealmService;
  @service declare private matrixSdkLoader: MatrixSDKLoader;
  @service declare private messageService: MessageService;
  @service declare private realmServer: RealmServerService;
  @service declare private router: RouterService;
  @service declare private reset: ResetService;
  @service declare private network: NetworkService;
  @service declare private store: StoreService;
  @service declare private localPersistenceService: LocalPersistenceService;
  @tracked private _client: ExtendedClient | undefined;
  @tracked private _isInitializingNewUser = false;
  @tracked private postLoginCompleted = false;
  // When true, `app.boxel.realm-servers` is the authoritative source of
  // the user's realm list and `app.boxel.realms` events are ignored for
  // `setAvailableRealmIdentifiers`. Set during boot from whether that key
  // has content, and flipped on by the realm-servers listener if the key
  // gains content at runtime. Login-related side effects (`loginToRealms`,
  // `loadMoreAuthRooms`) still run regardless.
  private trustedRealmServersAuthoritative = false;
  // Sticky for the lifetime of this instance once a boot assembles from the
  // legacy `app.boxel.realms` list. Keeps later start() calls on the legacy
  // path even after the lazy migration writes `app.boxel.realm-servers`, so
  // the migration only takes effect on the next fresh session. Reset by
  // resetState() so a logout/login re-evaluates against the persisted key.
  private bootedFromLegacyRealmsList = false;
  @tracked private _currentRoomId: string | undefined;
  @tracked private timelineLoadingState: Map<string, boolean> =
    new TrackedMap();

  @tracked private storage: Storage | undefined;
  @tracked workspaceFavorites: string[] = [];

  profile = getMatrixProfile(this, () => this.userId);

  private roomDataMap: TrackedMap<string, Room> = new TrackedMap();
  private startedAtTs = -1;

  // TODO This seems very bad. we should not be sharing Resources with anyone that
  // wants one--resources are tied to the lifetime of their owner, who knows
  // which owner made these and who is consuming these. we need to refactor this out..
  roomResourcesCache: TrackedMap<string, RoomResource> = new TrackedMap();
  canceledActionMessageIdByRoom: TrackedMap<string, string> = new TrackedMap();
  messagesToSend: TrackedMap<string, string | undefined> = new TrackedMap();
  cardsToSend: TrackedMap<string, string[] | undefined> = new TrackedMap();
  filesToSend: TrackedMap<string, FileDef[] | undefined> = new TrackedMap();
  failedToolState: TrackedMap<string, Error> = new TrackedMap();
  reasoningExpandedState: TrackedMap<string, boolean> = new TrackedMap();
  flushTimeline: Promise<void> | undefined;
  flushMembership: Promise<void> | undefined;
  flushRoomState: Promise<void> | undefined;
  private roomMembershipQueue: { event: MatrixEvent; member: RoomMember }[] =
    [];
  private timelineQueue: { event: MatrixEvent; oldEventId?: string }[] = [];
  private roomStateQueue: MatrixSDK.RoomState[] = [];
  #ready: Promise<void>;
  #clientReadyDeferred = new Deferred<void>();
  #matrixSDK: ExtendedMatrixSDK | undefined;
  #eventBindings: [EmittedEvents, (...arg: any[]) => void][] | undefined;
  currentUserEventReadReceipts: TrackedMap<string, { readAt: Date }> =
    new TrackedMap();

  private slidingSync: SlidingSync | undefined;
  private aiRoomIds: Set<string> = new Set();
  private restoredDraftRooms = new Set<string>();
  private hydratedPendingSendRooms = new Set<string>();
  @tracked private _isLoadingMoreAIRooms = false;
  private initialSyncCompleted = false;
  private initialSyncCompletedDeferred = new Deferred<void>();
  private roomsWaitingForSync: Map<string, Deferred<void>> = new Map();
  @tracked private _systemCard: SystemCard | undefined;
  @tracked private _systemCardLoadFailed = false;
  private _userChoiceId: string | undefined;
  private _systemCardInvalidationUnsub: (() => void) | undefined;
  // Sticky "the active SystemCard was deleted in-session" signal. Bridges the
  // synchronous failure detection in `onSystemCardInvalidated` with the
  // asynchronous re-entry into `setSystemCard(undefined)` from the matrix
  // account-data echo. Cleared whenever `setSystemCard` resolves a card.
  private _systemCardWasLost = false;
  agentId: string | undefined;

  constructor(owner: Owner) {
    super(owner);
    this.reset.register(this);
    this.setLoggerLevelFromEnvironment();
    this.setAgentId();
    this.#ready = this.loadState.perform();
    registerDestructor(this, () => this.teardownClient());
  }

  setMessageToSend(roomId: string, message: string | undefined) {
    this.ensureMessageDraftRestored(roomId);
    if (message === undefined) {
      this.messagesToSend.delete(roomId);
    } else {
      this.messagesToSend.set(roomId, message);
    }
    this.localPersistenceService.setMessageDraft(roomId, message);
  }

  getMessageToSend(roomId: string) {
    this.ensureMessageDraftRestored(roomId);
    return this.messagesToSend.get(roomId);
  }

  setCardsToSend(roomId: string, cardIds: string[] | undefined) {
    this.ensureMessageDraftRestored(roomId);
    let sanitized = cardIds?.filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
    if (sanitized && sanitized.length > 0) {
      this.cardsToSend.set(roomId, [...new Set(sanitized)]);
    } else {
      this.cardsToSend.delete(roomId);
      sanitized = undefined;
    }
    this.localPersistenceService.setAttachedCardIds(roomId, sanitized);
  }

  getCardsToSend(roomId: string) {
    this.ensureMessageDraftRestored(roomId);
    return this.cardsToSend.get(roomId);
  }

  setFilesToSend(roomId: string, files: FileDef[] | undefined) {
    this.ensureMessageDraftRestored(roomId);
    let nextFiles = files && files.length > 0 ? [...files] : undefined;
    if (nextFiles) {
      this.filesToSend.set(roomId, nextFiles);
    } else {
      this.filesToSend.delete(roomId);
    }
    this.localPersistenceService.setAttachedFiles(
      roomId,
      nextFiles?.map((file) => file.serialize()),
    );
  }

  getFilesToSend(roomId: string) {
    this.ensureMessageDraftRestored(roomId);
    return this.filesToSend.get(roomId);
  }

  private setAgentId() {
    this.agentId = this.localPersistenceService.getAgentId();
  }

  private setLoggerLevelFromEnvironment() {
    // This will pick up the level if it's in LOG_LEVELS
    logger('matrix');
  }

  private addEventReadReceipt(eventId: string, receipt: { readAt: Date }) {
    if (isTesting()) {
      console.log(`[read-receipt-trace] arrived event=${eventId}`);
    }
    this.currentUserEventReadReceipts.set(eventId, receipt);
  }

  get currentRoomId(): string | undefined {
    return this._currentRoomId;
  }

  set currentRoomId(value: string | undefined) {
    this._currentRoomId = value;
    if (value) {
      this.loadAllTimelineEvents(value);
    }

    this.localPersistenceService.setCurrentRoomId(value);
  }

  get ready() {
    return this.#ready;
  }

  private cardAPIModule = importResource(
    this,
    () => 'https://cardstack.com/base/card-api',
  );

  private fileAPIModule = importResource(
    this,
    () => 'https://cardstack.com/base/file-api',
  );

  private loadState = task(async () => {
    if (isTesting())
      console.warn('[start-phase] loadState:requestStorageAccess');
    await this.requestStorageAccess();
    if (isTesting()) console.warn('[start-phase] loadState:loadSDK');
    await this.loadSDK();
    if (isTesting()) console.warn('[start-phase] loadState:done');
  });

  private get inIframe() {
    return !isTesting() && window.top !== window.self;
  }

  async requestStorageAccess() {
    if (this.inIframe) {
      this.storage = await getStorage();
    } else {
      this.storage = window.localStorage;
    }

    return this.storage;
  }

  private saveAuth(auth: LoginResponse) {
    this.storage?.setItem('auth', JSON.stringify(auth));
  }

  private getAuth(): LoginResponse | undefined {
    let auth = this.storage?.getItem('auth');
    if (!auth) {
      return;
    }
    return JSON.parse(auth) as LoginResponse;
  }

  private async loadSDK() {
    await this.cardAPIModule.loaded;
    await this.fileAPIModule.loaded;
    // The matrix SDK is VERY big so we only load it when we need it
    this.#matrixSDK = await this.matrixSdkLoader.load();
    this._client = this.matrixSDK.createClient({
      baseUrl: matrixURL,
    });
    this.#clientReadyDeferred.fulfill();

    // building the event bindings like this so that we can consistently bind
    // and unbind these events programmatically--this way if we add a new event
    // we won't forget to unbind it.

    this.#eventBindings = [
      [this.matrixSDK.RoomMemberEvent.Membership, this.onMembership],
      [this.matrixSDK.RoomEvent.Timeline, this.onTimeline],
      [this.matrixSDK.RoomEvent.LocalEchoUpdated, this.onUpdateEventStatus],
      [this.matrixSDK.RoomEvent.Receipt, this.onReceipt],
      [this.matrixSDK.RoomStateEvent.Update, this.onRoomStateUpdate],
      [
        this.matrixSDK.ClientEvent.AccountData,
        async (e) => {
          switch (e.event.type) {
            case APP_BOXEL_REALMS_EVENT_TYPE: {
              let legacyRealms = e.event.content.realms as string[];
              // When `app.boxel.realm-servers` is the source of truth,
              // ignore the realm-list payload here — otherwise the
              // initial-sync re-emission of this event would overwrite the
              // trusted-servers boot result. Side effects below still run
              // so post-login realm authentication isn't dropped.
              if (!this.trustedRealmServersAuthoritative) {
                await this.realmServer.setAvailableRealmIdentifiers(
                  legacyRealms.map(ri),
                );
              }
              // Only do this after we've completed our overall login
              if (this.postLoginCompleted) {
                await this.loginToRealms();
                await this.loadMoreAuthRooms(legacyRealms);
              }
              break;
            }
            case APP_BOXEL_REALM_SERVERS_EVENT_TYPE: {
              // A session that booted from the legacy `app.boxel.realms` list
              // stays on the legacy path for the lifetime of this instance
              // (see `bootedFromLegacyRealmsList` in start()). The boot-time
              // lazy migration writes `app.boxel.realm-servers`, and that write
              // echoes back here — both synchronously and again when
              // startClient()'s initial sync re-emits account data. Ignoring
              // these keeps the migrated key from re-running trusted-servers
              // assembly mid-boot and overwriting the legacy-assembled realm
              // list; the new key only takes effect on the next fresh session.
              if (this.bootedFromLegacyRealmsList) {
                break;
              }
              let realmServers = e.event.content.realmServers as string[];
              this.trustedRealmServersAuthoritative = realmServers.length > 0;
              if (this.trustedRealmServersAuthoritative) {
                // A server-pushed account-data event must not crash the app:
                // assembly can reject (e.g. fetchUserRealmsFromTrustedServers
                // refuses a list that isn't this user's own realm server) and
                // an async event handler that throws surfaces as an unhandled
                // rejection. The authoritative, fail-loud assembly runs at
                // start(); here we log and leave the available-realms list as
                // it was.
                try {
                  await this.applyTrustedRealmServersAccountData(realmServers);
                } catch (err) {
                  console.error(
                    'Failed to assemble realms from trusted servers in app.boxel.realm-servers account data',
                    err,
                  );
                }
              }
              break;
            }
            case APP_BOXEL_SYSTEM_CARD_EVENT_TYPE:
              await this.setSystemCard(e.event.content.id);
              break;
          }
        },
      ],
    ];
  }

  get isLoggedIn() {
    return this._client?.isLoggedIn() === true && this.postLoginCompleted;
  }

  // Test-only diagnostic for the intermittent "operator-mode renders the login
  // form" flake: names which precondition of `isLoggedIn` is unmet when a route
  // decides to render <Auth/>. No production caller.
  get loginReadinessDebug() {
    return {
      authPresent: Boolean(this.getAuth()),
      clientExists: Boolean(this._client),
      clientLoggedIn: this._client?.isLoggedIn() === true,
      postLoginCompleted: this.postLoginCompleted,
    };
  }

  // Test-only diagnostic exposing which boot path the current session is on.
  // A legacy-booted session must stay non-authoritative even after the lazy
  // migration writes `app.boxel.realm-servers` and that write echoes back
  // through the AccountData listener. No production caller.
  get bootAssemblyDebug() {
    return {
      trustedRealmServersAuthoritative: this.trustedRealmServersAuthoritative,
      bootedFromLegacyRealmsList: this.bootedFromLegacyRealmsList,
    };
  }

  private get client() {
    if (!this._client) {
      throw new Error(`cannot use matrix client before matrix SDK has loaded`);
    }
    return this._client;
  }

  get userId() {
    return this.client.getUserId();
  }

  get aiBotUserId() {
    let server = this.userId!.split(':')[1];
    return `@${aiBotUsername}:${server}`;
  }

  get submissionBotUserId() {
    let server = this.userId!.split(':')[1];
    return `@${submissionBotUsername}:${server}`;
  }

  getFullUserId(username: string) {
    if (username.includes(':')) {
      return username;
    }
    let server = this.userId?.split(':')[1];
    if (!server) {
      throw new Error('Matrix server is unavailable for user id');
    }
    let localpart = username.startsWith('@') ? username.slice(1) : username;
    return `@${localpart}:${server}`;
  }

  async isUserInRoom(roomId: string, userId: string) {
    try {
      let state = await this.getStateEvent(roomId, 'm.room.member', userId);
      return state?.membership === 'invite' || state?.membership === 'join';
    } catch (_error) {
      return false;
    }
  }

  get userName() {
    return this.userId ? getMatrixUsername(this.userId) : null;
  }

  get cardAPI() {
    if (this.cardAPIModule.error) {
      throw new Error(
        `Error loading Card API: ${JSON.stringify(this.cardAPIModule.error)}`,
      );
    }
    if (!this.cardAPIModule.module) {
      throw new Error(
        `bug: Card API has not loaded yet--make sure to await this.loaded before using the api`,
      );
    }
    return this.cardAPIModule.module as typeof CardAPI;
  }

  get fileAPI() {
    if (this.fileAPIModule.error) {
      throw new Error(
        `Error loading File API: ${JSON.stringify(this.fileAPIModule.error)}`,
      );
    }
    if (!this.fileAPIModule.module) {
      throw new Error(
        `bug: File API has not loaded yet--make sure to await this.loaded before using the api`,
      );
    }
    return this.fileAPIModule.module as typeof FileAPI;
  }

  private get matrixSDK() {
    if (!this.#matrixSDK) {
      throw new Error(`cannot use matrix SDK before it has loaded`);
    }
    return this.#matrixSDK;
  }

  get privateChatPreset() {
    return this.matrixSDK.Preset.PrivateChat;
  }

  get aiBotPowerLevel() {
    return 50; // this is required to set the room name
  }

  async waitForInitialSync() {
    await this.initialSyncCompletedDeferred.promise;
  }

  get flushAll() {
    return Promise.all([
      this.flushMembership ?? Promise.resolve(),
      this.flushTimeline ?? Promise.resolve(),
      this.flushRoomState ?? Promise.resolve(),
    ]);
  }

  async logout() {
    let client = this._client;
    try {
      // Logout should synchronously move the app into a logged-out state.
      // Waiting on background Matrix flush promises first can leave the
      // authenticated shell visible for an arbitrarily long time.
      this.clearAuth();
      if (isTesting() && this.postLoginCompleted) {
        console.warn(
          '[login-diag] postLoginCompleted reset to false via logout()\n' +
            new Error().stack,
        );
      }
      this.postLoginCompleted = false;
      // Logout is the explicit boundary where we forget persisted workspace UI
      // state for the signed-in user. Generic reset paths must stay in-memory
      // only so tests and app reloads do not accidentally wipe durable state.
      clearLocalStorage(window.localStorage);
      this.reset.resetAll();
      this.loaderService.resetSessionBoundary('logout');
      this.unbindEventListeners();
      await client?.logout(true);
      // when user logs out we transition them back to an empty stack with the
      // workspace chooser open. this way we don't inadvertently leak private
      // card id's in the URL
      this.router.transitionTo('index-root', {
        queryParams: {
          operatorModeState: stringify({
            stacks: [],
            submode: Submodes.Interact,
            workspaceChooserOpened: true,
          } as OperatorModeSerializedState),
          sid: null,
          clientSecret: null,
        },
      });
    } catch (e) {
      console.log('Error logging out of Matrix', e);
    } finally {
      this.resetState();
    }
  }

  get isInitializingNewUser() {
    return this._isInitializingNewUser;
  }

  async initializeNewUser(
    auth: LoginResponse,
    displayName: string,
    registrationToken?: string,
  ) {
    await this.ready;

    displayName = displayName.trim();
    this._isInitializingNewUser = true;

    this.configureClientWithAuth(auth);

    let userId = auth.user_id;

    if (!userId) {
      throw new Error(
        `bug: there is no userId associated with the matrix client`,
      );
    }

    await this.start({ auth, registrationToken });
    this.setDisplayName(displayName);

    await this.realmServer.authenticateToAllAccessibleRealms();

    await Promise.all([
      this.createPersonalRealmForUser({
        endpoint: 'personal',
        name: `${displayName}'s Workspace`,
        iconURL: iconURLFor(displayName),
        backgroundURL: getRandomBackgroundURL(),
      }),
      this.realmServer.fetchCatalogRealms(),
    ]);

    this.router.refresh();
    this._isInitializingNewUser = false;
  }

  private configureClientWithAuth(auth: LoginResponse) {
    let {
      access_token: accessToken,
      user_id: userId,
      device_id: deviceId,
    } = auth;

    if (!accessToken) {
      throw new Error(
        `Cannot create matrix client from auth that has no access token: ${JSON.stringify(
          auth,
          null,
          2,
        )}`,
      );
    }
    if (!userId) {
      throw new Error(
        `Cannot create matrix client from auth that has no user id: ${JSON.stringify(
          auth,
          null,
          2,
        )}`,
      );
    }
    if (!deviceId) {
      throw new Error(
        `Cannot create matrix client from auth that has no device id: ${JSON.stringify(
          auth,
          null,
          2,
        )}`,
      );
    }

    this._client = this.matrixSDK.createClient({
      baseUrl: matrixURL,
      accessToken,
      userId,
      deviceId,
    });

    this.realmServer.setClient(this.client);
    this.saveAuth(auth);
  }

  public async createPersonalRealmForUser({
    endpoint,
    name,
    iconURL,
    backgroundURL,
  }: {
    endpoint: string;
    name: string;
    iconURL?: string;
    backgroundURL?: string;
  }) {
    let personalRealmURL = await this.realmServer.createRealm({
      endpoint,
      name,
      iconURL,
      backgroundURL,
    });

    await this.appendRealmToAccountData(personalRealmURL.href);
  }

  public async appendRealmToAccountData(realmURLString: string) {
    let { realms = [] } =
      ((await this.client.getAccountDataFromServer(
        APP_BOXEL_REALMS_EVENT_TYPE,
      )) as { realms: string[] }) ?? {};

    // Clone the account data instead of using it directly,
    // since mutating the original object would modify the Matrix client’s store
    // and prevent updates from being sent back to the server.
    let newRealms = [...realms, realmURLString];
    await this.client.setAccountData(APP_BOXEL_REALMS_EVENT_TYPE, {
      realms: newRealms,
    });
    // The legacy `app.boxel.realms` write above is persistence only. On a
    // trusted-realm-servers session the in-memory list also holds realms
    // granted via `_realm-auth` that the legacy list never contained, so
    // replacing the list with `newRealms` would drop those realms until the
    // next reload. Merge into the current list instead — prepending, since
    // the list is newest-created-first.
    await this.realmServer.setAvailableRealmIdentifiers([
      ...new Set([
        ri(realmURLString),
        ...this.realmServer.userRealmIdentifiers,
      ]),
    ]);
  }

  public async removeRealmFromAccountData(realmURLString: string) {
    let { realms = [] } =
      ((await this.client.getAccountDataFromServer(
        APP_BOXEL_REALMS_EVENT_TYPE,
      )) as { realms: string[] }) ?? {};

    let newRealms = realms.filter((realmURL) => realmURL !== realmURLString);
    await this.client.setAccountData(APP_BOXEL_REALMS_EVENT_TYPE, {
      realms: newRealms,
    });
    // Drop only the removed realm from the current in-memory list; see
    // appendRealmToAccountData for why the legacy list can't be used here.
    await this.realmServer.setAvailableRealmIdentifiers(
      this.realmServer.userRealmIdentifiers.filter(
        (realmIdentifier) => realmIdentifier !== ri(realmURLString),
      ),
    );
  }

  public async getRealmServersFromAccountData(): Promise<string[]> {
    let { realmServers = [] } =
      ((await this.client.getAccountDataFromServer(
        APP_BOXEL_REALM_SERVERS_EVENT_TYPE,
      )) as { realmServers: string[] }) ?? {};
    return realmServers;
  }

  public async setRealmServersInAccountData(
    realmServers: string[],
  ): Promise<void> {
    await this.client.setAccountData(APP_BOXEL_REALM_SERVERS_EVENT_TYPE, {
      realmServers,
    });
  }

  public async appendRealmServerToAccountData(
    realmServerURLString: string,
  ): Promise<void> {
    let realmServers = await this.getRealmServersFromAccountData();
    if (realmServers.includes(realmServerURLString)) {
      return;
    }
    await this.setRealmServersInAccountData([
      ...realmServers,
      realmServerURLString,
    ]);
  }

  public async removeRealmServerFromAccountData(
    realmServerURLString: string,
  ): Promise<void> {
    let realmServers = await this.getRealmServersFromAccountData();
    await this.setRealmServersInAccountData(
      realmServers.filter((s) => s !== realmServerURLString),
    );
  }

  public async getWorkspaceFavorites(): Promise<string[]> {
    let { favorites = [] } =
      ((await this.client.getAccountDataFromServer(
        APP_BOXEL_WORKSPACE_FAVORITES_EVENT_TYPE,
      )) as { favorites: string[] }) ?? {};
    return favorites;
  }

  public async addWorkspaceFavorite(realmURL: string): Promise<void> {
    let { favorites = [] } =
      ((await this.client.getAccountDataFromServer(
        APP_BOXEL_WORKSPACE_FAVORITES_EVENT_TYPE,
      )) as { favorites: string[] }) ?? {};

    if (!favorites.includes(realmURL)) {
      let newFavorites = [...favorites, realmURL];
      await this.client.setAccountData(
        APP_BOXEL_WORKSPACE_FAVORITES_EVENT_TYPE,
        { favorites: newFavorites },
      );
      this.workspaceFavorites = newFavorites;
    }
  }

  public async removeWorkspaceFavorite(realmURL: string): Promise<void> {
    let { favorites = [] } =
      ((await this.client.getAccountDataFromServer(
        APP_BOXEL_WORKSPACE_FAVORITES_EVENT_TYPE,
      )) as { favorites: string[] }) ?? {};

    let newFavorites = favorites.filter((url) => url !== realmURL);
    await this.client.setAccountData(APP_BOXEL_WORKSPACE_FAVORITES_EVENT_TYPE, {
      favorites: newFavorites,
    });
    this.workspaceFavorites = newFavorites;
  }

  async setDisplayName(displayName: string) {
    await this.client.setDisplayName(displayName);
  }

  async reloadProfile() {
    await this.profile.load.perform();
  }

  async start(
    opts: {
      auth?: MatrixSDK.LoginResponse;
      refreshRoutes?: true;
      registrationToken?: string;
    } = {},
  ) {
    await this.ready;

    let { auth, refreshRoutes, registrationToken } = opts;
    if (!auth) {
      auth = this.getAuth();
      if (!auth) {
        if (isTesting()) {
          console.warn('[login-diag] start() aborted: no auth present');
        }
        return;
      }
    }

    this.configureClientWithAuth(auth);

    if (this.client.isLoggedIn()) {
      this.realmServer.setClient(this.client);
      if (isTesting()) console.warn('[start-phase] realmServer.login');
      await this.realmServer.login(registrationToken);
      this.saveAuth(auth);
      this.bindEventListeners();

      try {
        let deviceId = this.client.getDeviceId();
        if (deviceId) {
          let { last_seen_ts } = await this.client.getDevice(deviceId);
          if (last_seen_ts) {
            this.startedAtTs = last_seen_ts;
          }
        }
        if (this.startedAtTs === -1) {
          this.startedAtTs = 0;
        }
        if (isTesting())
          console.warn('[start-phase] getAccountData(realm-servers,favorites)');
        let [realmServersData, favoritesData] = await Promise.all([
          this.client.getAccountDataFromServer(
            APP_BOXEL_REALM_SERVERS_EVENT_TYPE,
          ) as Promise<{ realmServers: string[] } | null>,
          this.client.getAccountDataFromServer(
            APP_BOXEL_WORKSPACE_FAVORITES_EVENT_TYPE,
          ) as Promise<{ favorites: string[] } | null>,
        ]);
        this.workspaceFavorites = favoritesData?.favorites ?? [];

        // Boot assembles the realm list from trusted servers via
        // `_realm-auth`. The transition fallback below reads the legacy
        // `app.boxel.realms` key when `app.boxel.realm-servers` is absent
        // or empty, so users whose accounts haven't yet been migrated to
        // `app.boxel.realm-servers` still boot. Remove the fallback once
        // the lazy migration that populates `app.boxel.realm-servers` has
        // run on all active accounts.
        let trustedServers = realmServersData?.realmServers ?? [];
        // A session that first assembled from the legacy `app.boxel.realms`
        // list stays on the legacy path for the lifetime of this
        // MatrixService instance. The lazy migration below persists
        // `app.boxel.realm-servers` for the next fresh session; switching
        // this same instance to the trusted path on a later start() (e.g. a
        // test that re-boots to pick up a newly-added realm) would re-derive
        // the realm list from `_realm-auth` for no benefit and drop realms
        // that the trusted servers don't advertise.
        let useTrustedServers =
          trustedServers.length > 0 && !this.bootedFromLegacyRealmsList;
        // The legacy `app.boxel.realms` AccountData event is re-emitted by
        // the matrix sync that runs inside `startClient()` below. Setting
        // this flag here makes that re-emission a no-op for the available-
        // realms list — the realm-servers path is the authoritative source.
        this.trustedRealmServersAuthoritative = useTrustedServers;
        let userRealmURLs: string[];
        if (useTrustedServers) {
          if (isTesting())
            console.warn('[start-phase] fetchUserRealmsFromTrustedServers');
          userRealmURLs =
            await this.realmServer.fetchUserRealmsFromTrustedServers(
              trustedServers,
            );
        } else {
          this.bootedFromLegacyRealmsList = true;
          if (isTesting())
            console.warn('[start-phase] getAccountData(realms-legacy)');
          let legacyRealmsData = (await this.client.getAccountDataFromServer(
            APP_BOXEL_REALMS_EVENT_TYPE,
          )) as { realms: string[] } | null;
          userRealmURLs = legacyRealmsData?.realms ?? [];

          // Lazy migration: this account has no `app.boxel.realm-servers`
          // entry (the key was absent or empty, so boot fell back to the
          // legacy realm list above). Seed the new key with the realm-server
          // backing the user's existing realms so subsequent boots take the
          // authoritative trusted-servers assembly path. We use
          // `getRealmServersForRealms`, which derives the server from each
          // realm's JWT `realmServerURL` claim and falls back to this host's
          // own realm server — never the bare realm-URL origin. That matters
          // because a realm URL's origin can differ from its realm server
          // (e.g. the shared base realm at cardstack.com); persisting such a
          // foreign origin would make the next boot's `assertOwnRealmServer`
          // reject the list and log the user out. The legacy
          // `app.boxel.realms` key is intentionally retained for rollback
          // safety. Gated on `trustedServers` being genuinely empty so a
          // re-boot of this same legacy session (where the key we just wrote
          // is now present) doesn't re-write it. A no-op for an account with
          // no realms. Best-effort: a failure must not break boot.
          if (trustedServers.length === 0 && userRealmURLs.length > 0) {
            try {
              let derivedRealmServers =
                this.realmServer.getRealmServersForRealms(userRealmURLs);
              if (derivedRealmServers.length > 0) {
                if (isTesting())
                  console.warn('[start-phase] migrateRealmServersAccountData');
                // `bootedFromLegacyRealmsList` is already set above, so the
                // AccountData listener ignores both this self-write and the
                // echo from startClient()'s initial sync — no extra guard
                // needed. This session is already assembled from the legacy
                // list; the new key takes effect on the next boot.
                await this.setRealmServersInAccountData(derivedRealmServers);
              }
            } catch (err) {
              console.error(
                'Failed to migrate legacy realms to app.boxel.realm-servers account data',
                err,
              );
            }
          }
        }

        let noRealmsLoggedIn = Array.from(this.realm.realms.entries()).every(
          ([_url, realmResource]) => !realmResource.isLoggedIn,
        );

        if (isTesting())
          console.warn(
            '[start-phase] fetchCatalogRealms+setAvailableRealmIdentifiers',
          );
        await Promise.all([
          this.realmServer.fetchCatalogRealms(),
          this.realmServer.setAvailableRealmIdentifiers(userRealmURLs.map(ri)),
        ]);

        if (isTesting()) console.warn('[start-phase] prefetchRealmInfos');
        await this.realm.prefetchRealmInfos(
          this.realmServer.availableRealmIdentifiers,
        );

        if (isTesting()) console.warn('[start-phase] initSlidingSync');
        await this.initSlidingSync({ realms: userRealmURLs });
        if (isTesting()) console.warn('[start-phase] startClient');
        await this.client.startClient({ slidingSync: this.slidingSync });
        if (isTesting())
          console.warn('[start-phase] getAccountData(systemCard)');
        let systemCardAccountData = (await this.client.getAccountDataFromServer(
          APP_BOXEL_SYSTEM_CARD_EVENT_TYPE,
        )) as { id?: string } | null;
        if (isTesting()) console.warn('[start-phase] setSystemCard');
        await this.setSystemCard(systemCardAccountData?.id);
        if (noRealmsLoggedIn) {
          // In this case we want to authenticate to all accessible realms in a single request,
          // for performance reasons (otherwise we would make 2 auth requests for
          // each realm, which could be a lot of requests).

          if (isTesting())
            console.warn('[start-phase] authenticateToAllAccessibleRealms');
          try {
            await this.realmServer.authenticateToAllAccessibleRealms();
          } catch (e) {
            // A trusted server being unreachable must not fail boot: assembly
            // recorded it in `unreachableRealmServers`, a retry is scheduled
            // below, and realms from reachable servers still authenticate
            // individually via `loginToRealms`. But only swallow when there's
            // actually an unreachable server to blame — otherwise this is an
            // unrelated auth failure and boot must fail loudly (logout) rather
            // than proceed to `postLoginCompleted` while unauthenticated.
            if (this.realmServer.unreachableRealmServers.length === 0) {
              throw e;
            }
            console.error(
              'Failed to authenticate to all accessible realms because a trusted server is unreachable',
              e,
            );
          }
        }
        // Login here triggers other setup code that needs to happen after
        // otherwise we don't have the realm info.
        // This should be cleaned up as we move to single logins
        if (isTesting()) console.warn('[start-phase] loginToRealms');
        await this.loginToRealms();

        this.postLoginCompleted = true;
        if (isTesting()) console.warn('[start-phase] postLoginCompleted=true');

        // If any trusted server was unreachable during boot assembly, keep
        // the reachable realms and retry the unreachable ones in the
        // background so they load (and the notice clears) once they recover.
        this.scheduleUnreachableRealmServerRetry();
      } catch (e) {
        console.log('Error starting Matrix client', e);
        await this.logout();
      }

      let indexController = getOwner(this)!.lookup(
        'controller:index',
      ) as IndexController;

      if (indexController.authRedirect) {
        console.log(
          'authRedirect exists, redirecting to ' + indexController.authRedirect,
        );
        window.location.href = indexController.authRedirect;
      } else if (refreshRoutes) {
        await this.router.refresh();
      }
    } else if (isTesting()) {
      // start() did nothing because the client wasn't logged in at this point,
      // so postLoginCompleted is left untouched. The index route's start() is a
      // one-shot, so a no-op here strands it on the login form. Name the unmet
      // precondition so a cold-boot timeout points at the gap.
      console.warn(
        '[login-diag] start() no-op: client not logged in ' +
          JSON.stringify(this.loginReadinessDebug),
      );
    }
  }

  private aiRoomListConfig(timelineLimit: number): MSC3575List {
    return {
      ranges: [[0, SLIDING_SYNC_LIST_RANGE_END]],
      filters: {
        is_dm: false,
      },
      timeline_limit: timelineLimit,
      required_state: [['*', '*']],
    };
  }

  private async initSlidingSync(accountData?: { realms: string[] } | null) {
    let lists: Map<string, MSC3575List> = new Map();
    lists.set(
      SLIDING_SYNC_AI_ROOM_LIST_NAME,
      this.aiRoomListConfig(INITIAL_SLIDING_SYNC_LIST_TIMELINE_LIMIT),
    );
    lists.set(SLIDING_SYNC_AUTH_ROOM_LIST_NAME, {
      ranges: [[0, accountData?.realms.length ?? SLIDING_SYNC_LIST_RANGE_END]],
      filters: {
        is_dm: true,
      },
      timeline_limit: SLIDING_SYNC_AUTH_ROOM_TIMELINE_LIMIT,
      required_state: [['*', '*']],
    });
    this.slidingSync = new this.matrixSdkLoader.SlidingSync(
      this.client.baseUrl,
      lists,
      {
        timeline_limit: INITIAL_SLIDING_SYNC_LIST_TIMELINE_LIMIT,
      },
      this.client as any,
      SLIDING_SYNC_TIMEOUT,
    );

    this.slidingSync.on(
      SlidingSyncEvent.Lifecycle,
      this.onSlidingSyncLifecycle,
    );

    return this.slidingSync;
  }

  onSlidingSyncLifecycle = (
    state: SlidingSyncState,
    resp: MSC3575SlidingSyncResponse | null,
  ) => {
    let list = resp?.lists[SLIDING_SYNC_AI_ROOM_LIST_NAME] as
      | { ops: { room_ids: string[] }[] }
      | undefined;
    let roomIds: string[] = list?.ops?.[0]?.room_ids ?? [];
    switch (state) {
      case SlidingSyncState.Complete:
        if (!this.initialSyncCompleted) {
          Promise.allSettled([
            this.drainRoomState(),
            this.drainMembership(),
            this.drainTimeline(),
          ]).then(() => {
            this.initialSyncCompleted = true;
            this.initialSyncCompletedDeferred.fulfill();
            this.slidingSync?.setList(
              SLIDING_SYNC_AI_ROOM_LIST_NAME,
              this.aiRoomListConfig(SLIDING_SYNC_AI_ROOM_TIMELINE_LIMIT),
            );
          });
        }
        roomIds.forEach((id) => this.roomsWaitingForSync.get(id)?.fulfill());
        break;
      case SlidingSyncState.RequestFinished:
        roomIds.forEach((id) => this.aiRoomIds.add(id));
        break;
    }
  };

  async loginToRealms() {
    // This is where we would actually load user-specific choices out of the
    // user's profile based on this.client.getUserId();
    let activeRealms = this.realmServer.availableRealmIdentifiers;

    await Promise.all(
      activeRealms.map(async (realmURL: string) => {
        try {
          // Our authorization-middleware can login automatically after seeing a
          // 401, but this preemptive login makes it possible to see
          // canWrite===true on realms that are publicly readable.
          await this.realm.login(realmURL);
        } catch (err) {
          console.warn(
            `Unable to establish session with realm ${realmURL}`,
            err,
          );
        }
      }),
    );
  }

  // Re-assemble the available-realms list from a runtime
  // `app.boxel.realm-servers` account-data event. Unlike the fail-loud boot
  // assembly, an event-time refresh must be conservative: because
  // `fetchUserRealmsFromTrustedServers` now returns a partial list when a
  // trusted server is unreachable (rather than throwing), replacing the list
  // with that partial result would erase the realms served by a server that's
  // only transiently down. So when any server was unreachable this round we
  // merge (add newly-discovered realms, never remove) and let the retry
  // reconcile; only a fully reachable assembly is authoritative enough to
  // remove realms. Called by the AccountData listener and directly by tests.
  async applyTrustedRealmServersAccountData(realmServers: string[]) {
    let realmURLs =
      await this.realmServer.fetchUserRealmsFromTrustedServers(realmServers);
    if (this.realmServer.unreachableRealmServers.length > 0) {
      await this.realmServer.setAvailableRealmIdentifiers([
        ...new Set([
          ...this.realmServer.userRealmIdentifiers,
          ...realmURLs.map(ri),
        ]),
      ]);
    } else {
      await this.realmServer.setAvailableRealmIdentifiers(realmURLs.map(ri));
    }
    if (this.postLoginCompleted) {
      await this.loginToRealms();
      await this.loadMoreAuthRooms(realmURLs);
    }
    this.scheduleUnreachableRealmServerRetry();
  }

  // Re-attempt the trusted servers that were unreachable during boot
  // assembly. On success their realms are merged into the available list and
  // authenticated so they appear without a reload; the "couldn't reach
  // <server>" notice clears as `unreachableRealmServers` empties. Returns true
  // once every previously-unreachable server has recovered. Public so tests
  // can drive recovery deterministically rather than waiting on the background
  // timer.
  async retryUnreachableRealmServers(): Promise<boolean> {
    let toRetry = [...this.realmServer.unreachableRealmServers];
    if (toRetry.length === 0) {
      return true;
    }
    let recovered =
      await this.realmServer.fetchUserRealmsFromTrustedServers(toRetry);
    if (recovered.length > 0) {
      let merged = [
        ...new Set([
          ...this.realmServer.userRealmIdentifiers,
          ...recovered.map(ri),
        ]),
      ];
      await this.realmServer.setAvailableRealmIdentifiers(merged);
      await this.loginToRealms();
      await this.loadMoreAuthRooms(recovered);
    }
    return this.realmServer.unreachableRealmServers.length === 0;
  }

  private scheduleUnreachableRealmServerRetry() {
    if (isTesting()) {
      // Tests drive recovery via `retryUnreachableRealmServers()` directly so
      // the assertions are deterministic; skip the background timer loop, which
      // would otherwise keep firing while a stubbed server stays down.
      return;
    }
    if (this.realmServer.unreachableRealmServers.length === 0) {
      return;
    }
    this.retryUnreachableRealmServersTask.perform();
  }

  private retryUnreachableRealmServersTask = restartableTask(async () => {
    for (
      let attempt = 0;
      attempt < MAX_UNREACHABLE_RETRY_ATTEMPTS &&
      this.realmServer.unreachableRealmServers.length > 0;
      attempt++
    ) {
      await rawTimeout(UNREACHABLE_RETRY_INTERVAL_MS);
      if (this.isDestroying || this.isDestroyed) {
        return;
      }
      try {
        await this.retryUnreachableRealmServers();
      } catch (err) {
        console.error('Failed to retry unreachable realm servers', err);
      }
    }
  });

  async createRealmSession(realmURL: URL) {
    await this.#clientReadyDeferred.promise;
    return this.client.createRealmSession(realmURL);
  }

  async sendEvent(
    roomId: string,
    eventType: string,
    content:
      | BotTriggerContent
      | CardMessageContent
      | CodePatchResultContent
      | ToolResultWithNoOutputContent
      | ToolResultWithOutputContent,
  ) {
    let roomData = this.ensureRoomData(roomId);
    return roomData.mutex.dispatch(async () => {
      if ('data' in content) {
        const encodedContent = {
          ...content,
          data: JSON.stringify(content.data),
        };
        return await this.client.sendEvent(roomId, eventType, encodedContent);
      } else {
        return await this.client.sendEvent(roomId, eventType, content);
      }
    });
  }

  async downloadCardFileDef(cardFileDef: FileAPI.SerializedFile) {
    return await this.client.downloadCardFileDef(cardFileDef);
  }

  // Re-upload skills and commands. FileDefManager's cache will ensure we don't re-upload the same content.
  // If there are new urls and content hashes for skills or commands, The room state will be updated.
  async updateSkillsAndToolsIfNeeded(roomId: string) {
    await this.updateStateEvent(
      roomId,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
      '',
      async (currentSkillsConfig) => {
        let enabledSkillCardFileDefs =
          (currentSkillsConfig?.enabledSkillCards ??
            []) as FileAPI.SerializedFile[];
        let enabledCommandDefinitions: SkillModule.ToolField[] = [];
        // Skill cards re-upload their serialized card content; skill markdown
        // files re-upload their file content. Both contribute commands.
        let skillCardsToReupload: SkillModule.Skill[] = [];
        let markdownSkillFileDefs: FileDef[] = [];
        await Promise.all(
          enabledSkillCardFileDefs.map(async (fileDef) => {
            let source = await loadSkillSource(this.store, fileDef.sourceUrl);
            if (!source) {
              return;
            }
            enabledCommandDefinitions = enabledCommandDefinitions.concat(
              getSkillSourceTools(source),
            );
            if (isSkillCard in source) {
              skillCardsToReupload.push(source as SkillModule.Skill);
            } else {
              markdownSkillFileDefs.push(this.fileAPI.createFileDef(fileDef));
            }
          }),
        );
        let enabledSkillFileDefs = await this.uploadCards(
          skillCardsToReupload as CardDef[],
        );
        let enabledMarkdownSkillFileDefs = markdownSkillFileDefs.length
          ? await this.uploadFiles(markdownSkillFileDefs)
          : [];
        // get the unique subset of enabledCommandDefinitions by functionName
        enabledCommandDefinitions = this.getUniqueToolDefinitions(
          enabledCommandDefinitions,
        );
        let enabledCommandDefFileDefs = await this.uploadToolDefinitions(
          enabledCommandDefinitions,
        );
        return {
          enabledSkillCards: [
            ...enabledSkillFileDefs,
            ...enabledMarkdownSkillFileDefs,
          ].map((fileDef) => fileDef.serialize()),
          disabledSkillCards: currentSkillsConfig?.disabledSkillCards ?? [],
          toolDefinitions: enabledCommandDefFileDefs.map((fileDef) =>
            fileDef.serialize(),
          ),
        };
      },
    );
  }

  async downloadAsFileInBrowser(serializedFile: FileAPI.SerializedFile) {
    return await this.client.downloadAsFileInBrowser(serializedFile);
  }

  public getUniqueToolDefinitions(
    toolDefinitionFileDefs: SkillModule.ToolField[],
  ): SkillModule.ToolField[] {
    return getUniqueValidToolDefinitions(toolDefinitionFileDefs);
  }

  async uploadCards(cards: CardDef[]) {
    let cardFileDefs = await this.client.uploadCards(cards);
    return cardFileDefs;
  }

  async uploadToolDefinitions(toolDefinitionFileDefs: SkillModule.ToolField[]) {
    let validCommandDefinitions = getUniqueValidToolDefinitions(
      toolDefinitionFileDefs,
    );
    if (validCommandDefinitions.length === 0) {
      return [];
    }
    let commandFileDefs = await this.client.uploadToolDefinitions(
      validCommandDefinitions,
    );
    return commandFileDefs;
  }

  async cacheContentHashIfNeeded(event: DiscreteMatrixEvent) {
    await this.client.cacheContentHashIfNeeded(event);
  }

  async sendStopGeneratingEvent(roomId: string) {
    return await this.client.sendEvent(
      roomId,
      APP_BOXEL_STOP_GENERATING_EVENT_TYPE,
      {},
    );
  }

  async sendToolResultEvent(params: {
    roomId: string;
    invokedToolFromEventId: string;
    toolCallId: string;
    status: ToolResultStatus;
    resultCard?: CardDef;
    failureReason?: string;
    attachedCards?: CardDef[];
    attachedFiles?: FileDef[];
    context?: BoxelContext;
  }) {
    let resultCardFileDef: FileDef | undefined;
    if (params.resultCard) {
      [resultCardFileDef] = await this.client.uploadCards([params.resultCard]);
    }
    let contentData = await this.withContextAndAttachments(
      params.context,
      params.attachedCards || [],
      params.attachedFiles || [],
    );
    if ((params.resultCard as FileForAttachmentCard)?.fileForAttachment) {
      contentData.attachedFiles.push(
        (
          (params.resultCard as FileForAttachmentCard)!
            .fileForAttachment as unknown as FileDef
        ).serialize(),
      );
      resultCardFileDef = undefined; // don't send the card as a result if the file is attached
    }
    if ((params.resultCard as CardForAttachmentCard)?.cardForAttachment) {
      contentData.attachedCards.push(
        (
          (params.resultCard as CardForAttachmentCard)!
            .cardForAttachment as unknown as FileDef
        ).serialize(),
      );
      resultCardFileDef = undefined; // don't send the card as a result if the card is attached
    }
    let content: ToolResultWithNoOutputContent | ToolResultWithOutputContent;
    if (resultCardFileDef === undefined) {
      content = {
        msgtype: APP_BOXEL_TOOL_RESULT_WITH_NO_OUTPUT_MSGTYPE,
        commandRequestId: params.toolCallId,
        failureReason: params.failureReason,
        'm.relates_to': {
          event_id: params.invokedToolFromEventId,
          key: params.status,
          rel_type: APP_BOXEL_TOOL_RESULT_REL_TYPE,
        },
        data: contentData,
      };
    } else {
      content = {
        msgtype: APP_BOXEL_TOOL_RESULT_WITH_OUTPUT_MSGTYPE,
        'm.relates_to': {
          event_id: params.invokedToolFromEventId,
          key: params.status,
          rel_type: APP_BOXEL_TOOL_RESULT_REL_TYPE,
        },
        commandRequestId: params.toolCallId,
        failureReason: params.failureReason,
        data: {
          ...contentData,
          card: resultCardFileDef.serialize(),
        },
      };
    }
    try {
      return await this.sendEvent(
        params.roomId,
        APP_BOXEL_TOOL_RESULT_EVENT_TYPE,
        content,
      );
    } catch (e) {
      throw new Error(
        `Error sending command result event: ${
          'message' in (e as Error) ? (e as Error).message : e
        }`,
      );
    }
  }

  async sendCodePatchResultEvent(
    roomId: string,
    eventId: string,
    codeBlockIndex: number,
    resultKey: CodePatchStatus,
    attachedCards: CardDef[] = [],
    attachedFiles: FileDef[] = [],
    context: BoxelContext,
    lintIssues?: string[],
    failureReason?: string | undefined,
  ) {
    let contentData = await this.withContextAndAttachments(
      context,
      attachedCards,
      attachedFiles,
    );
    let normalizedLintIssues = lintIssues || [];
    let data: CodePatchResultContent['data'] = {
      ...contentData,
      ...(normalizedLintIssues.length
        ? { lintIssues: normalizedLintIssues }
        : {}),
    };
    let content: CodePatchResultContent = {
      msgtype: APP_BOXEL_CODE_PATCH_RESULT_MSGTYPE,
      codeBlockIndex,
      failureReason,
      'm.relates_to': {
        event_id: eventId,
        key: resultKey,
        rel_type: APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE,
      },
      data,
    };
    try {
      return await this.sendEvent(
        roomId,
        APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
        content,
      );
    } catch (e) {
      throw new Error(
        `Error sending code patch result event: ${
          'message' in (e as Error) ? (e as Error).message : e
        }`,
      );
    }
  }

  async uploadFiles(files: FileDef[]) {
    return await this.client.uploadFiles(files);
  }

  async prefetchFileContent(file: FileDef) {
    return await this.client.prefetchFileContent(file);
  }

  async prefetchLocalFileContent(
    file: FileDef,
    bytes: Uint8Array,
    contentType: string,
  ) {
    return await this.client.prefetchLocalFileContent(file, bytes, contentType);
  }

  async fetchMatrixHostedFile(matrixFileUrl: string) {
    let response = await fetch(matrixFileUrl, {
      headers: {
        Authorization: `Bearer ${this.client.getAccessToken()}`,
      },
    });
    return response;
  }

  // Synthesize a user-message event at click-time and push it into the room's
  // events list so the pending bubble renders without waiting for the pre-send
  // pipeline (skill / command / card / file uploads) or for matrix-js-sdk to
  // emit its native local echo. The synthetic event's id is `local-${cgi}`;
  // when matrix-js-sdk's real local echo eventually arrives in
  // processDecryptedEvent, the cgi→oldEventId bridge there replaces the
  // synthetic in-place so consumers iterating `roomData.events` never see both.
  async addOptimisticEvent(
    roomId: string,
    content: {
      body: string;
      clientGeneratedId: string;
      attachedCardIds: string[];
      attachedFiles: ReturnType<FileDef['serialize']>[];
    },
  ): Promise<number> {
    let userId = this.userId;
    if (!userId) {
      throw new Error('bug: cannot add optimistic event without a userId');
    }
    // Sort just after the tail of the existing timeline rather than using
    // `Date.now()` directly. The matrix-js-sdk and its mocks may use a clock
    // that's offset from the wall clock (mock-matrix's frozen-2024 clock is
    // the common case), and `MessageBuilder.updateMessage` early-returns when
    // the cached message's `created` is later than an incoming event — which
    // would silently drop the status transition from 'sending' to 'sent'.
    let originServerTs = this.resolveOptimisticTimestamp(roomId);
    let event: TempEvent = {
      event_id: `local-${content.clientGeneratedId}`,
      room_id: roomId,
      sender: userId,
      type: 'm.room.message',
      origin_server_ts: originServerTs,
      status: 'sending' as MatrixSDK.EventStatus,
      content: {
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        body: content.body,
        format: 'org.matrix.custom.html',
        clientGeneratedId: content.clientGeneratedId,
        // Deliberately omit isStreamingFinished. Setting it to `false` would
        // make `generatingResults` (which reads `!lastMessage.isStreamingFinished`)
        // misclassify the user's own bubble as "AI generating", flashing the
        // status banner over the user's pending message. Omitting the key is
        // just as effective at suppressing processDecryptedEvent's
        // code-patch-processing branch, which gates on a truthy value.
        data: {
          attachedCards: content.attachedCardIds.map((id) => ({
            sourceUrl: id,
            // MessageBuilder.attachedCardIds only reads sourceUrl; the rest of
            // SerializedFile is filled in below so attachedCardsAsFiles still
            // produces a valid FileDef object.
            name: id.split('/').pop() ?? id,
            contentType: 'application/json',
          })),
          attachedFiles: content.attachedFiles,
          context: {
            tools: [],
            functions: [],
          },
        },
      } as unknown as CardMessageContent,
    };
    await this.addRoomEvent(event);
    return originServerTs;
  }

  // Resolve a timestamp that won't trip MessageBuilder.updateMessage's
  // `incoming.created < cached.created` early-return. Prefer the tail of the
  // existing timeline, then the SDK Room's last-active ts (matches the
  // SDK/mock clock), then wall-clock as a last resort.
  private resolveOptimisticTimestamp(roomId: string): number {
    let existingEvents = this.getRoomData(roomId)?.events ?? [];
    let maxTs = 0;
    for (let e of existingEvents) {
      let ts = (e as any).origin_server_ts;
      if (typeof ts === 'number' && ts > maxTs) {
        maxTs = ts;
      }
    }
    if (maxTs > 0) {
      return maxTs + 1;
    }
    let roomLastActive = this.client
      .getRoom?.(roomId)
      ?.getLastActiveTimestamp?.();
    if (typeof roomLastActive === 'number' && roomLastActive > 0) {
      return roomLastActive + 1;
    }
    return Date.now();
  }

  // Patch an in-flight optimistic event's status (and optional error message)
  // Flip an in-flight pending send between 'sending' and 'not_sent' from
  // doSendMessage's catch / retry paths. Updates both the in-memory synthetic
  // event (so the rendered bubble re-runs through MessageBuilder.updateMessage)
  // and the persisted localStorage entry as one operation, so the two sources
  // of truth can't desync.
  patchPendingSend(
    roomId: string,
    clientGeneratedId: string,
    patch: { status: PendingSendStatus; errorMessage?: string },
  ) {
    let syntheticEventId = `local-${clientGeneratedId}`;
    let roomData = this.getRoomData(roomId);
    let existing = roomData?.events.find(
      (e) => e.event_id === syntheticEventId,
    );
    if (existing) {
      let nextContent: Record<string, unknown> = {
        ...(existing.content ?? {}),
      };
      if (patch.status === 'not_sent') {
        nextContent.errorMessage = patch.errorMessage ?? 'Failed to send';
      } else {
        delete nextContent.errorMessage;
      }
      let next: TempEvent = {
        ...existing,
        status: patch.status as MatrixSDK.EventStatus,
        content: nextContent as TempEvent['content'],
      };
      void this.addRoomEvent(next, syntheticEventId);
    }
    this.localPersistenceService.updatePendingSendStatus(
      roomId,
      clientGeneratedId,
      patch,
    );
  }

  async sendMessage(
    roomId: string,
    body: string | undefined,
    attachedCards: CardDef[] = [],
    attachedFiles: FileDef[] = [],
    clientGeneratedId = uuidv4(),
    context?: BoxelContext,
  ): Promise<void> {
    let tools: Tool[] = [];
    // Open cards are attached automatically
    // If they are not attached, the user is not allowing us to
    // modify them
    let openCardIds = context?.openCardIds ?? [];
    let patchableCards = attachedCards
      .filter((c) => openCardIds.includes(c.id))
      .filter((c) => this.realm.canWrite(c.id));
    // Generate tool calls for patching currently open cards permitted for modification
    tools = tools.concat(
      await addPatchTools(
        this.toolService.commandContext,
        patchableCards,
        this.cardAPI,
      ),
    );

    await this.updateSkillsAndToolsIfNeeded(roomId);
    let contentData = await this.withContextAndAttachments(
      context,
      attachedCards,
      attachedFiles,
    );

    await this.sendEvent(roomId, 'm.room.message', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: body || '',
      format: 'org.matrix.custom.html',
      clientGeneratedId,
      data: {
        attachedFiles: contentData.attachedFiles,
        attachedCards: contentData.attachedCards,
        context: {
          ...contentData.context,
          tools,
          debug: context?.debug,
          functions: [],
        },
      },
    } as CardMessageContent);
  }

  private async withContextAndAttachments(
    context?: BoxelContext,
    attachedCards: CardDef[] = [],
    attachedFiles: FileDef[] = [],
  ): Promise<{
    context: BoxelContext | undefined;
    attachedCards: ReturnType<FileDef['serialize']>[];
    attachedFiles: ReturnType<FileDef['serialize']>[];
  }> {
    let cardFileDefs = await this.uploadCards(attachedCards);
    // Skip files that were already eagerly uploaded by startFileUpload (url
    // differs from sourceUrl, meaning they already point to Matrix media).
    let filesToUpload = attachedFiles.filter(
      (f) => !f.url || f.url === f.sourceUrl,
    );
    let uploadedBySourceUrl = new Map<string, FileDef>();
    if (filesToUpload.length > 0) {
      let uploaded = await this.uploadFiles(filesToUpload);
      for (let file of uploaded) {
        if (file.sourceUrl) {
          uploadedBySourceUrl.set(file.sourceUrl, file);
        }
      }
    }
    let filesForMessage = attachedFiles.map((file) => {
      let replacement = file.sourceUrl
        ? uploadedBySourceUrl.get(file.sourceUrl)
        : undefined;
      return replacement ?? file;
    });

    return {
      context,
      attachedCards: cardFileDefs.map((file: FileDef) => file.serialize()),
      attachedFiles: filesForMessage.map((file: FileDef) => file.serialize()),
    };
  }

  getLastActiveTimestamp(roomId: string, defaultTimestamp: number) {
    let matrixRoom = this.client.getRoom(roomId);
    let lastMatrixEvent = matrixRoom?.getLastActiveTimestamp();
    // Renaming a session counts as activity and moves it to the top of the
    // past-sessions list. A rename is recorded as an `m.room.name` state event,
    // but `getLastActiveTimestamp()` only inspects the live timeline. After a
    // reload the fresh sync can surface that rename as current room state rather
    // than a timeline event, so the room's last-active time would otherwise
    // regress to its last message and the rename's ordering would be lost. Fold
    // the rename's timestamp in so a renamed session keeps its place.
    let nameEventTimestamp = matrixRoom?.currentState
      ?.getStateEvents('m.room.name', '')
      ?.getTs();
    let candidates = [lastMatrixEvent, nameEventTimestamp].filter(
      (timestamp): timestamp is number => typeof timestamp === 'number',
    );
    if (candidates.length === 0) {
      return defaultTimestamp;
    }
    return Math.max(...candidates);
  }

  async requestRegisterEmailToken(
    email: string,
    clientSecret: string,
    sendAttempt: number,
  ) {
    return await this.client.requestEmailToken(
      'registration',
      email,
      clientSecret,
      sendAttempt,
    );
  }

  async requestChangeEmailToken(
    email: string,
    clientSecret: string,
    sendAttempt: number,
  ) {
    return await this.client.requestEmailToken(
      'threepid',
      email,
      clientSecret,
      sendAttempt,
    );
  }

  async login(usernameOrEmail: string, password: string) {
    try {
      const cred = await this.client.loginWithPassword(
        usernameOrEmail,
        password,
      );
      return cred;
    } catch (error) {
      try {
        const cred = await this.client.loginWithEmail(
          usernameOrEmail,
          password,
        );
        return cred;
      } catch (error2) {
        throw error;
      }
    }
  }

  async loginFlows() {
    await this.ready;
    return this.client.loginFlows();
  }

  async getSsoLoginUrl(callbackUrl: string, idpId: string) {
    await this.ready;
    return this.client.getSsoLoginUrl(callbackUrl, 'sso', idpId);
  }

  async loginWithSsoToken(token: string) {
    await this.ready;
    return this.client.loginWithToken(token);
  }

  getRoomData(roomId: string) {
    return this.roomDataMap.get(roomId);
  }

  private setRoomData(roomId: string, roomData: Room) {
    this.roomDataMap.set(roomId, roomData);
    if (!this.roomResourcesCache.has(roomId)) {
      this.roomResourcesCache.set(
        roomId,
        getRoom(
          this,
          () => roomId,
          () => {
            let data = this.getRoomData(roomId);
            // Return both _events and _roomState (via hasRoomState) so the
            // resource re-runs when either changes. processRoomTask returns
            // early if the aiBot isn't in memberIds, and memberIds is
            // derived from _roomState (set by drainRoomState) independently
            // from _events (updated by drainTimeline). Encoding both as the
            // returned arg ensures invalidation regardless of whether
            // ember-resources reacts to consumed-but-unreturned tracked deps
            // or only to argument value changes.
            return [data?.events, data?.hasRoomState] as const;
          },
        ),
      );
    }
  }

  // The default skills for a new AI room, as skill ids. When the user's active
  // system card lists any default skills — legacy `Skill` cards, `.md` skill
  // files, or both — those win (mode-agnostic). Otherwise we fall back to the
  // hardcoded, submode-aware set. Ids may name a `.md` skill file or a legacy
  // `Skill` card; callers resolve them kind-agnostically via `loadSkillSource`.
  async loadDefaultSkills(submode: Submode): Promise<string[]> {
    let configuredIds = [
      ...(this.systemCard?.defaultSkillCards ?? []),
      ...(this.systemCard?.defaultSkillFiles ?? []),
    ]
      .map((skill) => skill?.id)
      .filter((id): id is NonNullable<typeof id> => Boolean(id));
    if (configuredIds.length) {
      return configuredIds;
    }

    let interactModeDefaultSkills = [envSkillId];

    // Code editing is covered by the code-mode entry-point skill (see
    // activateCodingSkill), so source-code-editing is no longer pushed here.
    // The two remaining defaults are still legacy pushed cards (full body in
    // every prompt); they move to markdown + on-demand references once the
    // bot supports commands on markdown skills, after which this list shrinks.
    let codeModeDefaultSkills = [devSkillId, envSkillId];

    return submode === 'code'
      ? codeModeDefaultSkills
      : interactModeDefaultSkills;
  }

  @cached
  get roomResources() {
    let resources: TrackedMap<string, RoomResource> = new TrackedMap();
    for (let roomId of this.roomDataMap.keys()) {
      if (!this.roomResourcesCache.get(roomId)) {
        continue;
      }
      resources.set(roomId, this.roomResourcesCache.get(roomId)!);
    }
    return resources;
  }

  resetState() {
    this.teardownClient();
    this.roomDataMap.clear();
    this.roomMembershipQueue = [];
    this.roomStateQueue = [];
    for (let roomResource of this.roomResourcesCache.values()) {
      roomResource.teardown();
    }
    this.roomResourcesCache.clear();
    this.canceledActionMessageIdByRoom.clear();
    this.failedToolState.clear();
    this.reasoningExpandedState.clear();
    this.timelineQueue = [];
    this.flushMembership = undefined;
    this.flushTimeline = undefined;
    this.flushRoomState = undefined;
    this.timelineLoadingState.clear();
    this._client = this.#matrixSDK?.createClient({ baseUrl: matrixURL });
    this._currentRoomId = undefined;
    this._isInitializingNewUser = false;
    if (isTesting() && this.postLoginCompleted) {
      console.warn(
        '[login-diag] postLoginCompleted reset to false via resetState()\n' +
          new Error().stack,
      );
    }
    this.postLoginCompleted = false;
    this.bootedFromLegacyRealmsList = false;
    this._isLoadingMoreAIRooms = false;
    this.messagesToSend.clear();
    this.cardsToSend.clear();
    this.filesToSend.clear();
    this.currentUserEventReadReceipts.clear();
    this.restoredDraftRooms = new Set();
    this.hydratedPendingSendRooms = new Set();
    this.aiRoomIds.clear();
    this.initialSyncCompleted = false;
    this.initialSyncCompletedDeferred = new Deferred<void>();
    this.roomsWaitingForSync.clear();
    this._systemCardInvalidationUnsub?.();
    this._systemCardInvalidationUnsub = undefined;
    this._userChoiceId = undefined;
    this._systemCardWasLost = false;
    this._systemCard = undefined;
    this._systemCardLoadFailed = false;
    this.startedAtTs = -1;
    this.#clientReadyDeferred = new Deferred<void>();
  }

  private teardownClient() {
    if (this.#eventBindings && this._client) {
      this.unbindEventListeners();
    }
    this.slidingSync?.off?.(
      SlidingSyncEvent.Lifecycle,
      this.onSlidingSyncLifecycle,
    );
    this.slidingSync?.stop?.();
    this.slidingSync = undefined;
    this._client?.stopClient?.();
  }

  markActionAsCanceled(roomId: string, eventId: string) {
    this.canceledActionMessageIdByRoom.set(roomId, eventId);
  }

  getLastCanceledActionEventId(roomId: string): string | undefined {
    return this.canceledActionMessageIdByRoom.get(roomId);
  }

  private bindEventListeners() {
    if (!this.#eventBindings) {
      throw new Error(
        `cannot bind to matrix events before the matrix SDK has loaded`,
      );
    }
    for (let [event, handler] of this.#eventBindings) {
      this.client.on(event, handler);
    }
  }
  private unbindEventListeners() {
    if (!this.#eventBindings) {
      throw new Error(
        `cannot unbind to matrix events before the matrix SDK has loaded`,
      );
    }
    for (let [event, handler] of this.#eventBindings) {
      this.client.off(event, handler);
    }
  }

  async createRoom(opts: MatrixSDK.ICreateRoomOpts) {
    let result = await this.client.createRoom(opts);
    await this.waitForRoomSync(result.room_id);
    return result;
  }

  async waitForRoomSync(roomId: string) {
    let deferred = this.roomsWaitingForSync.get(roomId);
    if (!deferred) {
      deferred = new Deferred<void>();
      this.roomsWaitingForSync.set(roomId, deferred);
    }
    await deferred.promise;
    this.roomsWaitingForSync.delete(roomId);
  }

  async createCard<T extends typeof BaseDef>(
    codeRef: ResolvedCodeRef,
    attr: Record<string, any>,
  ) {
    let data: LooseCardResource = {
      meta: {
        adoptsFrom: codeRef,
      },
      attributes: {
        ...attr,
      },
    };
    let card = await this.cardAPI.createFromSerialized<T>(
      data,
      { data },
      undefined,
    );
    return card;
  }

  async getProfileInfo(userId: string) {
    return await this.client.getProfileInfo(userId);
  }

  async getThreePids() {
    return await this.client.getThreePids();
  }

  async addThreePidOnly(data: MatrixSDK.IAddThreePidOnlyBody) {
    return await this.client.addThreePidOnly(data);
  }

  async deleteThreePid(medium: string, address: string) {
    return await this.client.deleteThreePid(medium, address);
  }

  async setPowerLevel(roomId: string, userId: string, powerLevel: number) {
    let roomData = this.ensureRoomData(roomId);
    await roomData.mutex.dispatch(async () => {
      return this.client.setPowerLevel(roomId, userId, powerLevel);
    });
  }

  async inviteUserToRoom(roomId: string, userId: string) {
    let roomData = this.ensureRoomData(roomId);
    await roomData.mutex.dispatch(async () => {
      return this.client.invite(roomId, userId);
    });
  }

  async getStateEvent(
    roomId: string,
    eventType: string,
    stateKey: string = '',
  ) {
    return this.client.getStateEvent(roomId, eventType, stateKey);
  }

  async getStateEventSafe(
    roomId: string,
    eventType: string,
    stateKey: string = '',
  ) {
    try {
      return await this.client.getStateEvent(roomId, eventType, stateKey);
    } catch (e: unknown) {
      if (e instanceof Error && 'errcode' in e && e.errcode === 'M_NOT_FOUND') {
        // this is fine, it just means the state event doesn't exist yet
        return undefined;
      } else {
        throw e;
      }
    }
  }

  async sendStateEvent(
    roomId: string,
    eventType: string,
    content: Record<string, any>,
    stateKey: string = '',
  ) {
    let roomData = this.ensureRoomData(roomId);
    await roomData.mutex.dispatch(async () => {
      return this.client.sendStateEvent(roomId, eventType, content, stateKey);
    });
  }

  async updateStateEvent(
    roomId: string,
    eventType: string,
    stateKey: string = '',
    transformContent: (
      content: Record<string, any>,
    ) => Promise<Record<string, any>>,
  ) {
    let roomData = this.ensureRoomData(roomId);
    await roomData.mutex.dispatch(async () => {
      let currentContent = await this.getStateEventSafe(
        roomId,
        eventType,
        stateKey,
      );

      // Store the original content string for comparison
      let currentContentString = stringify(currentContent ?? {});
      let newContent = await transformContent(currentContent ?? {});

      // Skip sending state event if content hasn't changed
      if (currentContentString === stringify(newContent)) {
        return;
      }

      return this.client.sendStateEvent(
        roomId,
        eventType,
        newContent,
        stateKey,
      );
    });
  }

  async leave(roomId: string) {
    let roomData = this.ensureRoomData(roomId);
    await roomData.mutex.dispatch(async () => {
      return this.client.leave(roomId);
    });
  }

  async forget(roomId: string) {
    let roomData = this.ensureRoomData(roomId);
    await roomData.mutex.dispatch(async () => {
      return this.client.forget(roomId);
    });
  }

  async setRoomName(roomId: string, name: string) {
    let roomData = this.ensureRoomData(roomId);
    await roomData.mutex.dispatch(async () => {
      return this.client.setRoomName(roomId, name);
    });
  }

  async requestPasswordEmailToken(
    email: string,
    clientSecret: string,
    sendAttempt: number,
    nextLink?: string,
  ) {
    return await this.client.requestPasswordEmailToken(
      email,
      clientSecret,
      sendAttempt,
      nextLink,
    );
  }

  async setPassword(
    authDict: MatrixSDK.AuthDict,
    newPassword: string,
    logoutDevices?: boolean,
  ) {
    return await this.client.setPassword(authDict, newPassword, logoutDevices);
  }

  async registerRequest(data: MatrixSDK.RegisterRequest, kind?: string) {
    return await this.client.registerRequest(data, kind);
  }

  // Type of matrixEvent is a partial MatrixEvent because a couple of places
  // where this method is called don't have the full MatrixEvent type available
  async sendReadReceipt(
    matrixEvent: Pick<MatrixEvent, 'getId' | 'getRoomId' | 'getTs'>,
  ) {
    return await this.client.sendReadReceipt(matrixEvent as MatrixEvent);
  }

  async isUsernameAvailable(username: string) {
    return await this.client.isUsernameAvailable(username);
  }

  private async loadAllTimelineEvents(roomId: string) {
    let roomData = this.ensureRoomData(roomId);
    let room = this.client.getRoom(roomId);
    let roomResource = this.roomResources.get(roomId);

    if (!room || !roomResource) {
      throw new Error(`Cannot find room with id ${roomId}`);
    }

    if (this.timelineLoadingState.get(roomId)) {
      return;
    }

    this.timelineLoadingState.set(roomId, true);
    try {
      // Create a filter that includes all events
      let filter = new Filter(this.client.getUserId()!, 'old_messages');
      filter.setDefinition({
        room: {
          timeline: {
            limit: 100,
            not_types: [APP_BOXEL_STOP_GENERATING_EVENT_TYPE],
            'org.matrix.msc3874.not_rel_types': ['m.replace'],
          },
        },
      });

      // Get or create a filtered timeline set
      let timelineSet = room.getOrCreateFilteredTimelineSet(filter, {
        prepopulateTimeline: true,
        useSyncEvents: true,
      });

      let timeline = timelineSet.getLiveTimeline();
      if (timeline.getPaginationToken('b' as MatrixSDK.Direction) == null) {
        return;
      }

      while (timeline.getPaginationToken('b' as MatrixSDK.Direction) != null) {
        await this.client.paginateEventTimeline(timeline, {
          backwards: true,
        });
      }

      let rs = room.getLiveTimeline().getState('f' as MatrixSDK.Direction);
      if (rs) {
        roomData.notifyRoomStateUpdated(rs);
      }

      // Wait for all events to be loaded in roomResource
      let events = timeline.getEvents();
      this.timelineQueue.push(...events.map((e) => ({ event: e })));
      await this.drainTimeline();
      await this.roomResources.get(roomId)?.processing;
    } finally {
      this.timelineLoadingState.set(roomId, false);
    }
  }

  get isLoadingTimeline() {
    if (!this.currentRoomId) {
      return false;
    }
    return this.timelineLoadingState.get(this.currentRoomId) ?? false;
  }

  // Five-layer resolver guaranteeing defined `toolsSupported` + `inputModalities`
  // on the wire. `reasoningEffort` is a user choice, never auto-filled from
  // the curated fallback or the conservative floor.
  //
  //   1. caller overrides (preserves explicit false / explicit values)
  //   2. SystemCard.modelConfigurations match by modelId
  //   3. DEFAULT_FALLBACK_MODELS match by modelId
  //   4. most-recent valid prior app.boxel.active-llm event in this room
  //      for the same model (skips CS-11249-era broken events)
  //   5. conservative floor: tools off, modalities text-only
  //
  // Layer 4 reads in-memory events only; if the timeline isn't paginated yet
  // (rare race) it degrades to layer 5, which is the safe direction.
  resolveActiveLLMConfig(
    roomId: string,
    model: string,
    callerOverrides?: {
      toolsSupported?: boolean;
      inputModalities?: string[];
      reasoningEffort?: string;
    },
  ): {
    toolsSupported: boolean;
    inputModalities: string[];
    reasoningEffort?: string;
  } {
    let toolsSupported: boolean | undefined = callerOverrides?.toolsSupported;
    let inputModalities: string[] | undefined =
      callerOverrides?.inputModalities;
    let reasoningEffort: string | undefined = callerOverrides?.reasoningEffort;

    let scMatch = this.systemCard?.modelConfigurations?.find(
      (c) => c.modelId === model,
    );
    if (scMatch) {
      if (
        toolsSupported === undefined &&
        scMatch.toolsSupported !== undefined
      ) {
        toolsSupported = scMatch.toolsSupported;
      }
      if (
        inputModalities === undefined &&
        scMatch.inputModalities !== undefined
      ) {
        inputModalities = scMatch.inputModalities;
      }
      if (
        reasoningEffort === undefined &&
        scMatch.reasoningEffort !== undefined
      ) {
        reasoningEffort = scMatch.reasoningEffort;
      }
    }

    let fb = DEFAULT_FALLBACK_MODELS.find((m) => m.modelId === model);
    if (fb) {
      if (toolsSupported === undefined) {
        toolsSupported = fb.toolsSupported;
      }
      if (inputModalities === undefined) {
        inputModalities = fb.inputModalities;
      }
    }

    if (
      toolsSupported === undefined ||
      inputModalities === undefined ||
      reasoningEffort === undefined
    ) {
      let roomData = this.getRoomData(roomId);
      let mostRecent: ActiveLLMEvent | undefined;
      for (let e of roomData?.events ?? []) {
        if (e.type !== APP_BOXEL_ACTIVE_LLM) continue;
        let candidate = e as ActiveLLMEvent;
        if (
          candidate.content.model !== model ||
          candidate.content.toolsSupported === undefined ||
          candidate.content.inputModalities === undefined
        ) {
          continue;
        }
        if (
          !mostRecent ||
          (candidate.origin_server_ts ?? 0) > (mostRecent.origin_server_ts ?? 0)
        ) {
          mostRecent = candidate;
        }
      }
      if (mostRecent) {
        if (toolsSupported === undefined) {
          toolsSupported = mostRecent.content.toolsSupported;
        }
        if (inputModalities === undefined) {
          inputModalities = mostRecent.content.inputModalities;
        }
        if (
          reasoningEffort === undefined &&
          mostRecent.content.reasoningEffort !== undefined
        ) {
          reasoningEffort = mostRecent.content.reasoningEffort;
        }
      }
    }

    if (toolsSupported === undefined) {
      toolsSupported = false;
    }
    if (inputModalities === undefined) {
      inputModalities = ['text'];
    }

    return { toolsSupported, inputModalities, reasoningEffort };
  }

  async sendActiveLLMEvent(
    roomId: string,
    model: string,
    callerOverrides?: {
      toolsSupported?: boolean;
      inputModalities?: string[];
      reasoningEffort?: string;
    },
  ) {
    let caps = this.resolveActiveLLMConfig(roomId, model, callerOverrides);
    await this.client.sendStateEvent(roomId, APP_BOXEL_ACTIVE_LLM, {
      model,
      toolsSupported: caps.toolsSupported,
      reasoningEffort: caps.reasoningEffort,
      inputModalities: caps.inputModalities,
    });
  }

  async sendLLMModeEvent(roomId: string, mode: LLMMode) {
    await this.client.sendStateEvent(roomId, APP_BOXEL_LLM_MODE, { mode });
  }

  private async addRoomEvent(event: TempEvent, oldEventId?: string) {
    let { room_id: roomId } = event;

    if (!roomId) {
      throw new Error(
        `bug: roomId is undefined for event ${JSON.stringify(event, null, 2)}`,
      );
    }

    //We don't need to store auth room events
    if (!this.aiRoomIds.has(roomId)) {
      return;
    }
    let roomData = this.ensureRoomData(roomId);
    roomData.addEvent(event, oldEventId);
  }

  private ensureRoomData(roomId: string) {
    let roomData = this.getRoomData(roomId);
    if (!roomData) {
      roomData = new Room(roomId);
      this.setRoomData(roomId, roomData);
    }
    return roomData;
  }

  private onMembership = (event: MatrixEvent, member: RoomMember) => {
    this.roomMembershipQueue.push({ event, member });
    debounce(this, this.drainMembership, 100);
  };

  private async drainMembership() {
    await this.flushMembership;

    let eventsDrained: () => void;
    this.flushMembership = new Promise((res) => (eventsDrained = res));

    try {
      let events = [...this.roomMembershipQueue];
      this.roomMembershipQueue = [];

      await Promise.all(
        events.map(({ event: { event, status } }) =>
          this.addRoomEvent({ ...event, status }),
        ),
      );

      // For rooms that we have been invited to we are unable to get the full
      // timeline event yet (it's not available until we join the room), but we
      // still need to get enough room state events to reasonably render the
      // room card.
      for (let {
        event: { event: rawEvent },
        member,
      } of events) {
        let event = rawEvent as DiscreteMatrixEvent;
        let { room_id: roomId } = rawEvent as DiscreteMatrixEvent;
        if (!roomId) {
          throw new Error(
            `bug: roomId is undefined for event ${JSON.stringify(
              event,
              null,
              2,
            )}`,
          );
        }
        let room = this.client.getRoom(roomId);
        if (!room) {
          throw new Error(
            `bug: should never get here--matrix sdk returned a null room for ${roomId}`,
          );
        }

        if (
          member.userId === this.client.getUserId() &&
          event.type === 'm.room.member' &&
          room.getMyMembership() === 'invite'
        ) {
          if (event.content.membership === 'invite') {
            let stateEvents = room
              .getLiveTimeline()
              .getState('f' as MatrixSDK.Direction)?.events;
            if (!stateEvents) {
              throw new Error(
                `bug: cannot get state events for room ${roomId}`,
              );
            }
            for (let eventType of STATE_EVENTS_OF_INTEREST) {
              let events = stateEvents.get(eventType);
              if (!events) {
                continue;
              }
              await Promise.all(
                [...events.values()]
                  .map((e) => ({
                    ...e.event,
                    // annoyingly these events have been stripped of their id's
                    event_id: `${roomId}_${eventType}_${e.localTimestamp}`,
                    status: e.status,
                  }))
                  .map((event) => this.addRoomEvent(event)),
              );
            }
          }
        }
      }
    } finally {
      eventsDrained!();
    }
  }

  private onReceipt = async (e: MatrixEvent) => {
    let userId = this.client.credentials.userId;
    if (userId) {
      let eventIds = Object.keys(e.getContent());
      for (let eventId of eventIds) {
        let receipt = e.getContent()[eventId]['m.read'][userId];
        if (receipt) {
          this.addEventReadReceipt(eventId, { readAt: receipt.ts });
        }
      }
    }
  };

  private onRoomStateUpdate = (rs: MatrixSDK.RoomState) => {
    this.roomStateQueue.push(rs);
    debounce(this, this.drainRoomState, 100);
  };

  private drainRoomState = async () => {
    await this.flushRoomState;

    let roomStateUpdatesDrained: () => void;
    this.flushRoomState = new Promise((res) => (roomStateUpdatesDrained = res));

    let roomStates = [...this.roomStateQueue];
    this.roomStateQueue = [];
    const roomStateMap = new Map<string, MatrixSDK.RoomState>();
    for (const rs of roomStates) {
      roomStateMap.set(rs.roomId, rs);
    }
    roomStates = Array.from(roomStateMap.values());
    for (let rs of roomStates) {
      // The auth rooms are not stored
      // so we don't need to process the state updates
      if (!this.aiRoomIds.has(rs.roomId)) {
        continue;
      }
      let roomData = this.ensureRoomData(rs.roomId);
      roomData.notifyRoomStateUpdated(rs);
    }
    roomStateUpdatesDrained!();
  };

  private onTimeline = (e: MatrixEvent) => {
    this.timelineQueue.push({ event: e });
    debounce(this, this.drainTimeline, 100);
  };

  private onUpdateEventStatus = (
    e: MatrixEvent,
    _room: unknown,
    maybeOldEventId?: string,
  ) => {
    this.timelineQueue.push({ event: e, oldEventId: maybeOldEventId });
    debounce(this, this.drainTimeline, 100);
  };

  private buildEventForProcessing(event: MatrixEvent) {
    // Restructure the event, ensuring keys exist
    let restructuredEvent = {
      ...event.event,
      status: event.status,
      content: event.getContent() || undefined,
      error: event.error ?? undefined,
    };
    // Make a deep copy of the event to avoid mutating the original Matrix SDK event
    // This is necessary because the event returned is one we pass in, and this function
    // may run before the event itself is sent.
    // To avoid hard to track down bugs, we make a deep copy of the event here.
    return cloneDeep(restructuredEvent);
  }

  private async drainTimeline() {
    await this.flushTimeline;

    let eventsDrained: () => void;
    this.flushTimeline = new Promise((res) => (eventsDrained = res));
    try {
      let events = [...this.timelineQueue];
      this.timelineQueue = [];
      for (let { event, oldEventId } of events) {
        await this.client?.decryptEventIfNeeded(event);
        await this.processDecryptedEvent(
          this.buildEventForProcessing(event),
          oldEventId,
        );
      }
    } finally {
      eventsDrained!();
    }
  }

  private async processDecryptedEvent(event: TempEvent, oldEventId?: string) {
    // Graceful test teardown: ignore late events after the service is destroyed.
    if (this.isDestroying || this.isDestroyed) {
      return;
    }

    let { room_id: roomId } = event;
    if (!roomId) {
      throw new Error(
        `bug: roomId is undefined for event ${JSON.stringify(event, null, 2)}`,
      );
    }
    let room = this.client.getRoom(roomId);
    if (!room) {
      throw new Error(
        `bug: should never get here--matrix sdk returned a null room for ${roomId}`,
      );
    }

    let userId = this.client.getUserId();
    if (!userId) {
      throw new Error(
        `bug: userId is required for event ${JSON.stringify(event, null, 2)}`,
      );
    }

    // We might still receive events from the rooms that the user has left.
    let member = room.getMember(userId);
    if (!member || member.membership !== 'join') {
      return;
    }

    if (!this.aiRoomIds.has(roomId)) {
      this.processDecryptedEventFromAuthRoom(event);
      return;
    }

    // cgi→oldEventId bridge: if doSendMessage previously injected a synthetic
    // optimistic event with event_id `local-${cgi}`, hand that id to addEvent
    // as oldEventId so Room.addEvent replaces the synthetic in-place. Without
    // this bridge the synthetic and the real echo would both live in
    // roomData.events and every consumer iterating `this.events` (sortedEvents,
    // usedLLMs, llmModeEvents, command/code-patch result lookups, MessageBuilder's
    // `events` argument) would double-count.
    let cgi = event.content?.clientGeneratedId as string | undefined;
    if (cgi && !oldEventId) {
      let existing = this.getRoomData(roomId)?.events.find((e) => {
        let eContent = (e as any).content;
        return (
          eContent?.clientGeneratedId === cgi &&
          typeof (e as any).event_id === 'string' &&
          (e as any).event_id.startsWith('local-')
        );
      });
      if (existing) {
        oldEventId = (existing as any).event_id;
      }
    }

    await this.addRoomEvent(event, oldEventId);

    // Drop the persisted pending entry only once matrix-js-sdk has finalized
    // the send. EventStatus is null/undefined for fully-delivered events (the
    // SDK clears it after the server ack); 'sent' covers the intermediate
    // "echo accepted, awaiting ack" state. Removing earlier (e.g. on the
    // initial 'sending' local echo) would defeat a later patchPendingSend(
    // 'not_sent') because the persisted entry would already be gone, so a
    // failed send wouldn't survive a reload. 'not_sent' / 'cancelled' flow
    // through patchPendingSend instead and keep the entry around so the
    // failed bubble can be restored on reload.
    let isTerminalSent =
      event.status === null ||
      event.status === undefined ||
      (event.status as string) === 'sent';
    if (cgi && isTerminalSent && event.sender === this.userId) {
      this.localPersistenceService.removePendingSend(roomId, cgi);
    }

    if (
      event.type === 'm.room.message' &&
      getToolRequests(event.content)?.length &&
      event.content?.isStreamingFinished
    ) {
      this.toolService.queueEventForToolProcessing(event);
    }

    // Queue code patches for processing
    if (
      event.type === 'm.room.message' &&
      event.content?.body &&
      event.content?.isStreamingFinished
    ) {
      // Check if the message contains code patches by looking for search/replace blocks
      let body = event.content.body as string;
      if (
        body.includes(SEARCH_MARKER) &&
        body.includes(SEPARATOR_MARKER) &&
        body.includes(REPLACE_MARKER)
      ) {
        this.toolService.queueEventForCodePatchProcessing(event);
      }
    }
  }

  private async processDecryptedEventFromAuthRoom(event: TempEvent) {
    // patch in any missing room events--this will support dealing with local
    // echoes, migrating older histories as well as handle any matrix syncing gaps
    // that might occur
    if (
      event.type === 'm.room.message' &&
      event.content?.msgtype === APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE
    ) {
      await this.realmServer.handleEvent(event);
    } else if (
      event.type === APP_BOXEL_REALM_EVENT_TYPE &&
      event.sender &&
      event.content
    ) {
      realmEventsLogger.debug('Received realm event', event);
      if (
        this.startedAtTs === -1 ||
        (event.origin_server_ts || 0) < this.startedAtTs
      ) {
        realmEventsLogger.debug(
          'Ignoring realm event because it occurred before the client started',
          event,
        );
        return;
      }

      const content = event.content as RealmEventContent;
      if (!content.realmURL) {
        realmEventsLogger.debug(
          'Ignoring realm event because no realm URL was provided',
          event,
        );
        return;
      }

      (content as any).origin_server_ts = event.origin_server_ts;
      this.messageService.relayRealmEvent(content);
    }
  }

  private clearAuth() {
    this.storage?.removeItem('auth');
    this.localPersistenceService.setCurrentRoomId(undefined);
  }

  async activateCodingSkill() {
    if (!this.currentRoomId) {
      return;
    }

    let updateRoomSkillsCommand = new UpdateRoomSkillsTool(
      this.toolService.commandContext,
    );
    let defaultSkillIds = await this.loadDefaultSkills('code');
    await updateRoomSkillsCommand.execute({
      roomId: this.currentRoomId,
      // Dual-path window: the legacy card skills activate alongside the
      // markdown source-code-editing skill. All are pushed for now; the
      // on-demand entry point returns as a catalog listing.
      skillCardIdsToActivate: [...defaultSkillIds, sourceCodeEditingSkillUrl],
    });
  }

  loadMoreAIRooms() {
    this.loadMoreAIRoomsTask.perform();
  }

  private loadMoreAIRoomsTask = dropTask(async () => {
    if (!this.slidingSync) {
      throw new Error(
        'To load more AI rooms, sliding sync must be initialized',
      );
    }

    let currentList = this.slidingSync.getListParams(
      SLIDING_SYNC_AI_ROOM_LIST_NAME,
    );
    if (!currentList) return;

    let currentRange = currentList.ranges[0];
    if (!currentRange) return;

    if (this.aiRoomIds.size < currentRange[1] - 1) {
      return;
    }

    let newEndRange = currentRange[1] + 10;

    this._isLoadingMoreAIRooms = true;
    try {
      // Temporarily disable timeout to get immediate response when changing list ranges.
      // Without this, the server would hold the request open for 30 seconds waiting for
      // "new" data, even though we want the expanded range data immediately.
      // This prevents the poor UX of waiting 30 seconds after calling setListRanges.
      // @ts-expect-error bypassing "private readonly" TS annotation
      this.slidingSync.timeoutMS = 0;
      await this.slidingSync.setListRanges(SLIDING_SYNC_AI_ROOM_LIST_NAME, [
        [0, newEndRange],
      ]);
    } finally {
      // Restore normal long-polling timeout for efficient background syncing
      // @ts-expect-error bypassing "private readonly" TS annotation
      this.slidingSync.timeoutMS = SLIDING_SYNC_TIMEOUT;
      await timeout(500); // keep the spinner up a bit longer while the new rooms are rendered
      this._isLoadingMoreAIRooms = false;
    }
  });

  get isLoadingMoreAIRooms() {
    return this._isLoadingMoreAIRooms;
  }

  get systemCard() {
    return this._systemCard;
  }

  // True when the SystemCard chain itself is broken: an env-configured
  // systemCardId failed to load, or the user's choice failed AND no env
  // default is configured. Steady-state "no SystemCard at all" returns false.
  get isUsingFallbackSystemCard(): boolean {
    return this._systemCardLoadFailed;
  }

  private async setSystemCard(userChoiceId: string | undefined) {
    this._userChoiceId = userChoiceId;
    let envDefaultId = ENV.defaultSystemCardId;

    if (userChoiceId && userChoiceId === this._systemCard?.id) {
      this._systemCardLoadFailed = false;
      return;
    }

    let loadedCard: SystemCard | undefined;
    let userChoiceFailed = false;
    if (userChoiceId) {
      let result = await this.store.get<SystemCard>(userChoiceId);
      if (isCardErrorJSONAPI(result)) {
        console.error(
          `Error loading user-chosen system card: ${stringifyErrorForLog(result)}`,
        );
        userChoiceFailed = true;
      } else {
        loadedCard = result;
      }
    }

    let envDefaultFailed = false;
    if (!loadedCard && envDefaultId) {
      if (envDefaultId === this._systemCard?.id) {
        loadedCard = this._systemCard;
      } else {
        let result = await this.store.get<SystemCard>(envDefaultId);
        if (isCardErrorJSONAPI(result)) {
          console.error(
            `Error loading env default system card: ${stringifyErrorForLog(result)}`,
          );
          envDefaultFailed = true;
        } else {
          loadedCard = result;
        }
      }
    }

    // Clear the post-loss signal before deriving the banner state so a
    // successful resolution in this call does not re-trip the third clause.
    if (loadedCard) {
      this._systemCardWasLost = false;
    }
    this._systemCardLoadFailed =
      envDefaultFailed ||
      (userChoiceFailed && !envDefaultId) ||
      (this._systemCardWasLost && !loadedCard);

    if (loadedCard?.id !== this._systemCard?.id) {
      this._systemCardInvalidationUnsub?.();
      this._systemCardInvalidationUnsub = undefined;
      this.store.dropReference(this._systemCard?.id);
      if (loadedCard) {
        this.store.addReference(loadedCard.id);
        // Capture the id in the closure — by the time the callback fires, the
        // store has evicted the card, so we cannot read it off `_systemCard`.
        let subscribedId = loadedCard.id;
        this._systemCardInvalidationUnsub =
          this.store.subscribeToCardInvalidation(subscribedId, () =>
            this.onSystemCardInvalidated(subscribedId),
          );
      }
      this._systemCard = loadedCard;
    }
  }

  // Fires when the active SystemCard is deleted in the same session (either
  // via the in-tab UI or via a matrix-auth-room invalidation originating
  // elsewhere). Re-evaluate the chain so the fallback banner surfaces or the
  // env-default silently takes over, and clear the matrix preference when the
  // dangling id was the user's own pick so it does not keep being rebroadcast.
  private onSystemCardInvalidated = async (invalidatedId: string) => {
    let wasUserChoice = this._userChoiceId === invalidatedId;
    // Drop the doomed reference so setSystemCard does not take its id-match
    // fast path against the now-evicted instance.
    this._systemCardInvalidationUnsub?.();
    this._systemCardInvalidationUnsub = undefined;
    this.store.dropReference(this._systemCard?.id);
    this._systemCard = undefined;
    // Sticky signal that survives the asynchronous matrix account-data echo
    // below — keeps `_systemCardLoadFailed` true through any re-entry into
    // `setSystemCard(undefined)` until a replacement card actually resolves.
    this._systemCardWasLost = true;
    await this.setSystemCard(this._userChoiceId);
    if (wasUserChoice) {
      await this.setUserSystemCard(undefined);
    }
  };

  async setUserSystemCard(systemCardId: string | undefined) {
    // This sets the users account data for their preferred system card
    // If there is none, we fall back to the default
    await this.client.setAccountData(APP_BOXEL_SYSTEM_CARD_EVENT_TYPE, {
      id: systemCardId,
    });
  }

  async loadMoreAuthRooms(realms: string[]) {
    if (!this.slidingSync) {
      throw new Error(
        'To load more auth rooms, sliding sync must be initialized',
      );
    }

    let currentList = this.slidingSync.getListParams(
      SLIDING_SYNC_AUTH_ROOM_LIST_NAME,
    );
    if (!currentList) return;

    let currentRange = currentList.ranges[0];
    if (!currentRange) return;
    if (realms.length - 1 <= currentRange[1]) {
      return;
    }

    let newEndRange = realms.length - 1;
    await this.slidingSync.setListRanges(SLIDING_SYNC_AUTH_ROOM_LIST_NAME, [
      [0, newEndRange],
    ]);
  }

  private ensureMessageDraftRestored(roomId: string) {
    if (this.restoredDraftRooms.has(roomId)) {
      return;
    }
    this.restoredDraftRooms.add(roomId);

    let draft = this.localPersistenceService.getDraft(roomId);
    if (!draft) {
      return;
    }

    if (typeof draft.message === 'string' && draft.message.length > 0) {
      this.messagesToSend.set(roomId, draft.message);
    }

    if (draft.attachedCardIds && draft.attachedCardIds.length > 0) {
      this.cardsToSend.set(roomId, [...draft.attachedCardIds]);
    }

    if (draft.attachedFiles && draft.attachedFiles.length > 0) {
      let fileDefs = draft.attachedFiles
        .map((file) => this.fileAPI.createFileDef(file))
        .filter(Boolean);
      if (fileDefs.length > 0) {
        this.filesToSend.set(roomId, fileDefs as FileDef[]);
      }
    }
  }

  // Hydrate persisted optimistic sends (from a prior tab/session) into the
  // room's events list before matrix-js-sdk's /sync delivers any real echo.
  // Real echoes that match by clientGeneratedId reconcile through the bridge
  // in processDecryptedEvent; entries left in 'not_sent' surface the retry alert.
  ensurePendingSendsHydrated(roomId: string) {
    if (this.hydratedPendingSendRooms.has(roomId)) {
      return;
    }
    let userId = this.userId;
    if (!userId) {
      // Don't mark the room hydrated — a later call (once login completes)
      // must be free to try again.
      return;
    }
    let entries = this.localPersistenceService.getPendingSends(roomId);
    if (entries.length === 0) {
      this.hydratedPendingSendRooms.add(roomId);
      return;
    }
    this.hydratedPendingSendRooms.add(roomId);
    for (let entry of entries) {
      // Any entry persisted as 'sending' at hydration time is orphaned:
      // matrix-js-sdk has no live pending event for it (a fresh tab/session
      // has an empty in-memory queue), so nothing will ever reconcile it.
      // Flip it to 'not_sent' so the retry alert surfaces and canSend can
      // unblock once the user dismisses or retries.
      let effectiveStatus: PendingSendStatus =
        entry.status === 'sending' ? 'not_sent' : entry.status;
      let effectiveErrorMessage =
        effectiveStatus === 'not_sent'
          ? (entry.errorMessage ?? 'Send interrupted — retry')
          : entry.errorMessage;
      if (effectiveStatus !== entry.status) {
        this.localPersistenceService.updatePendingSendStatus(
          roomId,
          entry.clientGeneratedId,
          { status: effectiveStatus, errorMessage: effectiveErrorMessage },
        );
      }
      let event: TempEvent = {
        event_id: `local-${entry.clientGeneratedId}`,
        room_id: roomId,
        sender: userId,
        type: 'm.room.message',
        origin_server_ts: entry.createdAt || Date.now(),
        status: effectiveStatus as MatrixSDK.EventStatus,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          body: entry.body,
          format: 'org.matrix.custom.html',
          clientGeneratedId: entry.clientGeneratedId,
          ...(effectiveStatus === 'not_sent' && effectiveErrorMessage
            ? { errorMessage: effectiveErrorMessage }
            : {}),
          data: {
            attachedCards: entry.attachedCardIds.map((id) => ({
              sourceUrl: id,
              name: id.split('/').pop() ?? id,
              contentType: 'application/json',
            })),
            attachedFiles: entry.attachedFiles,
            context: { tools: [], functions: [] },
          },
        } as unknown as CardMessageContent,
      };
      void this.addRoomEvent(event);
    }
  }

  persistOptimisticSend(
    roomId: string,
    entry: {
      clientGeneratedId: string;
      body: string;
      attachedCardIds: string[];
      attachedFiles: ReturnType<FileDef['serialize']>[];
      createdAt: number;
    },
  ) {
    this.localPersistenceService.upsertPendingSend(roomId, {
      clientGeneratedId: entry.clientGeneratedId,
      body: entry.body,
      attachedCardIds: entry.attachedCardIds,
      attachedFiles: entry.attachedFiles.map(serializeFileForPersistence),
      createdAt: entry.createdAt,
      status: 'sending',
    });
  }

  // Look up matrix-js-sdk's view of an outgoing send by clientGeneratedId.
  // Used by doSendMessage's catch block to detect the inverse delivery race
  // (sendEvent succeeded server-side but a downstream throw escaped before the
  // local echo reconciled) — in that case the bubble must stay in 'sending'
  // and let matrix's reconciliation finish, not flash 'not_sent'.
  findPendingMatrixEventStatus(
    roomId: string,
    clientGeneratedId: string,
  ): MatrixSDK.EventStatus | null | undefined {
    let room = this.client.getRoom(roomId);
    if (!room) {
      return undefined;
    }
    // Optional-chained — the mock Room in tests doesn't implement
    // getPendingEvents. The real SDK Room always does.
    let pending = room.getPendingEvents?.() ?? [];
    let matches = pending.filter((e) => {
      let c = e.getContent() as { clientGeneratedId?: string };
      return c?.clientGeneratedId === clientGeneratedId;
    });
    if (matches.length > 0) {
      return matches[matches.length - 1].status ?? null;
    }
    // Not in the SDK's pending list — could be already-sent or never-attempted.
    let live = room
      .getLiveTimeline()
      .getEvents()
      .filter((e) => {
        let c = e.getContent() as { clientGeneratedId?: string };
        return c?.clientGeneratedId === clientGeneratedId;
      });
    if (live.length > 0) {
      return live[live.length - 1].status ?? null;
    }
    return undefined;
  }

  async getPromptParts(roomId: string) {
    const roomResource = this.roomResourcesCache.get(roomId);
    if (!roomResource) {
      throw new Error(`Room ${roomId} not found`);
    }

    const events = roomResource.events;
    if (!events || events.length === 0) {
      throw new Error('No events found in the current room to summarize');
    }

    const promptParts = await getPromptParts(
      events,
      this.aiBotUserId,
      this.client as unknown as MatrixClient,
    );

    return promptParts;
  }
}

async function getStorage() {
  let storage;

  try {
    // Chrome requires finer-grained permissions requests
    // @ts-expect-error our Typescript version doesn’t know about this API
    if (document['requestStorageAccessFor']) {
      let requestOptions = {
        localStorage: true,
      };

      storage = // @ts-expect-error nor about passing options and getting a handle back
        (await document.requestStorageAccess(requestOptions)).localStorage;
    } else {
      await document.requestStorageAccess();
      storage = window.localStorage;
    }
  } catch (e) {
    console.error('Error accessing storage', e);
    storage = window.localStorage;
  }

  return storage;
}

function serializeFileForPersistence(
  f: ReturnType<FileDef['serialize']>,
): StoredPendingFile {
  // Conditional spreads avoid emitting `{ name: undefined }` keys, which
  // matters under exactOptionalPropertyTypes — see sanitizePendingFile in
  // local-persistence-service.ts for the symmetric reader.
  return {
    sourceUrl: f.sourceUrl,
    ...(f.name ? { name: f.name } : {}),
    ...(f.url ? { url: f.url } : {}),
    ...(f.contentType ? { contentType: f.contentType } : {}),
    ...(f.contentHash ? { contentHash: f.contentHash } : {}),
    ...(typeof f.contentSize === 'number'
      ? { contentSize: f.contentSize }
      : {}),
  } as StoredPendingFile;
}

declare module '@ember/service' {
  interface Registry {
    'matrix-service': MatrixService;
  }
}
