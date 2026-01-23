import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import { v4 as uuidv4 } from 'uuid';

import {
  formattedError,
  SupportedMimeType,
  type CardDocument,
  type SingleCardDocument,
  type LooseSingleCardDocument,
  type RealmInfo,
  type Loader,
} from '@cardstack/runtime-common';
import type { AtomicOperation } from '@cardstack/runtime-common/atomic-document';
import { createAtomicDocument } from '@cardstack/runtime-common/atomic-document';
import { validateWriteSize } from '@cardstack/runtime-common/write-size-validation';

import type {
  BaseDef,
  CardDef,
  FieldDef,
  Field,
  SerializeOpts,
} from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

import LimitedSet from '../lib/limited-set';

import type EnvironmentService from './environment-service';
import type LoaderService from './loader-service';
import type MessageService from './message-service';
import type NetworkService from './network';
import type Realm from './realm';
import type ResetService from './reset';

export type CardSaveSubscriber = (
  url: URL,
  content: SingleCardDocument | string,
) => void;

export type SaveType =
  | 'bot-patch'
  | 'editor'
  | 'editor-with-instance'
  | 'create-file'
  | 'copy'
  | 'instance';

export interface SaveSourceOptions {
  resetLoader?: boolean;
  clientRequestId?: string;
}

type CardServiceRequestInit = RequestInit & { clientRequestId?: string };

export default class CardService extends Service {
  @service declare private loaderService: LoaderService;
  @service declare private messageService: MessageService;
  @service declare private network: NetworkService;
  @service declare private environmentService: EnvironmentService;
  @service declare private realm: Realm;
  @service declare private reset: ResetService;

  private subscriber: CardSaveSubscriber | undefined;
  // This error will be used by check-correctness command to report size limit errors
  private sizeLimitError = new Map<string, Error>();
  // For tracking requests during the duration of this service. Used for being able to tell when to ignore an incremental indexing realm event.
  // We want to ignore it when it is a result of our own request so that we don't reload the card and overwrite any unsaved changes made during auto save request and realm event.
  declare private loaderToCardAPILoadingCache: WeakMap<
    Loader,
    Promise<typeof CardAPI>
  >;
  declare clientRequestIds: LimitedSet<string>;

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
    this.clientRequestIds = new LimitedSet(250);
    this.loaderToCardAPILoadingCache = new WeakMap();
  }

  // used for tests only!
  _onSave(subscriber: CardSaveSubscriber) {
    this.subscriber = subscriber;
  }

  // used for tests only!
  _unregisterSaveSubscriber() {
    this.subscriber = undefined;
  }

  getSizeLimitError(url: string): Error | undefined {
    return this.sizeLimitError.get(url);
  }

  async fetchJSON(
    url: string | URL,
    args?: CardServiceRequestInit,
  ): Promise<CardDocument | undefined> {
    let {
      headers,
      clientRequestId: providedClientRequestId,
      ...argsExceptHeaders
    } = args ?? {
      headers: {},
    };
    let isReadOperation =
      !args ||
      ['GET', 'QUERY', 'OPTIONS'].includes(
        args.method?.toUpperCase?.() ?? '',
      ) ||
      (args.method === 'POST' &&
        (headers as Record<string, string>)?.['X-HTTP-Method-Override'] ===
          'QUERY');

    let requestHeaders = new Headers(headers ?? {});
    if (!isReadOperation) {
      let clientRequestId = providedClientRequestId ?? `instance:${uuidv4()}`;
      this.clientRequestIds.add(clientRequestId);
      requestHeaders.set('X-Boxel-Client-Request-Id', clientRequestId);
    }
    if (!requestHeaders.has('Accept')) {
      requestHeaders.set('Accept', SupportedMimeType.CardJson);
    }
    let requestInit = {
      headers: requestHeaders,
      ...argsExceptHeaders,
    } as RequestInit;
    if (requestInit.method === 'QUERY') {
      requestInit.method = 'POST';
      requestHeaders.set('X-HTTP-Method-Override', 'QUERY');
    }
    let urlString = url instanceof URL ? url.href : url;
    let method = requestInit.method?.toUpperCase?.();
    if (
      !isReadOperation &&
      (method === 'POST' || method === 'PATCH') &&
      requestInit.body
    ) {
      let jsonString =
        typeof requestInit.body === 'string'
          ? requestInit.body
          : JSON.stringify(requestInit.body, null, 2);
      this.validateSizeLimit(urlString, jsonString, 'card');
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

  async serializeCard(
    card: CardDef,
    opts?: SerializeOpts & { withIncluded?: true },
  ): Promise<LooseSingleCardDocument> {
    let api = await this.getAPI();
    let serialized = api.serializeCard(card, opts);
    if (!opts?.withIncluded) {
      delete serialized.included;
    }
    return serialized;
  }

  async getSource(url: URL) {
    let response = await this.network.authedFetch(url, {
      headers: {
        Accept: 'application/vnd.card+source',
      },
    });
    return {
      status: response.status,
      content: await response.text(),
    };
  }

  async saveSource(
    url: URL,
    content: string,
    type: SaveType,
    options?: SaveSourceOptions,
  ) {
    try {
      this.validateSizeLimit(url.href, content, 'file');
      let clientRequestId = options?.clientRequestId ?? `${type}:${uuidv4()}`;
      this.clientRequestIds.add(clientRequestId);

      let response = await this.network.authedFetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.card+source',
          'X-Boxel-Client-Request-Id': clientRequestId,
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

      if (options?.resetLoader) {
        this.loaderService.resetLoader();
      }

      return response;
    } catch (e: any) {
      let error = formattedError(undefined, e)?.errors?.[0];
      if (error) {
        throw error;
      }
      throw new Error(e);
    }
  }

  async copySource(fromUrl: URL, toUrl: URL) {
    let response = await this.network.authedFetch(fromUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.card+source',
      },
    });

    const content = await response.text();
    return await this.saveSource(toUrl, content, 'copy');
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

  async cardsSettled() {
    let api = await this.getAPI();
    await api.flushLogs();
  }

  async getRealmInfoByRealmURL(realmURL: URL): Promise<RealmInfo> {
    let response = await this.network.authedFetch(`${realmURL}_info`, {
      headers: { Accept: SupportedMimeType.RealmInfo },
      method: 'QUERY',
    });

    if (!response.ok) {
      throw new Error(
        `status: ${response.status} -
        ${response.statusText}. ${await response.text()}`,
      );
    }
    return (await response.json()).data.attributes;
  }

  async executeAtomicOperations(operations: AtomicOperation[], realmURL: URL) {
    for (let operation of operations) {
      if (operation.data?.type === 'source') {
        let content = operation.data.attributes?.content;
        if (typeof content === 'string') {
          this.validateSizeLimit(operation.href, content, 'file');
        }
      } else if (operation.data?.type === 'card') {
        let jsonString = JSON.stringify(operation.data, null, 2);
        this.validateSizeLimit(operation.href, jsonString, 'card');
      }
    }
    let doc = createAtomicDocument(operations);
    let response = await this.network.authedFetch(`${realmURL.href}_atomic`, {
      method: 'POST',
      headers: {
        Accept: SupportedMimeType.JSONAPI,
      },
      body: JSON.stringify(doc),
    });
    return response.json();
  }

  private validateSizeLimit(
    url: string,
    content: string,
    type: 'card' | 'file',
  ) {
    let maxSizeBytes = this.environmentService.cardSizeLimitBytes;
    try {
      this.sizeLimitError.delete(url);
      validateWriteSize(content, maxSizeBytes, type);
    } catch (e: any) {
      this.sizeLimitError.set(url, e);
      throw e;
    }
  }
}

declare module '@ember/service' {
  interface Registry {
    'card-service': CardService;
  }
}
