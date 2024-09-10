import type Owner from '@ember/owner';
import type RouterService from '@ember/routing/router-service';
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
import { md5 } from 'super-fast-md5';
import { TrackedMap, TrackedObject } from 'tracked-built-ins';
import { v4 as uuidv4 } from 'uuid';

import {
  Deferred,
  type LooseSingleCardDocument,
  markdownToHtml,
  aiBotUsername,
  splitStringIntoChunks,
  baseRealm,
  loaderFor,
  LooseCardResource,
  ResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  basicMappings,
  generateCardPatchCallSpecification,
  getSearchTool,
  getGenerateAppModuleTool,
} from '@cardstack/runtime-common/helpers/ai';

import { getPatchTool } from '@cardstack/runtime-common/helpers/ai';

import { currentRoomIdPersistenceKey } from '@cardstack/host/components/ai-assistant/panel';
import { Submode } from '@cardstack/host/components/submode-switcher';
import ENV from '@cardstack/host/config/environment';

import { RoomState } from '@cardstack/host/lib/matrix-classes/room';
import { getMatrixProfile } from '@cardstack/host/resources/matrix-profile';

import type { Base64ImageField as Base64ImageFieldType } from 'https://cardstack.com/base/base64-image';
import { BaseDef, type CardDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type {
  CardMessageContent,
  CardFragmentContent,
  ReactionEventContent,
  CommandResultContent,
} from 'https://cardstack.com/base/matrix-event';

import { SkillCard } from 'https://cardstack.com/base/skill-card';

import { Skill } from '../components/ai-assistant/skill-menu';
import { Timeline, Membership, addRoomEvent } from '../lib/matrix-handlers';
import { getCard } from '../resources/card-resource';
import { importResource } from '../resources/import';

import { RoomResource, getRoom } from '../resources/room';

import RealmService from './realm';

import type CardService from './card-service';
import type LoaderService from './loader-service';

import type MatrixSDKLoader from './matrix-sdk-loader';
import type { ExtendedClient, ExtendedMatrixSDK } from './matrix-sdk-loader';

import type * as MatrixSDK from 'matrix-js-sdk';

const { matrixURL } = ENV;
const AI_BOT_POWER_LEVEL = 50; // this is required to set the room name
const MAX_CARD_SIZE_KB = 60;

const DefaultSkillCards = [`${baseRealm.url}SkillCard/card-editing`];

export type Event = Partial<IEvent>;

export type OperatorModeContext = {
  submode: Submode;
  openCardIds: string[];
};

export default class MatrixService extends Service {
  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;
  @service declare realm: RealmService;
  @service private declare matrixSdkLoader: MatrixSDKLoader;

  @service declare router: RouterService;
  @tracked private _client: ExtendedClient | undefined;

  profile = getMatrixProfile(this, () => this.client.getUserId());

  accountDataProcessed = new Deferred<void>();
  rooms: TrackedMap<string, RoomState> = new TrackedMap();
  roomResourcesCache: TrackedMap<string, RoomResource> = new TrackedMap();
  messagesToSend: TrackedMap<string, string | undefined> = new TrackedMap();
  cardsToSend: TrackedMap<string, CardDef[] | undefined> = new TrackedMap();
  failedCommandState: TrackedMap<string, Error> = new TrackedMap();
  flushTimeline: Promise<void> | undefined;
  flushMembership: Promise<void> | undefined;
  roomMembershipQueue: { event: MatrixEvent; member: RoomMember }[] = [];
  timelineQueue: { event: MatrixEvent; oldEventId?: string }[] = [];
  #ready: Promise<void>;
  #matrixSDK: ExtendedMatrixSDK | undefined;
  #eventBindings: [EmittedEvents, (...arg: any[]) => void][] | undefined;
  currentUserEventReadReceipts: TrackedMap<string, { readAt: Date }> =
    new TrackedMap();
  cardHashes: Map<string, string> = new Map(); // hashes <> event id
  skillCardHashes: Map<string, string> = new Map(); // hashes <> event id
  defaultSkills: Skill[] = [];

  constructor(owner: Owner) {
    super(owner);
    this.#ready = this.loadState.perform();
  }

  addEventReadReceipt(eventId: string, receipt: { readAt: Date }) {
    this.currentUserEventReadReceipts.set(eventId, receipt);
  }

  get ready() {
    return this.#ready;
  }

  get isLoading() {
    return this.loadState.isRunning;
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
      [
        this.matrixSDK.RoomMemberEvent.Membership,
        Membership.onMembership(this),
      ],
      [this.matrixSDK.RoomEvent.Timeline, Timeline.onTimeline(this)],
      [
        this.matrixSDK.RoomEvent.LocalEchoUpdated,
        Timeline.onUpdateEventStatus(this),
      ],
      [this.matrixSDK.RoomEvent.Receipt, Timeline.onReceipt(this)],
      [
        this.matrixSDK.ClientEvent.AccountData,
        async (e) => {
          if (e.event.type == 'com.cardstack.boxel.realms') {
            this.cardService.setRealms(e.event.content.realms);
            await this.loginToRealms();
            this.accountDataProcessed.fulfill();
          }
        },
      ],
    ];
  }

  get isLoggedIn() {
    return this.client.isLoggedIn();
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
      this.realm.logout();
      this.unbindEventListeners();
      await this.client.logout(true);
    } catch (e) {
      console.log('Error logging out of Matrix', e);
    } finally {
      this.resetState();
    }
  }

  async startAndSetDisplayName(auth: LoginResponse, displayName: string) {
    this.start(auth);
    this.setDisplayName(displayName);
    await this.router.refresh();
  }

  async setDisplayName(displayName: string) {
    await this.client.setDisplayName(displayName);
  }

  async reloadProfile() {
    await this.profile.load.perform();
  }

  async start(auth?: MatrixSDK.LoginResponse) {
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
    if (this.isLoggedIn) {
      saveAuth(auth);
      this.bindEventListeners();

      try {
        await this._client.startClient();
        await this.accountDataProcessed.promise;
        await this.initializeRooms();
      } catch (e) {
        console.log('Error starting Matrix client', e);
        await this.logout();
      }
    }
  }

  private async loginToRealms() {
    // This is where we would actually load user-specific choices out of the
    // user's profile based on this.client.getUserId();
    let activeRealms = this.cardService.realmURLs;

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

  public async createRealmSession(realmURL: URL) {
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

  // these can be local names
  async invite(roomId: string, invite: string[]) {
    let userId = this.client.getUserId();
    if (!userId) {
      throw new Error(
        `bug: there is no userId associated with the matrix client`,
      );
    }
    await Promise.all(
      invite.map((i) =>
        this.client.invite(
          roomId,
          i.startsWith('@') ? i : `@${i}:${userId!.split(':')[1]}`,
        ),
      ),
    );
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
  async getCardEventIds(
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
        let patchSpec = generateCardPatchCallSpecification(
          attachedOpenCard.constructor as typeof CardDef,
          this.cardAPI,
          mappings,
        );
        if (this.realm.canWrite(attachedOpenCard.id)) {
          tools.push(getPatchTool(attachedOpenCard, patchSpec));
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

  generateCardHashKey(roomId: string, card: LooseSingleCardDocument) {
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

  async initializeRooms() {
    let { joined_rooms: joinedRooms } = await this.client.getJoinedRooms();
    for (let roomId of joinedRooms) {
      let stateEvents = await this.client.roomState(roomId);
      await Promise.all(
        stateEvents.map((event) => {
          addRoomEvent(this, { ...event, status: null });
        }),
      );
      let messages = await this.client.allRoomMessages(roomId);
      await Promise.all(
        messages.map((event) => {
          addRoomEvent(this, { ...event, status: null });
        }),
      );
    }
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

  setRoom(roomId: string, room: RoomState) {
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
