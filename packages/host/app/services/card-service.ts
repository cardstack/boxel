import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import { buildWaiter } from '@ember/test-waiters';

import { isTesting } from '@embroider/macros';

import { stringify } from 'qs';

import { v4 as uuidv4 } from 'uuid';

import {
  SupportedMimeType,
  type LooseCardResource,
  isSingleCardDocument,
  isCardCollectionDocument,
  type CardDocument,
  type SingleCardDocument,
  type LooseSingleCardDocument,
  type RealmInfo,
  type Loader,
  type PatchData,
  type Relationship,
} from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common/query';

import ENV from '@cardstack/host/config/environment';

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

const { environment } = ENV;

const waiter = buildWaiter('card-service:waiter');

export default class CardService extends Service {
  @service private declare loaderService: LoaderService;
  @service private declare messageService: MessageService;
  @service private declare network: NetworkService;
  @service private declare realm: Realm;
  @service private declare reset: ResetService;

  private async withTestWaiters<T>(cb: () => Promise<T>) {
    let token = waiter.beginAsync();
    try {
      let result = await cb();
      // only do this in test env--this makes sure that we also wait for any
      // interior card instance async as part of our ember-test-waiters
      if (isTesting()) {
        await this.cardsSettled();
      }
      return result;
    } finally {
      waiter.endAsync(token);
    }
  }

  private subscriber: CardSaveSubscriber | undefined;
  // For tracking requests during the duration of this service. Used for being able to tell when to ignore an incremental indexing SSE event.
  // We want to ignore it when it is a result of our own request so that we don't reload the card and overwrite any unsaved changes made during auto save request and SSE event.
  private declare loaderToCardAPILoadingCache: WeakMap<
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

  onSave(subscriber: CardSaveSubscriber) {
    this.subscriber = subscriber;
  }

  unregisterSaveSubscriber() {
    this.subscriber = undefined;
  }

  async fetchJSON(
    url: string | URL,
    args?: RequestInit,
  ): Promise<CardDocument | undefined> {
    let clientRequestId = uuidv4();
    this.clientRequestIds.add(clientRequestId);

    let response = await this.network.authedFetch(url, {
      headers: {
        Accept: SupportedMimeType.CardJson,
        'X-Boxel-Client-Request-Id': clientRequestId,
      },
      ...args,
    });
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

  async createFromSerialized(
    resource: LooseCardResource,
    doc: LooseSingleCardDocument | CardDocument,
    relativeTo?: URL | undefined,
    opts?: { identityContext?: IdentityContext },
  ): Promise<CardDef> {
    let api = await this.getAPI();
    let card = await api.createFromSerialized(resource, doc, relativeTo, opts);
    // it's important that we absorb the field async here so that glimmer won't
    // encounter NotLoaded errors, since we don't have the luxury of the indexer
    // being able to inform us of which fields are used or not at this point.
    // (this is something that the card compiler could optimize for us in the
    // future)
    await api.recompute(card, {
      recomputeAllFields: true,
      loadFields: true,
    });
    return card as CardDef;
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

  async reloadCard(card: CardDef): Promise<void> {
    // we don't await this in the realm subscription callback, so this test
    // waiter should catch otherwise leaky async in the tests
    await this.withTestWaiters(async () => {
      let incomingDoc: SingleCardDocument = (await this.fetchJSON(
        card.id,
        undefined,
      )) as SingleCardDocument;

      if (!isSingleCardDocument(incomingDoc)) {
        throw new Error(
          `bug: server returned a non card document for ${card.id}:
        ${JSON.stringify(incomingDoc, null, 2)}`,
        );
      }
      let api = await this.getAPI();
      await api.updateFromSerialized<typeof CardDef>(card, incomingDoc);
    });
  }

  // we return undefined if the card changed locally while the save was in-flight
  async saveModel(
    card: CardDef,
    defaultRealmHref?: string,
  ): Promise<CardDef | undefined> {
    let cardChanged = false;
    function onCardChange() {
      cardChanged = true;
    }
    let api = await this.getAPI();
    try {
      api.subscribeToChanges(card, onCardChange);
      let doc = await this.serializeCard(card, {
        // for a brand new card that has no id yet, we don't know what we are
        // relativeTo because its up to the realm server to assign us an ID, so
        // URL's should be absolute
        maybeRelativeURL: null, // forces URL's to be absolute.
      });
      // send doc over the wire with absolute URL's. The realm server will convert
      // to relative URL's as it serializes the cards
      let realmURL = await this.getRealmURL(card);
      // in the case where we get no realm URL from the card, we are dealing with
      // a new card instance that does not have a realm URL yet.
      if (!realmURL) {
        defaultRealmHref =
          defaultRealmHref ?? this.realm.defaultWritableRealm?.path;
        if (!defaultRealmHref) {
          throw new Error('Could not find a writable realm');
        }
        realmURL = new URL(defaultRealmHref);
      }
      let json = await this.saveCardDocument(doc, realmURL);
      let isNew = !card.id;

      let result: CardDef | undefined;
      // if the card changed while the save was in flight then don't load the
      // server's version of the card--the next auto save will include these
      // unsaved changes.
      if (!cardChanged) {
        // in order to preserve object equality with the unsaved card instance we
        // should always use updateFromSerialized()--this way a newly created
        // instance that does not yet have an id is still the same instance after an
        // ID has been assigned by the server.
        result = (await api.updateFromSerialized(card, json)) as CardDef;
      } else if (isNew) {
        // in this case a new card was created, but there is an immediate change
        // that was made--so we save off the new ID for the card so in the next
        // save we'll correlate to the correct card ID
        card.id = json.data.id;
      }
      if (this.subscriber) {
        this.subscriber(new URL(json.data.id), json);
      }
      return result;
    } catch (err) {
      console.error(`Failed to save ${card.id}: `, err);
      throw err;
    } finally {
      api.unsubscribeFromChanges(card, onCardChange);
    }
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

  // we return undefined if the card changed locally while the save was in-flight
  async patchCard(
    card: CardDef,
    doc: LooseSingleCardDocument,
    patchData: PatchData,
  ): Promise<CardDef | undefined> {
    let api = await this.getAPI();
    let linkedCards = await this.loadPatchedCards(patchData, new URL(card.id));
    for (let [field, value] of Object.entries(linkedCards)) {
      if (field.includes('.')) {
        let parts = field.split('.');
        let leaf = parts.pop();
        if (!leaf) {
          throw new Error(`bug: error in field name "${field}"`);
        }
        let inner = card;
        for (let part of parts) {
          inner = (inner as any)[part];
        }
        (inner as any)[leaf.match(/^\d+$/) ? Number(leaf) : leaf] = value;
      } else {
        // TODO this could trigger a save. perhaps instead we could
        // introduce a new option to updateFromSerialized to accept a list of
        // fields to pre-load? which in this case would be any relationships that
        // were patched in
        (card as any)[field] = value;
      }
    }
    let updatedCard = await api.updateFromSerialized<typeof CardDef>(card, doc);
    // TODO setting `this` as an owner until we can have a better solution here...
    // (currently only used by the AI bot to patch cards from chat)
    return await this.saveModel(updatedCard);
  }

  private async loadRelationshipCard(rel: Relationship, relativeTo: URL) {
    if (!rel.links.self) {
      return;
    }
    let id = rel.links.self;
    let card = await this.getCard(new URL(id, relativeTo).href);
    return card;
  }

  async getCard<T extends CardDef = CardDef>(url: URL | string): Promise<T> {
    if (typeof url === 'string') {
      url = new URL(url);
    }
    let json = await this.fetchJSON(url);
    if (!isSingleCardDocument(json)) {
      throw new Error(
        `bug: server returned a non card document for ${url}:
      ${JSON.stringify(json, null, 2)}`,
      );
    }
    let card = await this.createFromSerialized(
      json.data,
      json,
      new URL(json.data.id),
    );
    return card as T;
  }

  private async loadPatchedCards(
    patchData: PatchData,
    relativeTo: URL,
  ): Promise<{
    [fieldName: string]: CardDef | CardDef[];
  }> {
    if (!patchData?.relationships) {
      return {};
    }
    let result: { [fieldName: string]: CardDef | CardDef[] } = {};
    await Promise.all(
      Object.entries(patchData.relationships).map(async ([fieldName, rel]) => {
        if (Array.isArray(rel)) {
          let cards: CardDef[] = [];
          await Promise.all(
            rel.map(async (r) => {
              let card = await this.loadRelationshipCard(r, relativeTo);
              if (card) {
                cards.push(card);
              }
            }),
          );
          result[fieldName] = cards;
        } else {
          let card = await this.loadRelationshipCard(rel, relativeTo);
          if (card) {
            result[fieldName] = card;
          }
        }
      }),
    );
    return result;
  }

  private async saveCardDocument(
    doc: LooseSingleCardDocument,
    realmUrl: URL,
  ): Promise<SingleCardDocument> {
    let isSaved = !!doc.data.id;
    let json = await this.fetchJSON(doc.data.id ?? realmUrl, {
      method: isSaved ? 'PATCH' : 'POST',
      body: JSON.stringify(doc, null, 2),
    });
    if (!isSingleCardDocument(json)) {
      throw new Error(
        `bug: arg is not a card document:
        ${JSON.stringify(json, null, 2)}`,
      );
    }
    return json;
  }

  async copyCard(source: CardDef, destinationRealm: URL): Promise<CardDef> {
    let api = await this.getAPI();
    let serialized = await this.serializeCard(source, {
      maybeRelativeURL: null, // forces URL's to be absolute.
    });
    delete serialized.data.id;
    let json = await this.saveCardDocument(serialized, destinationRealm);
    let result = (await api.createFromSerialized(
      json.data,
      json,
      new URL(json.data.id),
    )) as CardDef;
    if (this.subscriber) {
      this.subscriber(new URL(json.data.id), json);
    }
    return result;
  }

  async deleteCard(cardId: string): Promise<void> {
    if (!cardId) {
      // the card isn't actually saved yet, so do nothing
      return;
    }
    await this.fetchJSON(cardId, { method: 'DELETE' });
  }

  // TODO consider retiring this.  i don't think it really does what we want
  // since it is not live, and the cards that it returns are not live and does
  // not leverage the identity map from CardResource, so it may create
  // duplicative instances of cards when it deserializes the results. instead of
  // using this please use the SearchResource.
  async search(query: Query, realmURL: URL): Promise<CardDef[]> {
    let json = await this.fetchJSON(`${realmURL}_search?${stringify(query)}`);
    if (!isCardCollectionDocument(json)) {
      throw new Error(
        `The realm search response was not a card collection document:
        ${JSON.stringify(json, null, 2)}`,
      );
    }
    let collectionDoc = json;
    try {
      console.time('search deserialization');
      return (
        await Promise.all(
          collectionDoc.data.map(async (doc) => {
            try {
              return await this.createFromSerialized(
                doc,
                collectionDoc,
                new URL(doc.id),
              );
            } catch (e) {
              console.warn(
                `Skipping ${
                  doc.id
                }. Encountered error deserializing from search result for query ${JSON.stringify(
                  query,
                  null,
                  2,
                )} against realm ${realmURL}`,
                e,
              );
              return undefined;
            }
          }),
        )
      ).filter(Boolean) as CardDef[];
    } finally {
      if (environment !== 'test') {
        console.timeEnd('search deserialization');
      }
    }
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
