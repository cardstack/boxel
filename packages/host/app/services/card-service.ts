import Service, { service } from '@ember/service';
import { stringify } from 'qs';
import type LoaderService from './loader-service';
import {
  SupportedMimeType,
  type LooseCardResource,
  isSingleCardDocument,
  isCardCollectionDocument,
  type CardDocument,
  type SingleCardDocument,
  type LooseSingleCardDocument,
  type RealmInfo,
} from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common/query';
import { importResource } from '../resources/import';
import type {
  BaseDef,
  CardDef,
  FieldDef,
  Field,
  SerializeOpts,
} from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import ENV from '@cardstack/host/config/environment';

export type CardSaveSubscriber = (json: SingleCardDocument) => void;
const { ownRealmURL } = ENV;

export default class CardService extends Service {
  @service declare loaderService: LoaderService;
  private subscriber: CardSaveSubscriber | undefined;
  private indexCards: Map<string, CardDef> = new Map();

  private apiModule = importResource(
    this,
    () => 'https://cardstack.com/base/card-api',
  );

  private get api() {
    if (this.apiModule.error) {
      throw new Error(
        `Error loading Card API: ${JSON.stringify(this.apiModule.error)}`,
      );
    }
    if (!this.apiModule.module) {
      throw new Error(
        `bug: Card API has not loaded yet--make sure to await this.loaded before using the api`,
      );
    }
    return this.apiModule.module as typeof CardAPI;
  }

  get ready() {
    return this.apiModule.loaded;
  }

  // Note that this should be the unresolved URL and that we need to rely on our
  // fetch to do any URL resolution.
  get defaultURL(): URL {
    return new URL(ownRealmURL);
  }

  onSave(subscriber: CardSaveSubscriber) {
    this.subscriber = subscriber;
  }

  unregisterSaveSubscriber() {
    this.subscriber = undefined;
  }

  private async fetchJSON(
    url: string | URL,
    args?: RequestInit,
  ): Promise<CardDocument | void> {
    let response = await this.loaderService.loader.fetch(url, {
      headers: { Accept: SupportedMimeType.CardJson },
      ...args,
    });
    if (!response.ok) {
      throw new Error(
        `status: ${response.status} -
        ${response.statusText}. ${await response.text()}`,
      );
    }
    if (response.status !== 204) {
      return await response.json();
    }
  }

  async createFromSerialized(
    resource: LooseCardResource,
    doc: LooseSingleCardDocument | CardDocument,
    relativeTo: URL | undefined,
  ): Promise<CardDef> {
    await this.apiModule.loaded;
    let card = await this.api.createFromSerialized(
      resource,
      doc,
      relativeTo,
      this.loaderService.loader,
    );
    // it's important that we absorb the field async here so that glimmer won't
    // encounter NotReady errors, since we don't have the luxury of the indexer
    // being able to inform us of which fields are used or not at this point.
    // (this is something that the card compiler could optimize for us in the
    // future)
    await this.api.recompute(card, {
      recomputeAllFields: true,
      loadFields: true,
    });
    return card as CardDef;
  }

  async loadModel(url: URL): Promise<CardDef> {
    let index = this.indexCards.get(url.href);
    if (index) {
      return index;
    }

    await this.apiModule.loaded;
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
      typeof url === 'string' ? new URL(url) : url,
    );
    if (this.isIndexCard(card)) {
      this.indexCards.set(url.href, card);
    }
    return card;
  }

  async serializeCard(
    card: CardDef,
    opts?: SerializeOpts,
  ): Promise<LooseSingleCardDocument> {
    await this.apiModule.loaded;
    let serialized = this.api.serializeCard(card, opts);
    delete serialized.included;
    return serialized;
  }

  async saveModel(card: CardDef): Promise<CardDef> {
    await this.apiModule.loaded;
    let doc = await this.serializeCard(card, {
      // for a brand new card that has no id yet, we don't know what we are
      // relativeTo because its up to the realm server to assign us an ID, so
      // URL's should be absolute
      maybeRelativeURL: null, // forces URL's to be absolute.
    });
    // send doc over the wire with absolute URL's. The realm server will convert
    // to relative URL's as it serializes the cards
    let json = await this.saveCardDocument(
      doc,
      card.id ? new URL(card.id) : undefined,
    );

    // in order to preserve object equality with the unsaved card instance we
    // should always use updateFromSerialized()--this way a newly created
    // instance that does not yet have an id is still the same instance after an
    // ID has been assigned by the server.
    let result = (await this.api.updateFromSerialized(card, json)) as CardDef;
    if (this.subscriber) {
      this.subscriber(json);
    }
    return result;
  }

  async saveCardDocument(
    doc: LooseSingleCardDocument,
    url?: URL,
  ): Promise<SingleCardDocument> {
    let isSaved = !!doc.data.id;
    url = url ?? this.defaultURL;
    let json = await this.fetchJSON(url, {
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
    let serialized = await this.serializeCard(source, {
      maybeRelativeURL: null, // forces URL's to be absolute.
    });
    delete serialized.data.id;
    let json = await this.saveCardDocument(serialized, destinationRealm);
    let result = (await this.api.createFromSerialized(
      json.data,
      json,
      new URL(json.data.id),
      this.loaderService.loader,
    )) as CardDef;
    if (this.subscriber) {
      this.subscriber(json);
    }
    return result;
  }

  async deleteCard(card: CardDef): Promise<void> {
    if (!card.id) {
      // the card isn't actually saved yet, so do nothing
      return;
    }
    await this.fetchJSON(card.id, { method: 'DELETE' });
  }

  async search(query: Query, realmURL: URL): Promise<CardDef[]> {
    let json = await this.fetchJSON(`${realmURL}_search?${stringify(query)}`);
    if (!isCardCollectionDocument(json)) {
      throw new Error(
        `The realm search response was not a card collection document:
        ${JSON.stringify(json, null, 2)}`,
      );
    }
    let results: CardDef[] = [];

    // TODO let's deserialize the search results concurrently for better performance
    for (let doc of json.data) {
      // TODO temporarily ignoring errors during deserialization until we have a
      // better solution here so that index cards aren't broken when a search
      // result item encounters an error while being deserialized. Specifically
      // we may encounter broken links which throw a NotFound error (as
      // designed). The indexer does not yet track card instances that are
      // consumed by each index instance so during deletion of instances we
      // don't have anything to invalidate which means that broken links may
      // live in our index. although there is nothing stopping a realm server
      // from going down which may also cause a broken link...
      try {
        results.push(
          await this.createFromSerialized(doc, json, new URL(doc.id)),
        );
      } catch (e) {
        console.error(
          `Encountered error deserializing '${
            doc.id
          }' from search result for query ${JSON.stringify(
            query,
            null,
            2,
          )} against realm ${realmURL}`,
          e,
        );
      }
    }
    return results;
  }

  async getFields(
    cardOrField: BaseDef,
  ): Promise<{ [fieldName: string]: Field<typeof BaseDef> }> {
    await this.apiModule.loaded;
    return this.api.getFields(cardOrField, { includeComputeds: true });
  }

  async isPrimitive(card: typeof FieldDef): Promise<boolean> {
    await this.apiModule.loaded;
    return this.api.primitive in card;
  }

  isCard(maybeCard: any): maybeCard is CardDef {
    return this.api.isCard(maybeCard);
  }

  isIndexCard(maybeIndexCard: any): maybeIndexCard is CardDef {
    if (!(maybeIndexCard instanceof this.api.CardDef)) {
      return false;
    }
    let realmURL = maybeIndexCard[this.api.realmURL]?.href;
    if (!realmURL) {
      throw new Error(
        `bug: could not determine realm URL for index card ${maybeIndexCard.id}`,
      );
    }
    return maybeIndexCard.id === `${realmURL}index`;
  }

  async getRealmInfo(card: CardDef): Promise<RealmInfo | undefined> {
    await this.apiModule.loaded;
    return card[this.api.realmInfo];
  }

  async getRealmURL(card: CardDef): Promise<URL | undefined> {
    await this.apiModule.loaded;
    return card[this.api.realmURL];
  }

  async cardsSettled() {
    await this.apiModule.loaded;
    await this.api.flushLogs();
  }

  // intentionally not async so that this can run in a destructor--this means
  // that callers need to await this.ready
  unsubscribeFromCard(
    card: CardDef,
    subscriber: (fieldName: string, value: any) => void,
  ) {
    this.api.unsubscribeFromChanges(card, subscriber);
  }

  // also not async to reflect the fact the unsubscribe is not async. Callers
  // needs to await this.ready
  subscribeToCard(
    card: CardDef,
    subscriber: (fieldName: string, value: any) => void,
  ) {
    this.api.subscribeToChanges(card, subscriber);
  }
}
