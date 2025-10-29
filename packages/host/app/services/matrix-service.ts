import Owner, { getOwner } from '@ember/owner';
import type RouterService from '@ember/routing/router-service';
import { debounce } from '@ember/runloop';
import Service, { service } from '@ember/service';
import { isTesting } from '@embroider/macros';
import { cached, tracked } from '@glimmer/tracking';

import { dropTask, task, timeout } from 'ember-concurrency';
import window from 'ember-window-mock';
import { cloneDeep } from 'lodash';
import {
  type LoginResponse,
  type MatrixEvent,
  type RoomMember,
  type EmittedEvents,
} from 'matrix-js-sdk';
import { MatrixClient } from 'matrix-js-sdk';
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

import {
  aiBotUsername,
  LooseCardResource,
  logger,
  ResolvedCodeRef,
  isCardInstance,
  Deferred,
  SEARCH_MARKER,
  REPLACE_MARKER,
  SEPARATOR_MARKER,
  isCardErrorJSONAPI,
} from '@cardstack/runtime-common';

import { getPromptParts } from '@cardstack/runtime-common/ai';
import { getMatrixUsername } from '@cardstack/runtime-common/matrix-client';

import {
  APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
  APP_BOXEL_CODE_PATCH_RESULT_MSGTYPE,
  APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_REL_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_REALM_EVENT_TYPE,
  APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE,
  APP_BOXEL_REALMS_EVENT_TYPE,
  APP_BOXEL_ACTIVE_LLM,
  APP_BOXEL_LLM_MODE,
  DEFAULT_CODING_LLM,
  DEFAULT_LLM,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  APP_BOXEL_STOP_GENERATING_EVENT_TYPE,
  SLIDING_SYNC_AI_ROOM_LIST_NAME,
  SLIDING_SYNC_AUTH_ROOM_LIST_NAME,
  SLIDING_SYNC_LIST_RANGE_END,
  SLIDING_SYNC_LIST_TIMELINE_LIMIT,
  SLIDING_SYNC_TIMEOUT,
  type LLMMode,
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_SYSTEM_CARD_EVENT_TYPE,
} from '@cardstack/runtime-common/matrix-constants';

import {
  type Submode,
  Submodes,
} from '@cardstack/host/components/submode-switcher';
import ENV from '@cardstack/host/config/environment';

import type IndexController from '@cardstack/host/controllers/index';

import Room, { TempEvent } from '@cardstack/host/lib/matrix-classes/room';
import { getRandomBackgroundURL, iconURLFor } from '@cardstack/host/lib/utils';
import { getMatrixProfile } from '@cardstack/host/resources/matrix-profile';

import type { BaseDef, CardDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import {
  CardForAttachmentCard,
  FileForAttachmentCard,
} from 'https://cardstack.com/base/command';
import type * as FileAPI from 'https://cardstack.com/base/file-api';
import { type FileDef } from 'https://cardstack.com/base/file-api';
import type {
  BoxelContext,
  CardMessageContent,
  MatrixEvent as DiscreteMatrixEvent,
  CodePatchResultContent,
  CodePatchStatus,
  CommandResultWithNoOutputContent,
  CommandResultWithOutputContent,
  RealmEventContent,
  Tool,
  CommandResultStatus,
} from 'https://cardstack.com/base/matrix-event';

import type * as SkillModule from 'https://cardstack.com/base/skill';
import type { SystemCard } from 'https://cardstack.com/base/system-card';

import AddSkillsToRoomCommand from '../commands/add-skills-to-room';
import { addPatchTools } from '../commands/utils';
import { isSkillCard } from '../lib/file-def-manager';
import { skillCardURL } from '../lib/utils';
import { importResource } from '../resources/import';

import { RoomResource, getRoom } from '../resources/room';

import { clearLocalStorage } from '../utils/local-storage-keys';

import { type SerializedState as OperatorModeSerializedState } from './operator-mode-state-service';

import type CardService from './card-service';
import type CommandService from './command-service';
import type LoaderService from './loader-service';
import type LocalPersistenceService from './local-persistence-service';
import type LoggerService from './logger-service';
import type MatrixSDKLoader from './matrix-sdk-loader';
import type { ExtendedClient, ExtendedMatrixSDK } from './matrix-sdk-loader';
import type MessageService from './message-service';
import type NetworkService from './network';
import type RealmService from './realm';
import type RealmServerService from './realm-server';
import type ResetService from './reset';
import type StoreService from './store';

import type * as MatrixSDK from 'matrix-js-sdk';

const { matrixURL } = ENV;
const STATE_EVENTS_OF_INTEREST = ['m.room.create', 'm.room.name'];

const realmEventsLogger = logger('realm:events');

export default class MatrixService extends Service {
  @service declare private loaderService: LoaderService;
  @service declare private loggerService: LoggerService;
  @service declare private cardService: CardService;
  @service declare private commandService: CommandService;
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
  @tracked private _currentRoomId: string | undefined;
  @tracked private timelineLoadingState: Map<string, boolean> =
    new TrackedMap();

  @tracked private storage: Storage | undefined;

  profile = getMatrixProfile(this, () => this.userId);

  private roomDataMap: TrackedMap<string, Room> = new TrackedMap();
  private startedAtTs = -1;

  // TODO This seems very bad. we should not be sharing Resources with anyone that
  // wants one--resources are tied to the lifetime of their owner, who knows
  // which owner made these and who is consuming these. we need to refactor this out..
  roomResourcesCache: TrackedMap<string, RoomResource> = new TrackedMap();
  messagesToSend: TrackedMap<string, string | undefined> = new TrackedMap();
  cardsToSend: TrackedMap<string, string[] | undefined> = new TrackedMap();
  filesToSend: TrackedMap<string, FileDef[] | undefined> = new TrackedMap();
  failedCommandState: TrackedMap<string, Error> = new TrackedMap();
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
  @tracked private _isLoadingMoreAIRooms = false;
  private initialSyncCompleted = false;
  private initialSyncCompletedDeferred = new Deferred<void>();
  private roomsWaitingForSync: Map<string, Deferred<void>> = new Map();
  @tracked private _systemCard: SystemCard | undefined;
  agentId: string | undefined;

  constructor(owner: Owner) {
    super(owner);
    this.setLoggerLevelFromEnvironment();
    this.setAgentId();
    this.#ready = this.loadState.perform();
  }

  setMessageToSend(roomId: string, message: string | undefined) {
    if (message === undefined) {
      this.messagesToSend.delete(roomId);
    } else {
      this.messagesToSend.set(roomId, message);
    }
    this.localPersistenceService.setMessageDraft(roomId, message);
  }

  getMessageToSend(roomId: string) {
    if (this.messagesToSend.has(roomId)) {
      return this.messagesToSend.get(roomId);
    }

    return this.localPersistenceService.getMessageDraft(roomId);
  }

  private setAgentId() {
    this.agentId = this.localPersistenceService.getAgentId();
  }

  private setLoggerLevelFromEnvironment() {
    // This will pick up the level if it's in LOG_LEVELS
    logger('matrix');
  }

  private addEventReadReceipt(eventId: string, receipt: { readAt: Date }) {
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
    await this.requestStorageAccess();
    await this.loadSDK();
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
            case APP_BOXEL_REALMS_EVENT_TYPE:
              await this.realmServer.setAvailableRealmURLs(
                e.event.content.realms,
              );
              await this.loginToRealms();
              await this.loadMoreAuthRooms(e.event.content.realms);
              break;
            case APP_BOXEL_SYSTEM_CARD_EVENT_TYPE:
              await this.setSystemCard(e.event.content.id);
              break;
          }
        },
      ],
    ];
  }

  get isLoggedIn() {
    return this.client.isLoggedIn() && this.postLoginCompleted;
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
    try {
      await this.flushAll;
      this.clearAuth();
      this.postLoginCompleted = false;
      this.reset.resetAll();
      this.unbindEventListeners();
      await this.client.logout(true);
      // when user logs out we transition them back to an empty stack with the
      // workspace chooser open. this way we don't inadvertently leak private
      // card id's in the URL
      this.router.transitionTo('index', {
        queryParams: {
          operatorModeState: stringify({
            stacks: [],
            submode: Submodes.Interact,
            workspaceChooserOpened: true,
          } as OperatorModeSerializedState),
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

    await this.realmServer.createUser(userId, registrationToken);

    await this.start({ auth });
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
    let { realms = [] } =
      ((await this.client.getAccountDataFromServer(
        APP_BOXEL_REALMS_EVENT_TYPE,
      )) as { realms: string[] }) ?? {};

    // Clone the account data instead of using it directly,
    // since mutating the original object would modify the Matrix client’s store
    // and prevent updates from being sent back to the server.
    let newRealms = [...realms, personalRealmURL.href];
    await this.client.setAccountData(APP_BOXEL_REALMS_EVENT_TYPE, {
      realms: newRealms,
    });
    await this.realmServer.setAvailableRealmURLs(newRealms);
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
    } = {},
  ) {
    await this.ready;

    let { auth, refreshRoutes } = opts;
    if (!auth) {
      auth = this.getAuth();
      if (!auth) {
        return;
      }
    }

    this.configureClientWithAuth(auth);

    if (this.client.isLoggedIn()) {
      this.realmServer.setClient(this.client);
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
        let accountDataContent = (await this.client.getAccountDataFromServer(
          APP_BOXEL_REALMS_EVENT_TYPE,
        )) as { realms: string[] } | null;

        let noRealmsLoggedIn = Array.from(this.realm.realms.entries()).every(
          ([_url, realmResource]) => !realmResource.isLoggedIn,
        );

        if (noRealmsLoggedIn) {
          // In this case we want to authenticate to all accessible realms in a single request,
          // for performance reasons (otherwise we would make 2 auth requests for
          // each realm, which could be a lot of requests).

          await this.realmServer.authenticateToAllAccessibleRealms();
        }

        await Promise.all([
          this.realmServer.fetchCatalogRealms(),
          this.realmServer.setAvailableRealmURLs(
            accountDataContent?.realms ?? [],
          ),
        ]);

        let systemCardAccountData = (await this.client.getAccountDataFromServer(
          APP_BOXEL_SYSTEM_CARD_EVENT_TYPE,
        )) as { id?: string } | null;

        await this.setSystemCard(systemCardAccountData?.id);

        await this.initSlidingSync(accountDataContent);
        await this.client.startClient({ slidingSync: this.slidingSync });

        this.postLoginCompleted = true;
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
    }
  }

  private async initSlidingSync(accountData?: { realms: string[] } | null) {
    let lists: Map<string, MSC3575List> = new Map();
    lists.set(SLIDING_SYNC_AI_ROOM_LIST_NAME, {
      ranges: [[0, SLIDING_SYNC_LIST_RANGE_END]],
      filters: {
        is_dm: false,
      },
      timeline_limit: SLIDING_SYNC_LIST_TIMELINE_LIMIT,
      required_state: [['*', '*']],
    });
    lists.set(SLIDING_SYNC_AUTH_ROOM_LIST_NAME, {
      ranges: [[0, accountData?.realms.length ?? SLIDING_SYNC_LIST_RANGE_END]],
      filters: {
        is_dm: true,
      },
      timeline_limit: SLIDING_SYNC_LIST_TIMELINE_LIMIT,
      required_state: [['*', '*']],
    });
    this.slidingSync = new this.matrixSdkLoader.SlidingSync(
      this.client.baseUrl,
      lists,
      {
        timeline_limit: SLIDING_SYNC_LIST_TIMELINE_LIMIT,
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
    let activeRealms = this.realmServer.availableRealmURLs;

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

  async createRealmSession(realmURL: URL) {
    await this.#clientReadyDeferred.promise;
    return this.client.createRealmSession(realmURL);
  }

  async sendEvent(
    roomId: string,
    eventType: string,
    content:
      | CardMessageContent
      | CodePatchResultContent
      | CommandResultWithNoOutputContent
      | CommandResultWithOutputContent,
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
  async updateSkillsAndCommandsIfNeeded(roomId: string) {
    await this.updateStateEvent(
      roomId,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
      '',
      async (currentSkillsConfig) => {
        let enabledSkillCardFileDefs =
          (currentSkillsConfig?.enabledSkillCards ??
            []) as FileAPI.SerializedFile[];
        let enabledCommandDefinitions: SkillModule.CommandField[] = [];
        let enabledSkillCards = (
          await Promise.all(
            enabledSkillCardFileDefs.map(async (fileDef) => {
              const card = await this.store.get<SkillModule.Skill>(
                fileDef.sourceUrl,
              );
              if (isSkillCard in card) {
                enabledCommandDefinitions = enabledCommandDefinitions.concat(
                  (card as SkillModule.Skill).commands ?? [],
                );
              }
              return card;
            }),
          )
        ).filter((card) => isSkillCard in card) as SkillModule.Skill[];
        let enabledSkillFileDefs = await this.uploadCards(
          enabledSkillCards as CardDef[],
        );
        // get the unique subset of enabledCommandDefinitions by functionName
        enabledCommandDefinitions = this.getUniqueCommandDefinitions(
          enabledCommandDefinitions,
        );
        let enabledCommandDefFileDefs = await this.uploadCommandDefinitions(
          enabledCommandDefinitions,
        );
        return {
          enabledSkillCards: enabledSkillFileDefs.map((fileDef) =>
            fileDef.serialize(),
          ),
          disabledSkillCards: currentSkillsConfig?.disabledSkillCards ?? [],
          commandDefinitions: enabledCommandDefFileDefs.map((fileDef) =>
            fileDef.serialize(),
          ),
        };
      },
    );
  }

  async downloadAsFileInBrowser(serializedFile: FileAPI.SerializedFile) {
    return await this.client.downloadAsFileInBrowser(serializedFile);
  }

  public getUniqueCommandDefinitions(
    commandDefinitions: SkillModule.CommandField[],
  ): SkillModule.CommandField[] {
    return commandDefinitions.filter(
      (command, index, self) =>
        index ===
        self.findIndex((c) => c.functionName === command.functionName),
    );
  }

  async uploadCards(cards: CardDef[]) {
    let cardFileDefs = await this.client.uploadCards(cards);
    return cardFileDefs;
  }

  async uploadCommandDefinitions(
    commandDefinitions: SkillModule.CommandField[],
  ) {
    let commandFileDefs =
      await this.client.uploadCommandDefinitions(commandDefinitions);
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

  async sendCommandResultEvent(params: {
    roomId: string;
    invokedToolFromEventId: string;
    toolCallId: string;
    status: CommandResultStatus;
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
    let content:
      | CommandResultWithNoOutputContent
      | CommandResultWithOutputContent;
    if (resultCardFileDef === undefined) {
      content = {
        msgtype: APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
        commandRequestId: params.toolCallId,
        failureReason: params.failureReason,
        'm.relates_to': {
          event_id: params.invokedToolFromEventId,
          key: params.status,
          rel_type: APP_BOXEL_COMMAND_RESULT_REL_TYPE,
        },
        data: contentData,
      };
    } else {
      content = {
        msgtype: APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
        'm.relates_to': {
          event_id: params.invokedToolFromEventId,
          key: params.status,
          rel_type: APP_BOXEL_COMMAND_RESULT_REL_TYPE,
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
        APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
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
    failureReason?: string | undefined,
  ) {
    let contentData = await this.withContextAndAttachments(
      context,
      attachedCards,
      attachedFiles,
    );
    let content: CodePatchResultContent = {
      msgtype: APP_BOXEL_CODE_PATCH_RESULT_MSGTYPE,
      codeBlockIndex,
      failureReason,
      'm.relates_to': {
        event_id: eventId,
        key: resultKey,
        rel_type: APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE,
      },
      data: contentData,
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

  async fetchMatrixHostedFile(matrixFileUrl: string) {
    let response = await fetch(matrixFileUrl, {
      headers: {
        Authorization: `Bearer ${this.client.getAccessToken()}`,
      },
    });
    return response;
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
        this.commandService.commandContext,
        patchableCards,
        this.cardAPI,
      ),
    );

    await this.updateSkillsAndCommandsIfNeeded(roomId);
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
    let uploadedFileDefs = await this.uploadFiles(attachedFiles);

    return {
      context,
      attachedCards: cardFileDefs.map((file: FileDef) => file.serialize()),
      attachedFiles: uploadedFileDefs.map((file: FileDef) => file.serialize()),
    };
  }

  getLastActiveTimestamp(roomId: string, defaultTimestamp: number) {
    let matrixRoom = this.client.getRoom(roomId);
    let lastMatrixEvent = matrixRoom?.getLastActiveTimestamp();
    return lastMatrixEvent ?? defaultTimestamp;
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
          () => this.getRoomData(roomId)?.events,
        ),
      );
    }
  }

  async loadDefaultSkills(submode: Submode) {
    let interactModeDefaultSkills = [skillCardURL('boxel-environment')];

    let codeModeDefaultSkills = [
      skillCardURL('boxel-environment'),
      skillCardURL('boxel-development'),
      skillCardURL('source-code-editing'),
    ];

    let defaultSkills;

    if (submode === 'code') {
      defaultSkills = codeModeDefaultSkills;
    } else {
      defaultSkills = interactModeDefaultSkills;
    }

    return (
      await Promise.all(
        defaultSkills.map(async (skillCardURL) => {
          let maybeCard = await this.store.get<SkillModule.Skill>(skillCardURL);
          return isCardInstance(maybeCard) ? maybeCard : undefined;
        }),
      )
    ).filter(Boolean) as SkillModule.Skill[];
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

  private resetState() {
    this.roomDataMap = new TrackedMap();
    this.roomMembershipQueue = [];
    this.roomStateQueue = [];
    this.roomResourcesCache.clear();
    this.timelineQueue = [];
    this.flushMembership = undefined;
    this.flushTimeline = undefined;
    this.flushRoomState = undefined;
    this.unbindEventListeners();
    this._client = this.matrixSDK.createClient({ baseUrl: matrixURL });
    this._currentRoomId = undefined;
    this.messagesToSend = new TrackedMap();
    this.cardsToSend = new TrackedMap();
    this.filesToSend = new TrackedMap();
    this.currentUserEventReadReceipts = new TrackedMap();

    // Reset it here rather than in the reset function of each service
    // because it is possible that
    // there are some services that are not initialized yet
    clearLocalStorage(this.storage);
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

  async sendActiveLLMEvent(roomId: string, model: string) {
    await this.client.sendStateEvent(roomId, APP_BOXEL_ACTIVE_LLM, {
      model,
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
            throw new Error(`bug: cannot get state events for room ${roomId}`);
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

    eventsDrained!();
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
    let events = [...this.timelineQueue];
    this.timelineQueue = [];
    for (let { event, oldEventId } of events) {
      await this.client?.decryptEventIfNeeded(event);
      await this.processDecryptedEvent(
        this.buildEventForProcessing(event),
        oldEventId,
      );
    }
    eventsDrained!();
  }

  private async processDecryptedEvent(event: TempEvent, oldEventId?: string) {
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
    await this.addRoomEvent(event, oldEventId);

    if (
      event.type === 'm.room.message' &&
      event.content?.[APP_BOXEL_COMMAND_REQUESTS_KEY]?.length &&
      event.content?.isStreamingFinished
    ) {
      this.commandService.queueEventForCommandProcessing(event);
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
        this.commandService.queueEventForCodePatchProcessing(event);
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

      let realmResourceForEvent = this.realm.realmForSessionRoomId(
        event.room_id!,
      );
      if (!realmResourceForEvent) {
        realmEventsLogger.debug(
          'Ignoring realm event because no realm found',
          event,
        );
      } else {
        if (realmResourceForEvent.info?.realmUserId !== event.sender) {
          realmEventsLogger.warn(
            `Realm event sender ${event.sender} is not the realm user ${realmResourceForEvent.info?.realmUserId}`,
            event,
          );
        }

        (event.content as any).origin_server_ts = event.origin_server_ts;
        this.messageService.relayRealmEvent(
          realmResourceForEvent.url,
          event.content as RealmEventContent,
        );
      }
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

    let addSkillsToRoomCommand = new AddSkillsToRoomCommand(
      this.commandService.commandContext,
    );
    await addSkillsToRoomCommand.execute({
      roomId: this.currentRoomId,
      skills: await this.loadDefaultSkills('code'),
    });
  }

  async setLLMForCodeMode() {
    return this.setLLMModel(DEFAULT_CODING_LLM);
  }

  async setLLMForInteractMode() {
    if (this.systemCard?.modelConfigurations?.length) {
      let preferredModel = this.systemCard.modelConfigurations[0].modelId;
      return this.setLLMModel(preferredModel);
    } else {
      return this.setLLMModel(DEFAULT_LLM);
    }
  }

  private async setLLMModel(model: string) {
    if (!this.currentRoomId) {
      return;
    }
    let roomResource = this.roomResources.get(this.currentRoomId);
    if (!roomResource) {
      return;
    }
    return roomResource.activateLLMTask.perform(model);
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

  private async setSystemCard(systemCardId: string | undefined) {
    // Set the system card to use
    // If there is none, we fall back to the default
    if (!systemCardId) {
      systemCardId = ENV.defaultSystemCardId;
    }
    if (systemCardId === this._systemCard?.id) {
      // it's OK to call this multiple times with the same system card id
      // we shouldn't do anything.
      return;
    }
    let systemCard = await this.store.get<SystemCard>(systemCardId);
    if (isCardErrorJSONAPI(systemCard)) {
      console.error('Error loading system card:', systemCard);
      return;
    }

    this.store.dropReference(this._systemCard?.id);
    this.store.addReference(systemCardId);
    this._systemCard = systemCard;
  }

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

declare module '@ember/service' {
  interface Registry {
    'matrix-service': MatrixService;
  }
}
