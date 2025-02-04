import type Owner from '@ember/owner';
import type RouterService from '@ember/routing/router-service';
import { debounce } from '@ember/runloop';
import Service, { service } from '@ember/service';
import { cached, tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';
import window from 'ember-window-mock';
import { cloneDeep } from 'lodash';
import {
  type LoginResponse,
  type MatrixEvent,
  type RoomMember,
  type EmittedEvents,
  type ISendEventResponse,
} from 'matrix-js-sdk';
import stringify from 'safe-stable-stringify';
import { md5 } from 'super-fast-md5';
import { TrackedMap } from 'tracked-built-ins';
import { v4 as uuidv4 } from 'uuid';

import {
  type LooseSingleCardDocument,
  markdownToHtml,
  splitStringIntoChunks,
  baseRealm,
  LooseCardResource,
  ResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  basicMappings,
  generateJsonSchemaForCardType,
  getSearchTool,
  getPatchTool,
} from '@cardstack/runtime-common/helpers/ai';

import { getMatrixUsername } from '@cardstack/runtime-common/matrix-client';

import {
  APP_BOXEL_CARD_FORMAT,
  APP_BOXEL_CARDFRAGMENT_MSGTYPE,
  APP_BOXEL_COMMAND_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE,
  APP_BOXEL_REALMS_EVENT_TYPE,
  APP_BOXEL_ACTIVE_LLM,
  LEGACY_APP_BOXEL_REALMS_EVENT_TYPE,
  DEFAULT_LLM_LIST,
} from '@cardstack/runtime-common/matrix-constants';

import {
  type Submode,
  Submodes,
} from '@cardstack/host/components/submode-switcher';
import ENV from '@cardstack/host/config/environment';

import Room, { TempEvent } from '@cardstack/host/lib/matrix-classes/room';
import { getRandomBackgroundURL, iconURLFor } from '@cardstack/host/lib/utils';
import { getMatrixProfile } from '@cardstack/host/resources/matrix-profile';

import type { Base64ImageField as Base64ImageFieldType } from 'https://cardstack.com/base/base64-image';
import { BaseDef, type CardDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type {
  CardMessageContent,
  CardFragmentContent,
  MatrixEvent as DiscreteMatrixEvent,
  CommandResultWithNoOutputContent,
  CommandResultWithOutputContent,
} from 'https://cardstack.com/base/matrix-event';

import type { Tool } from 'https://cardstack.com/base/matrix-event';
import { SkillCard } from 'https://cardstack.com/base/skill-card';

import { importResource } from '../resources/import';

import { RoomResource, getRoom } from '../resources/room';

import { CurrentRoomIdPersistenceKey } from '../utils/local-storage-keys';

import { type SerializedState as OperatorModeSerializedState } from './operator-mode-state-service';

import type CardService from './card-service';
import type CommandService from './command-service';
import type LoaderService from './loader-service';
import type MatrixSDKLoader from './matrix-sdk-loader';
import type { ExtendedClient, ExtendedMatrixSDK } from './matrix-sdk-loader';
import type RealmService from './realm';
import type RealmServerService from './realm-server';
import type ResetService from './reset';

import type * as MatrixSDK from 'matrix-js-sdk';

const { matrixURL } = ENV;
const MAX_CARD_SIZE_KB = 60;
const STATE_EVENTS_OF_INTEREST = ['m.room.create', 'm.room.name'];
const DefaultSkillCards = [`${baseRealm.url}SkillCard/card-editing`];

export type OperatorModeContext = {
  submode: Submode;
  openCardIds: string[];
};

export default class MatrixService extends Service {
  @service private declare loaderService: LoaderService;
  @service private declare cardService: CardService;
  @service private declare commandService: CommandService;
  @service private declare realm: RealmService;
  @service private declare matrixSdkLoader: MatrixSDKLoader;
  @service private declare realmServer: RealmServerService;
  @service private declare router: RouterService;
  @service private declare reset: ResetService;
  @tracked private _client: ExtendedClient | undefined;
  @tracked private _isInitializingNewUser = false;
  @tracked private _isNewUser = false;
  @tracked private postLoginCompleted = false;
  @tracked private _currentRoomId: string | undefined;

  profile = getMatrixProfile(this, () => this.userId);

  private roomDataMap: TrackedMap<string, Room> = new TrackedMap();

  roomResourcesCache: TrackedMap<string, RoomResource> = new TrackedMap();
  messagesToSend: TrackedMap<string, string | undefined> = new TrackedMap();
  cardsToSend: TrackedMap<string, CardDef[] | undefined> = new TrackedMap();
  failedCommandState: TrackedMap<string, Error> = new TrackedMap();
  flushTimeline: Promise<void> | undefined;
  flushMembership: Promise<void> | undefined;
  flushRoomState: Promise<void> | undefined;
  private roomMembershipQueue: { event: MatrixEvent; member: RoomMember }[] =
    [];
  private timelineQueue: { event: MatrixEvent; oldEventId?: string }[] = [];
  private roomStateQueue: MatrixSDK.RoomState[] = [];
  #ready: Promise<void>;
  #matrixSDK: ExtendedMatrixSDK | undefined;
  #eventBindings: [EmittedEvents, (...arg: any[]) => void][] | undefined;
  currentUserEventReadReceipts: TrackedMap<string, { readAt: Date }> =
    new TrackedMap();
  private cardHashes: Map<string, string> = new Map(); // hashes <> event id
  private skillCardHashes: Map<string, string> = new Map(); // hashes <> event id

  constructor(owner: Owner) {
    super(owner);
    this.#ready = this.loadState.perform();
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
      window.localStorage.setItem(CurrentRoomIdPersistenceKey, value);
    } else {
      window.localStorage.removeItem(CurrentRoomIdPersistenceKey);
    }
  }

  get ready() {
    return this.#ready;
  }

  private cardAPIModule = importResource(
    this,
    () => 'https://cardstack.com/base/card-api',
  );

  private loadState = task(async () => {
    await this.loadSDK();
  });

  private async loadSDK() {
    await this.cardAPIModule.loaded;
    // The matrix SDK is VERY big so we only load it when we need it
    this.#matrixSDK = await this.matrixSdkLoader.load();
    this._client = this.matrixSDK.createClient({
      baseUrl: matrixURL,
    });

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
          if (e.event.type == APP_BOXEL_REALMS_EVENT_TYPE) {
            await this.realmServer.setAvailableRealmURLs(
              e.event.content.realms,
            );
            await this.loginToRealms();
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

  get userName() {
    return this.userId ? getMatrixUsername(this.userId) : null;
  }

  private get cardAPI() {
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
      clearAuth();
      this.postLoginCompleted = false;
      this.reset.resetAll();
      this.unbindEventListeners();
      await this.client.logout(true);
      // when user logs out we transition them back to an empty stack with the
      // workspace chooser open. this way we don't inadvertently leak private
      // card id's in the URL
      this.router.transitionTo('index', {
        queryParams: {
          workspaceChooserOpened: 'true',
          operatorModeState: stringify({
            stacks: [],
            submode: Submodes.Interact,
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

  get isNewUser() {
    return this._isNewUser;
  }

  async initializeNewUser(
    auth: LoginResponse,
    displayName: string,
    registrationToken?: string,
  ) {
    displayName = displayName.trim();
    this._isInitializingNewUser = true;
    this.start({ auth });
    this.setDisplayName(displayName);
    let userId = this.client.getUserId();
    if (!userId) {
      throw new Error(
        `bug: there is no userId associated with the matrix client`,
      );
    }

    await this.realmServer.createUser(userId, registrationToken);

    await Promise.all([
      this.createPersonalRealmForUser({
        endpoint: 'personal',
        name: `${displayName}'s Workspace`,
        iconURL: iconURLFor(displayName),
        backgroundURL: getRandomBackgroundURL(),
      }),
      this.realmServer.fetchCatalogRealms(),
    ]);
    this._isNewUser = true;
    this._isInitializingNewUser = false;
  }

  public async createPersonalRealmForUser({
    endpoint,
    name,
    iconURL,
    backgroundURL,
    copyFromSeedRealm,
  }: {
    endpoint: string;
    name: string;
    iconURL?: string;
    backgroundURL?: string;
    copyFromSeedRealm?: boolean;
  }) {
    let personalRealmURL = await this.realmServer.createRealm({
      endpoint,
      name,
      iconURL,
      backgroundURL,
      copyFromSeedRealm,
    });
    let { realms = [] } =
      (await this.client.getAccountDataFromServer<{ realms: string[] }>(
        APP_BOXEL_REALMS_EVENT_TYPE,
      )) ?? {};
    realms.push(personalRealmURL.href);
    await this.client.setAccountData(APP_BOXEL_REALMS_EVENT_TYPE, { realms });
    await this.realmServer.setAvailableRealmURLs(realms);
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
    let { auth, refreshRoutes } = opts;
    if (!auth) {
      auth = getAuth();
      if (!auth) {
        return;
      }
    }

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
    if (this.client.isLoggedIn()) {
      this.realmServer.setClient(this.client);
      saveAuth(auth);
      this.bindEventListeners();

      try {
        await this._client.startClient();
        let accountDataContent = await this._client.getAccountDataFromServer<{
          realms: string[];
        }>(APP_BOXEL_REALMS_EVENT_TYPE);
        // TODO: remove this once we've migrated all users
        // TEMPORARY MIGRATION CODE
        if (!accountDataContent?.realms?.length) {
          console.log(
            'You currently have no realms set, checking your old realms',
          );
          try {
            accountDataContent = await this._client.getAccountDataFromServer<{
              realms: string[];
            }>(LEGACY_APP_BOXEL_REALMS_EVENT_TYPE);
          } catch (e) {
            // throws if nothing at this key
          }
          if (accountDataContent?.realms) {
            console.log('Migrating your old realms to the new format');
            await this._client.setAccountData(APP_BOXEL_REALMS_EVENT_TYPE, {
              realms: accountDataContent.realms,
            });
            console.log('Removing your old realms data');
            await this._client.setAccountData(
              LEGACY_APP_BOXEL_REALMS_EVENT_TYPE,
              {},
            );
          } else {
            console.log('No old realms found');
          }
        }
        // END OF TEMPORARY MIGRATION CODE
        await this.realmServer.setAvailableRealmURLs(
          accountDataContent?.realms ?? [],
        );
        await Promise.all([
          this.loginToRealms(),
          this.realmServer.fetchCatalogRealms(),
        ]);
        this.postLoginCompleted = true;
      } catch (e) {
        console.log('Error starting Matrix client', e);
        await this.logout();
      }

      if (refreshRoutes) {
        await this.router.refresh();
      }
    }
  }

  private async loginToRealms() {
    // This is where we would actually load user-specific choices out of the
    // user's profile based on this.client.getUserId();
    let activeRealms = this.realmServer.availableRealmURLs;

    await Promise.all(
      activeRealms.map(async (realmURL) => {
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
    return this.client.createRealmSession(realmURL);
  }

  async sendEvent(
    roomId: string,
    eventType: string,
    content:
      | CardMessageContent
      | CardFragmentContent
      | CommandResultWithNoOutputContent
      | CommandResultWithOutputContent,
  ) {
    let roomData = await this.ensureRoomData(roomId);
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

  async sendCommandResultEvent(
    roomId: string,
    invokedToolFromEventId: string,
    resultCard?: CardDef,
  ) {
    let resultCardEventId: string | undefined;
    if (resultCard) {
      [resultCardEventId] = await this.addCardsToRoom([resultCard], roomId);
    }
    let content:
      | CommandResultWithNoOutputContent
      | CommandResultWithOutputContent;
    if (resultCardEventId === undefined) {
      content = {
        msgtype: APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
        'm.relates_to': {
          event_id: invokedToolFromEventId,
          key: 'applied',
          rel_type: 'm.annotation',
        },
      };
    } else {
      content = {
        msgtype: APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
        'm.relates_to': {
          event_id: invokedToolFromEventId,
          key: 'applied',
          rel_type: 'm.annotation',
        },
        data: {
          cardEventId: resultCardEventId,
        },
      };
    }
    try {
      return await this.sendEvent(
        roomId,
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

  async addSkillCardsToRoomHistory(
    skills: SkillCard[],
    roomId: string,
    opts?: CardAPI.SerializeOpts,
  ): Promise<string[]> {
    return this.addCardsToRoom(skills, roomId, this.skillCardHashes, opts);
  }

  async addCardsToRoom(
    cards: CardDef[],
    roomId: string,
    cardHashes: Map<string, string> = this.cardHashes,
    opts: CardAPI.SerializeOpts = { maybeRelativeURL: null },
  ): Promise<string[]> {
    if (!cards.length) {
      return [];
    }
    let serializedCards = await Promise.all(
      cards.map(async (card) => {
        let { Base64ImageField } = await this.loaderService.loader.import<{
          Base64ImageField: typeof Base64ImageFieldType;
        }>(`${baseRealm.url}base64-image`);
        return await this.cardService.serializeCard(card, {
          omitFields: [Base64ImageField],
          ...opts,
        });
      }),
    );

    let eventIds: string[] = [];
    if (serializedCards.length) {
      for (let card of serializedCards) {
        let eventId = cardHashes.get(this.generateCardHashKey(roomId, card));
        if (eventId === undefined) {
          let responses = await this.sendCardFragments(roomId, card);
          eventId = responses[0].event_id; // we only care about the first fragment
          cardHashes.set(this.generateCardHashKey(roomId, card), eventId);
        }
        eventIds.push(eventId);
      }
    }
    return eventIds;
  }

  async sendMessage(
    roomId: string,
    body: string | undefined,
    attachedCards: CardDef[] = [],
    clientGeneratedId = uuidv4(),
    context?: OperatorModeContext,
  ): Promise<void> {
    let html = markdownToHtml(body);
    let tools: Tool[] = [getSearchTool()];
    let attachedOpenCards: CardDef[] = [];
    let submode = context?.submode;
    if (submode === 'interact') {
      let mappings = await basicMappings(this.loaderService.loader);
      // Open cards are attached automatically
      // If they are not attached, the user is not allowing us to
      // modify them
      attachedOpenCards = attachedCards.filter((c) =>
        (context?.openCardIds ?? []).includes(c.id),
      );
      // Generate tool calls for patching currently open cards permitted for modification
      for (let attachedOpenCard of attachedOpenCards) {
        let patchSpec = generateJsonSchemaForCardType(
          attachedOpenCard.constructor as typeof CardDef,
          this.cardAPI,
          mappings,
        );
        if (this.realm.canWrite(attachedOpenCard.id)) {
          tools.push(getPatchTool(attachedOpenCard.id, patchSpec));
        }
      }
    }

    let attachedCardsEventIds = await this.addCardsToRoom(
      attachedCards,
      roomId,
    );

    await this.sendEvent(roomId, 'm.room.message', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: body || '',
      format: 'org.matrix.custom.html',
      formatted_body: html,
      clientGeneratedId,
      data: {
        attachedCardsEventIds,
        context: {
          openCardIds: attachedOpenCards.map((c) => c.id),
          tools,
          submode,
        },
      },
    } as CardMessageContent);
  }

  private generateCardHashKey(roomId: string, card: LooseSingleCardDocument) {
    return md5(roomId + JSON.stringify(card));
  }

  private async sendCardFragments(
    roomId: string,
    card: LooseSingleCardDocument,
  ): Promise<ISendEventResponse[]> {
    let fragments = splitStringIntoChunks(
      JSON.stringify(card),
      MAX_CARD_SIZE_KB,
    );
    let responses: ISendEventResponse[] = [];
    for (let index = fragments.length - 1; index >= 0; index--) {
      let cardFragment = fragments[index];
      let response = await this.sendEvent(roomId, 'm.room.message', {
        msgtype: APP_BOXEL_CARDFRAGMENT_MSGTYPE,
        format: APP_BOXEL_CARD_FORMAT,
        body: `card fragment ${index + 1} of ${fragments.length}`,
        formatted_body: `card fragment ${index + 1} of ${fragments.length}`,
        data: {
          ...(index < fragments.length - 1
            ? { nextFragment: responses[0].event_id }
            : {}),
          cardFragment,
          index,
          totalParts: fragments.length,
        },
      } as CardFragmentContent);
      responses.unshift(response);
    }
    return responses;
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

  async loadDefaultSkills() {
    return await Promise.all(
      DefaultSkillCards.map(async (skillCardURL) => {
        return await this.cardService.getCard<SkillCard>(skillCardURL);
      }),
    );
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
    this.cardHashes = new Map();
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
    return this.client.createRoom(opts);
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
    let roomData = await this.ensureRoomData(roomId);
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
    let roomData = await this.ensureRoomData(roomId);
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
    let roomData = await this.ensureRoomData(roomId);
    await roomData.mutex.dispatch(async () => {
      let currentContent = await this.getStateEventSafe(
        roomId,
        eventType,
        stateKey,
      );
      let newContent = await transformContent(currentContent ?? {});
      return this.client.sendStateEvent(
        roomId,
        eventType,
        newContent,
        stateKey,
      );
    });
  }

  async leave(roomId: string) {
    let roomData = await this.ensureRoomData(roomId);
    await roomData.mutex.dispatch(async () => {
      return this.client.leave(roomId);
    });
  }

  async forget(roomId: string) {
    let roomData = await this.ensureRoomData(roomId);
    await roomData.mutex.dispatch(async () => {
      return this.client.forget(roomId);
    });
  }

  async setRoomName(roomId: string, name: string) {
    let roomData = await this.ensureRoomData(roomId);
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

  async sendReadReceipt(matrixEvent: MatrixEvent) {
    return await this.client.sendReadReceipt(matrixEvent);
  }

  async isUsernameAvailable(username: string) {
    return await this.client.isUsernameAvailable(username);
  }

  async getRoomState(roomId: string) {
    return this.client
      .getRoom(roomId)
      ?.getLiveTimeline()
      .getState('f' as MatrixSDK.Direction);
  }

  async sendActiveLLMEvent(roomId: string, model: string) {
    await this.client.sendStateEvent(roomId, APP_BOXEL_ACTIVE_LLM, {
      model,
    });
  }

  private async addRoomEvent(event: TempEvent, oldEventId?: string) {
    let { room_id: roomId } = event;

    if (!roomId) {
      throw new Error(
        `bug: roomId is undefined for event ${JSON.stringify(event, null, 2)}`,
      );
    }
    let roomData = await this.ensureRoomData(roomId);
    roomData.addEvent(event, oldEventId);
  }

  private async ensureRoomData(roomId: string) {
    let roomData = this.getRoomData(roomId);
    if (!roomData) {
      roomData = new Room(roomId);
      let rs = await this.getRoomState(roomId);
      if (rs) {
        roomData.notifyRoomStateUpdated(rs);
      }
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
      let roomData = await this.ensureRoomData(rs.roomId);
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

  private async ensureCardFragmentsLoaded(cardEventId: string, roomData: Room) {
    let currentFragmentId: string | undefined = cardEventId;
    do {
      let fragmentEvent = roomData.events.find(
        (e: DiscreteMatrixEvent) => e.event_id === currentFragmentId,
      );
      let fragmentData: CardFragmentContent['data'];
      if (!fragmentEvent) {
        fragmentEvent = (await this.client?.fetchRoomEvent(
          roomData.roomId,
          currentFragmentId ?? '',
        )) as DiscreteMatrixEvent;
        if (
          fragmentEvent.type !== 'm.room.message' ||
          fragmentEvent.content.msgtype !== APP_BOXEL_CARDFRAGMENT_MSGTYPE
        ) {
          throw new Error(
            `Expected event ${currentFragmentId} to be ${APP_BOXEL_CARDFRAGMENT_MSGTYPE} but was ${JSON.stringify(
              fragmentEvent,
            )}`,
          );
        }
        await this.addRoomEvent({
          ...fragmentEvent,
        });
        fragmentData = (
          typeof fragmentEvent.content.data === 'string'
            ? JSON.parse((fragmentEvent.content as any).data)
            : fragmentEvent.content.data
        ) as CardFragmentContent['data'];
      } else {
        if (
          fragmentEvent.type !== 'm.room.message' ||
          fragmentEvent.content.msgtype !== APP_BOXEL_CARDFRAGMENT_MSGTYPE
        ) {
          throw new Error(
            `Expected event to be '${APP_BOXEL_CARDFRAGMENT_MSGTYPE}' but was ${JSON.stringify(
              fragmentEvent,
            )}`,
          );
        }
        fragmentData = fragmentEvent.content.data;
      }
      currentFragmentId = fragmentData?.nextFragment; // using '?' so we can be kind to older event schemas
    } while (currentFragmentId);
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

    let roomData = await this.getRoomData(roomId);
    // patch in any missing room events--this will support dealing with local
    // echoes, migrating older histories as well as handle any matrix syncing gaps
    // that might occur
    if (
      roomData &&
      event.type === 'm.room.message' &&
      event.content?.msgtype === APP_BOXEL_MESSAGE_MSGTYPE &&
      event.content.data
    ) {
      let data = (
        typeof event.content.data === 'string'
          ? JSON.parse(event.content.data)
          : event.content.data
      ) as CardMessageContent['data'];
      if (
        'attachedCardsEventIds' in data &&
        Array.isArray(data.attachedCardsEventIds)
      ) {
        for (let attachedCardEventId of data.attachedCardsEventIds) {
          await this.ensureCardFragmentsLoaded(attachedCardEventId, roomData);
        }
      }
    } else if (
      roomData &&
      event.type === APP_BOXEL_COMMAND_RESULT_EVENT_TYPE &&
      event.content?.msgtype === APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE
    ) {
      let data = (
        typeof event.content.data === 'string'
          ? JSON.parse(event.content.data)
          : event.content.data
      ) as CommandResultWithOutputContent['data'];
      await this.ensureCardFragmentsLoaded(data.cardEventId, roomData);
    } else if (
      event.type === 'm.room.message' &&
      event.content?.msgtype === APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE
    ) {
      await this.realmServer.handleEvent(event);
    }
    await this.addRoomEvent(event, oldEventId);

    if (
      event.type === 'm.room.message' &&
      event.content?.msgtype === APP_BOXEL_COMMAND_MSGTYPE
    ) {
      this.commandService.executeCommandEventIfNeeded(event);
    }

    if (room.oldState.paginationToken != null) {
      // we need to scroll back to capture any room events fired before this one
      await this.client?.scrollback(room);
    }
  }

  async setLLMModelForCodeMode() {
    this.setLLMModel('anthropic/claude-3.5-sonnet');
  }

  private async setLLMModel(model: string) {
    if (!DEFAULT_LLM_LIST.includes(model)) {
      throw new Error(`Cannot find LLM model: ${model}`);
    }
    if (!this.currentRoomId) {
      return;
    }
    let roomResource = this.roomResources.get(this.currentRoomId);
    if (!roomResource) {
      return;
    }
    await roomResource.loading;
    roomResource.activateLLM(model);
  }
}

function saveAuth(auth: LoginResponse) {
  window.localStorage.setItem('auth', JSON.stringify(auth));
}

function clearAuth() {
  window.localStorage.removeItem('auth');
  window.localStorage.removeItem(CurrentRoomIdPersistenceKey);
}

function getAuth(): LoginResponse | undefined {
  let auth = window.localStorage.getItem('auth');
  if (!auth) {
    return;
  }
  return JSON.parse(auth) as LoginResponse;
}
