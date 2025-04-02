import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import { v4 as uuidv4 } from 'uuid';

import {
  SupportedMimeType,
  type LooseCardResource,
  type CardDocument,
  type SingleCardDocument,
  type LooseSingleCardDocument,
  type RealmInfo,
  type Loader,
} from '@cardstack/runtime-common';

import type {
  BaseDef,
  CardDef,
  FieldDef,
  Field,
  SerializeOpts,
  IdentityContext,
} from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

import type LoaderService from './loader-service';
import type MessageService from './message-service';
import type NetworkService from './network';
import type Realm from './realm';
import type ResetService from './reset';

export type CardSaveSubscriber = (
  url: URL,
  content: SingleCardDocument | string,
) => void;

export default class CardService extends Service {
  @service declare private loaderService: LoaderService;
  @service declare private messageService: MessageService;
  @service declare private network: NetworkService;
  @service declare private realm: Realm;
  @service declare private reset: ResetService;

  private subscriber: CardSaveSubscriber | undefined;
  // For tracking requests during the duration of this service. Used for being able to tell when to ignore an incremental indexing SSE event.
  // We want to ignore it when it is a result of our own request so that we don't reload the card and overwrite any unsaved changes made during auto save request and SSE event.
  declare private loaderToCardAPILoadingCache: WeakMap<
    Loader,
    Promise<typeof CardAPI>
  >;
  declare clientRequestIds: Set<string>;

  constructor(owner: Owner) {
    super(owner);
    this.resetState();
    this.reset.register(this);
  }

  async getAPI(): Promise<typeof CardAPI> {
    let loader = this.loaderService.loader;
    if (!this.loaderToCardAPILoadingCache.has(loader)) {
      let apiPromise = loader.import<typeof CardAPI>(
        'https://cardstack.com/base/card-api',
      );
      this.loaderToCardAPILoadingCache.set(loader, apiPromise);
      return apiPromise;
    }
    return this.loaderToCardAPILoadingCache.get(loader)!;
  }

  resetState() {
    this.subscriber = undefined;
    this.clientRequestIds = new Set();
    this.loaderToCardAPILoadingCache = new WeakMap();
  }

  _onSave(subscriber: CardSaveSubscriber) {
    this.subscriber = subscriber;
  }

  _unregisterSaveSubscriber() {
    this.subscriber = undefined;
  }

  async fetchJSON(
    url: string | URL,
    args?: RequestInit,
  ): Promise<CardDocument | undefined> {
    let { headers, ...argsExceptHeaders } = args ?? {
      headers: {},
      argsExceptHeaders: {},
    };
    let isReadOperation =
      !args ||
      ['GET', 'QUERY', 'OPTIONS'].includes(
        args.method?.toUpperCase?.() ?? '',
      ) ||
      (args.method === 'POST' &&
        (headers as Record<string, string>)?.['X-HTTP-Method-Override'] ===
          'QUERY');

    if (!isReadOperation) {
      let clientRequestId = uuidv4();
      this.clientRequestIds.add(clientRequestId);
      headers = { ...headers, 'X-Boxel-Client-Request-Id': clientRequestId };
    }

    headers = { ...headers, Accept: SupportedMimeType.CardJson };
    let requestInit = {
      headers,
      ...argsExceptHeaders,
    } as RequestInit;
    if (requestInit.method === 'QUERY') {
      requestInit.method = 'POST';
      requestInit.headers = {
        ...requestInit.headers,
        'X-HTTP-Method-Override': 'QUERY',
      };
    }
    let response = await this.network.authedFetch(url, requestInit);
    if (!response.ok) {
      let responseText = await response.text();
      let err = new Error(
        `status: ${response.status} -
          ${response.statusText}. ${responseText}`,
      ) as any;

      err.status = response.status;
      err.responseText = responseText;
      err.responseHeaders = response.headers;

      throw err;
    }
    if (response.status !== 204) {
      return await response.json();
    }
    return;
  }

  // WARNING! please do not use this to create card instances. Use
  // `CardResource.getCard()` or `StoreService.getInstanceDetachedFromStore()`
  // instead for getting card instances. When you create card instances
  // directly from here it bypasses the store's identity map and instances
  // created directly from here will behave very problematically.
  async createFromSerialized<T extends CardDef>(
    resource: LooseCardResource,
    doc: LooseSingleCardDocument | CardDocument,
    relativeTo?: URL | undefined,
    opts?: { identityContext?: IdentityContext },
  ): Promise<T> {
    let api = await this.getAPI();
    let card = (await api.createFromSerialized(
      resource,
      doc,
      relativeTo,
      opts,
    )) as T;
    // it's important that we absorb the field async here so that glimmer won't
    // encounter NotLoaded errors, since we don't have the luxury of the indexer
    // being able to inform us of which fields are used or not at this point.
    // (this is something that the card compiler could optimize for us in the
    // future)
    await api.recompute(card, {
      recomputeAllFields: true,
      loadFields: true,
    });
    return card;
  }

  async serializeCard(
    card: CardDef,
    opts?: SerializeOpts,
  ): Promise<LooseSingleCardDocument> {
    let api = await this.getAPI();
    let serialized = api.serializeCard(card, opts);
    delete serialized.included;
    return serialized;
  }

  async getSource(url: URL) {
    let response = await this.network.authedFetch(url, {
      headers: {
        Accept: 'application/vnd.card+source',
      },
    });
    return response.text();
  }

  async saveSource(url: URL, content: string) {
    let response = await this.network.authedFetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.card+source',
      },
      body: content,
    });

    if (!response.ok) {
      let errorMessage = `Could not write file ${url}, status ${
        response.status
      }: ${response.statusText} - ${await response.text()}`;
      console.error(errorMessage);
      throw new Error(errorMessage);
    }
    this.subscriber?.(url, content);
    return response;
  }

  async copySource(fromUrl: URL, toUrl: URL) {
    let response = await this.network.authedFetch(fromUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.card+source',
      },
    });

    const content = await response.text();
    await this.saveSource(toUrl, content);
    return response;
  }

  async deleteSource(url: URL) {
    let response = await this.network.authedFetch(url, {
      method: 'DELETE',
      headers: {
        Accept: 'application/vnd.card+source',
      },
    });

    if (!response.ok) {
      let errorMessage = `Could not delete file ${url}, status ${
        response.status
      }: ${response.statusText} - ${await response.text()}`;
      console.error(errorMessage);
      throw new Error(errorMessage);
    }
    return response;
  }

  async getFields(
    cardOrField: BaseDef,
  ): Promise<{ [fieldName: string]: Field<typeof BaseDef> }> {
    let api = await this.getAPI();
    return api.getFields(cardOrField, { includeComputeds: true });
  }

  async isPrimitive(card: typeof FieldDef): Promise<boolean> {
    let api = await this.getAPI();
    return api.primitive in card;
  }

  async getRealmInfo(card: CardDef): Promise<RealmInfo | undefined> {
    let api = await this.getAPI();
    return card[api.realmInfo];
  }

  async getRealmURL(card: CardDef): Promise<URL | undefined> {
    let api = await this.getAPI();
    return card[api.realmURL];
  }

  async cardsSettled() {
    let api = await this.getAPI();
    await api.flushLogs();
  }

  async getRealmInfoByRealmURL(realmURL: URL): Promise<RealmInfo> {
    let response = await this.network.authedFetch(`${realmURL}_info`, {
      headers: { Accept: SupportedMimeType.RealmInfo },
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(
        `status: ${response.status} -
        ${response.statusText}. ${await response.text()}`,
      );
    }
    return (await response.json()).data.attributes;
  }
}
