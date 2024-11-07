import type Owner from '@ember/owner';
import { getOwner } from '@ember/owner';
import type RouterService from '@ember/routing/router-service';
import { debounce } from '@ember/runloop';
import Service, { service } from '@ember/service';
import { cached, tracked } from '@glimmer/tracking';

import format from 'date-fns/format';

import { task } from 'ember-concurrency';
import window from 'ember-window-mock';
import {
  type LoginResponse,
  type MatrixEvent,
  type RoomMember,
  type EmittedEvents,
  type IEvent,
  type ISendEventResponse,
} from 'matrix-js-sdk';
import stringify from 'safe-stable-stringify';
import { md5 } from 'super-fast-md5';
import { TrackedMap, TrackedObject } from 'tracked-built-ins';
import { v4 as uuidv4 } from 'uuid';

import {
  type LooseSingleCardDocument,
  markdownToHtml,
  aiBotUsername,
  splitStringIntoChunks,
  baseRealm,
  loaderFor,
  LooseCardResource,
  ResolvedCodeRef,
  Command,
} from '@cardstack/runtime-common';
import {
  basicMappings,
  generateJsonSchemaForCardType,
  getSearchTool,
  getGenerateAppModuleTool,
} from '@cardstack/runtime-common/helpers/ai';

import { getPatchTool } from '@cardstack/runtime-common/helpers/ai';
import { getMatrixUsername } from '@cardstack/runtime-common/matrix-client';

import { currentRoomIdPersistenceKey } from '@cardstack/host/components/ai-assistant/panel';
import {
  type Submode,
  Submodes,
} from '@cardstack/host/components/submode-switcher';
import ENV from '@cardstack/host/config/environment';

import { RoomState } from '@cardstack/host/lib/matrix-classes/room';
import { getRandomBackgroundURL, iconURLFor } from '@cardstack/host/lib/utils';
import { getMatrixProfile } from '@cardstack/host/resources/matrix-profile';

import type { Base64ImageField as Base64ImageFieldType } from 'https://cardstack.com/base/base64-image';
import { BaseDef, type CardDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/matrix-event';
import type {
  CardMessageContent,
  CardFragmentContent,
  ReactionEventContent,
  CommandResultContent,
} from 'https://cardstack.com/base/matrix-event';

import { SkillCard } from 'https://cardstack.com/base/skill-card';

import { Skill } from '../components/ai-assistant/skill-menu';
import IndexController from '../controllers';
import { getCard } from '../resources/card-resource';
import { importResource } from '../resources/import';

import { RoomResource, getRoom } from '../resources/room';

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
const AI_BOT_POWER_LEVEL = 50; // this is required to set the room name
const MAX_CARD_SIZE_KB = 60;
const STATE_EVENTS_OF_INTEREST = ['m.room.create', 'm.room.name'];
const DefaultSkillCards = [`${baseRealm.url}SkillCard/card-editing`];

type TempEvent = Partial<IEvent> & {
  status: MatrixSDK.EventStatus | null;
  error?: MatrixSDK.MatrixError;
};

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
  @tracked private postLoginCompleted = false;

  profile = getMatrixProfile(this, () => this.client.getUserId());

  private rooms: TrackedMap<string, RoomState> = new TrackedMap();

  roomResourcesCache: TrackedMap<string, RoomResource> = new TrackedMap();
  messagesToSend: TrackedMap<string, string | undefined> = new TrackedMap();
  cardsToSend: TrackedMap<string, CardDef[] | undefined> = new TrackedMap();
  failedCommandState: TrackedMap<string, Error> = new TrackedMap();
  flushTimeline: Promise<void> | undefined;
  flushMembership: Promise<void> | undefined;
  private roomMembershipQueue: { event: MatrixEvent; member: RoomMember }[] =
    [];
  private timelineQueue: { event: MatrixEvent; oldEventId?: string }[] = [];
  #ready: Promise<void>;
  #matrixSDK: ExtendedMatrixSDK | undefined;
  #eventBindings: [EmittedEvents, (...arg: any[]) => void][] | undefined;
  currentUserEventReadReceipts: TrackedMap<string, { readAt: Date }> =
    new TrackedMap();
  private cardHashes: Map<string, string> = new Map(); // hashes <> event id
  private skillCardHashes: Map<string, string> = new Map(); // hashes <> event id
  private defaultSkills: Skill[] = [];

  constructor(owner: Owner) {
    super(owner);
    this.#ready = this.loadState.perform();
  }

  private addEventReadReceipt(eventId: string, receipt: { readAt: Date }) {
    this.currentUserEventReadReceipts.set(eventId, receipt);
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
      [
        this.matrixSDK.ClientEvent.AccountData,
        async (e) => {
          if (e.event.type == 'com.cardstack.boxel.realms') {
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

  get client() {
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

  async logout() {
    try {
      await this.flushMembership;
      await this.flushTimeline;
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

  async initializeNewUser(auth: LoginResponse, displayName: string) {
    displayName = displayName.trim();
    let controller = getOwner(this)!.lookup(
      'controller:index',
    ) as IndexController;
    controller.workspaceChooserOpened = true;
    this._isInitializingNewUser = true;
    this.start({ auth });
    this.setDisplayName(displayName);
    await this.createPersonalRealmForUser({
      endpoint: 'personal',
      name: `${displayName}'s Workspace`,
      iconURL: iconURLFor(displayName),
      backgroundURL: getRandomBackgroundURL(),
    });
    this._isInitializingNewUser = false;
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
      (await this.client.getAccountDataFromServer<{ realms: string[] }>(
        'com.cardstack.boxel.realms',
      )) ?? {};
    realms.push(personalRealmURL.href);
    await this.client.setAccountData('com.cardstack.boxel.realms', { realms });
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
        }>('com.cardstack.boxel.realms');
        await this.realmServer.setAvailableRealmURLs(
          accountDataContent?.realms ?? [],
        );
        await this.loginToRealms();
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

  async createRoom(
    name: string,
    invites: string[], // these can be local names
    topic?: string,
  ): Promise<string> {
    let userId = this.client.getUserId();
    if (!userId) {
      throw new Error(
        `bug: there is no userId associated with the matrix client`,
      );
    }
    let invite = invites.map((i) =>
      i.startsWith('@') ? i : `@${i}:${userId!.split(':')[1]}`,
    );
    let { room_id: roomId } = await this.client.createRoom({
      preset: this.matrixSDK.Preset.PrivateChat,
      invite,
      name,
      topic,
      room_alias_name: encodeURIComponent(
        `${name} - ${format(new Date(), "yyyy-MM-dd'T'HH:mm:ss.SSSxxx")} - ${
          this.userId
        }`,
      ),
    });
    invites.map((i) => {
      let fullId = i.startsWith('@') ? i : `@${i}:${userId!.split(':')[1]}`;
      if (i === aiBotUsername) {
        this.client.setPowerLevel(roomId, fullId, AI_BOT_POWER_LEVEL, null);
      }
    });
    return roomId;
  }

  private async sendEvent(
    roomId: string,
    eventType: string,
    content:
      | CardMessageContent
      | CardFragmentContent
      | ReactionEventContent
      | CommandResultContent,
  ) {
    if ('data' in content) {
      const encodedContent = {
        ...content,
        data: JSON.stringify(content.data),
      };
      return await this.client.sendEvent(roomId, eventType, encodedContent);
    } else {
      return await this.client.sendEvent(roomId, eventType, content);
    }
  }

  async sendReactionEvent(roomId: string, eventId: string, status: string) {
    let content: ReactionEventContent = {
      'm.relates_to': {
        event_id: eventId,
        key: status,
        rel_type: 'm.annotation',
      },
    };
    try {
      return await this.sendEvent(roomId, 'm.reaction', content);
    } catch (e) {
      throw new Error(
        `Error sending reaction event: ${
          'message' in (e as Error) ? (e as Error).message : e
        }`,
      );
    }
  }

  async sendCommandResultMessage(
    roomId: string,
    eventId: string,
    result: Record<string, any>,
  ) {
    let body = `Command Results from command event ${eventId}`;
    let html = markdownToHtml(body);
    let jsonStringResult = JSON.stringify(result);
    let content: CommandResultContent = {
      'm.relates_to': {
        event_id: eventId,
        rel_type: 'm.annotation',
        key: 'applied', //this is aggregated key. All annotations must have one. This identifies the reaction event.
      },
      body,
      formatted_body: html,
      msgtype: 'org.boxel.commandResult',
      result: jsonStringResult,
    };
    try {
      return await this.sendEvent(roomId, 'm.room.message', content);
    } catch (e) {
      throw new Error(
        `Error sending reaction event: ${
          'message' in (e as Error) ? (e as Error).message : e
        }`,
      );
    }
  }

  private async getCardEventIds(
    cards: CardDef[],
    roomId: string,
    cardHashes: Map<string, string>,
    opts?: CardAPI.SerializeOpts,
  ) {
    if (!cards.length) {
      return [];
    }
    let serializedCards = await Promise.all(
      cards.map(async (card) => {
        let { Base64ImageField } = await loaderFor(card).import<{
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
    skillCards: CardDef[] = [],
    clientGeneratedId = uuidv4(),
    context?: OperatorModeContext,
  ): Promise<void> {
    let html = markdownToHtml(body);
    let tools = [];
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
          tools.push(getSearchTool());
          tools.push(getGenerateAppModuleTool(attachedOpenCard.id));
        }
      }
    }

    let attachedCardsEventIds = await this.getCardEventIds(
      attachedCards,
      roomId,
      this.cardHashes,
      { maybeRelativeURL: null },
    );
    let attachedSkillEventIds = await this.getCardEventIds(
      skillCards,
      roomId,
      this.skillCardHashes,
      { includeComputeds: true, maybeRelativeURL: null },
    );

    await this.sendEvent(roomId, 'm.room.message', {
      msgtype: 'org.boxel.message',
      body: body || '',
      format: 'org.matrix.custom.html',
      formatted_body: html,
      clientGeneratedId,
      data: {
        attachedCardsEventIds,
        attachedSkillEventIds,
        context: {
          openCardIds: attachedOpenCards.map((c) => c.id),
          tools,
          submode,
        },
      },
    } as CardMessageContent);
  }

  public async sendAiAssistantMessage(params: {
    roomId?: string; // if falsy we create a new room
    show?: boolean; // if truthy, ensure the side panel to the room
    prompt: string;
    attachedCards?: CardDef[];
    skillCards?: SkillCard[];
    commands?: { command: Command<any, any, any>; autoExecute: boolean }[];
  }): Promise<{ roomId: string }> {
    let roomId = params.roomId;
    if (!roomId) {
      roomId = await this.createRoom('AI Assistant', [aiBotUsername]);
    }

    let html = markdownToHtml(params.prompt);
    let mappings = await basicMappings(this.loaderService.loader);
    let tools = [];
    for (let { command, autoExecute } of params.commands ?? []) {
      // get a registered name for the command
      let name = this.commandService.registerCommand(command, autoExecute);
      tools.push({
        type: 'function',
        function: {
          name,
          description: command.description,
          parameters: {
            type: 'object',
            properties: await command.getInputJsonSchema(
              this.cardAPI,
              mappings,
            ),
          },
        },
      });
    }

    let attachedCardsEventIds = await this.getCardEventIds(
      params.attachedCards ?? [],
      roomId,
      this.cardHashes,
      { maybeRelativeURL: null },
    );
    let attachedSkillEventIds = await this.getCardEventIds(
      params.skillCards ?? [],
      roomId,
      this.skillCardHashes,
      { includeComputeds: true, maybeRelativeURL: null },
    );

    let clientGeneratedId = uuidv4();

    await this.sendEvent(roomId, 'm.room.message', {
      msgtype: 'org.boxel.message',
      body: params.prompt || '',
      format: 'org.matrix.custom.html',
      formatted_body: html,
      clientGeneratedId,
      data: {
        attachedCardsEventIds,
        attachedSkillEventIds,
        context: {
          tools,
        },
      },
    } as CardMessageContent);
    return { roomId };
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
        msgtype: 'org.boxel.cardFragment' as const,
        format: 'org.boxel.card' as const,
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

  getRoom(roomId: string) {
    return this.rooms.get(roomId);
  }

  private setRoom(roomId: string, room: RoomState) {
    this.rooms.set(roomId, room);
    if (!this.roomResourcesCache.has(roomId)) {
      this.roomResourcesCache.set(
        roomId,
        getRoom(
          this,
          () => roomId,
          () => this.getRoom(roomId)?.events,
        ),
      );
    }
  }

  async loadDefaultSkills() {
    if (this.defaultSkills.length > 0) {
      return this.defaultSkills;
    }

    await Promise.all(
      DefaultSkillCards.map(async (skillCardURL) => {
        let cardResource = getCard(this, () => skillCardURL);
        await cardResource.loaded;
        let card = cardResource.card as SkillCard;
        this.defaultSkills.push(new TrackedObject({ card, isActive: true }));
      }),
    );

    return this.defaultSkills;
  }

  @cached
  get roomResources() {
    let resources: TrackedMap<string, RoomResource> = new TrackedMap();
    for (let roomId of this.rooms.keys()) {
      if (!this.roomResourcesCache.get(roomId)) {
        continue;
      }
      resources.set(roomId, this.roomResourcesCache.get(roomId)!);
    }
    return resources;
  }

  private resetState() {
    this.rooms = new TrackedMap();
    this.roomMembershipQueue = [];
    this.roomResourcesCache.clear();
    this.timelineQueue = [];
    this.flushMembership = undefined;
    this.flushTimeline = undefined;
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

  private addRoomEvent(event: TempEvent) {
    let { event_id: eventId, room_id: roomId, state_key: stateKey } = event;
    // If we are receiving an event which contains
    // a data field, we may need to parse it
    // because matrix doesn't support all json types
    // Corresponding encoding is done in
    // sendEvent in the matrix-service
    if (event.content?.data) {
      if (typeof event.content.data === 'string') {
        event.content.data = JSON.parse(event.content.data);
      }
    }
    eventId = eventId ?? stateKey; // room state may not necessary have an event ID
    if (!eventId) {
      throw new Error(
        `bug: event ID is undefined for event ${JSON.stringify(
          event,
          null,
          2,
        )}`,
      );
    }
    if (!roomId) {
      throw new Error(
        `bug: roomId is undefined for event ${JSON.stringify(event, null, 2)}`,
      );
    }
    let room = this.getRoom(roomId);
    if (!room) {
      room = new RoomState();
      this.setRoom(roomId, room);
    }

    // duplicate events may be emitted from matrix, as well as the resolved room card might already contain this event
    if (!room.events.find((e) => e.event_id === eventId)) {
      room.events = [
        ...(room.events ?? []),
        event as unknown as DiscreteMatrixEvent,
      ];
    }
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

  private onTimeline = (e: MatrixEvent) => {
    this.timelineQueue.push({ event: e });
    debounce(this, this.drainTimeline, 100);
  };

  private onUpdateEventStatus = (
    e: MatrixEvent,
    _room: unknown,
    maybeOldEventId?: string,
  ) => {
    if (typeof maybeOldEventId !== 'string') {
      return;
    }
    this.timelineQueue.push({ event: e, oldEventId: maybeOldEventId });
    debounce(this, this.drainTimeline, 100);
  };

  private async drainTimeline() {
    await this.flushTimeline;

    let eventsDrained: () => void;
    this.flushTimeline = new Promise((res) => (eventsDrained = res));
    let events = [...this.timelineQueue];
    this.timelineQueue = [];
    for (let { event, oldEventId } of events) {
      await this.client?.decryptEventIfNeeded(event);
      await this.processDecryptedEvent(
        {
          ...event.event,
          status: event.status,
          content: event.getContent() || undefined,
          error: event.error ?? undefined,
        },
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

    let roomState = await this.getRoom(roomId);
    // patch in any missing room events--this will support dealing with local
    // echoes, migrating older histories as well as handle any matrix syncing gaps
    // that might occur
    if (
      roomState &&
      event.type === 'm.room.message' &&
      event.content?.msgtype === 'org.boxel.message' &&
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
          let currentFragmentId: string | undefined = attachedCardEventId;
          do {
            let fragmentEvent = roomState.events.find(
              (e: DiscreteMatrixEvent) => e.event_id === currentFragmentId,
            );
            let fragmentData: CardFragmentContent['data'];
            if (!fragmentEvent) {
              fragmentEvent = (await this.client?.fetchRoomEvent(
                roomId,
                currentFragmentId ?? '',
              )) as DiscreteMatrixEvent;
              if (
                fragmentEvent.type !== 'm.room.message' ||
                fragmentEvent.content.msgtype !== 'org.boxel.cardFragment'
              ) {
                throw new Error(
                  `Expected event ${currentFragmentId} to be 'org.boxel.card' but was ${JSON.stringify(
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
                fragmentEvent.content.msgtype !== 'org.boxel.cardFragment'
              ) {
                throw new Error(
                  `Expected event to be 'org.boxel.cardFragment' but was ${JSON.stringify(
                    fragmentEvent,
                  )}`,
                );
              }
              fragmentData = fragmentEvent.content.data;
            }
            currentFragmentId = fragmentData?.nextFragment; // using '?' so we can be kind to older event schemas
          } while (currentFragmentId);
        }
      }
    }
    if (oldEventId) {
      await this.updateRoomEvent(event, oldEventId);
    } else {
      await this.addRoomEvent(event);
    }
    if (
      event.type === 'm.room.message' &&
      event.content?.msgtype === 'org.boxel.command'
    ) {
      this.commandService.executeCommandEventIfNeeded(event);
    }

    if (room.oldState.paginationToken != null) {
      // we need to scroll back to capture any room events fired before this one
      await this.client?.scrollback(room);
    }
  }

  private async updateRoomEvent(event: Partial<IEvent>, oldEventId: string) {
    if (event.content?.data && typeof event.content.data === 'string') {
      event.content.data = JSON.parse(event.content.data);
    }
    let { event_id: eventId, room_id: roomId, state_key: stateKey } = event;
    eventId = eventId ?? stateKey; // room state may not necessary have an event ID
    if (!eventId) {
      throw new Error(
        `bug: event ID is undefined for event ${JSON.stringify(
          event,
          null,
          2,
        )}`,
      );
    }
    if (!roomId) {
      throw new Error(
        `bug: roomId is undefined for event ${JSON.stringify(event, null, 2)}`,
      );
    }

    let room = this.getRoom(roomId);
    if (!room) {
      throw new Error(
        `bug: unknown room for event ${JSON.stringify(event, null, 2)}`,
      );
    }
    let oldEventIndex = room.events.findIndex((e) => e.event_id === oldEventId);
    if (oldEventIndex >= 0) {
      room.events[oldEventIndex] = event as unknown as DiscreteMatrixEvent;
      room.events = [...room.events];
    }
  }
}

function saveAuth(auth: LoginResponse) {
  window.localStorage.setItem('auth', JSON.stringify(auth));
}

function clearAuth() {
  window.localStorage.removeItem('auth');
  window.localStorage.removeItem(currentRoomIdPersistenceKey);
}

function getAuth(): LoginResponse | undefined {
  let auth = window.localStorage.getItem('auth');
  if (!auth) {
    return;
  }
  return JSON.parse(auth) as LoginResponse;
}
