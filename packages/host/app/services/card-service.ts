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
  Card,
  CardBase,
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
  ): Promise<CardDocument> {
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
    return await response.json();
  }

  async createFromSerialized(
    resource: LooseCardResource,
    doc: LooseSingleCardDocument | CardDocument,
    relativeTo: URL | undefined,
  ): Promise<Card> {
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
    return card as Card;
  }

  async loadModel(url: URL): Promise<Card> {
    await this.apiModule.loaded;
    let json = await this.fetchJSON(url);
    if (!isSingleCardDocument(json)) {
      throw new Error(
        `bug: server returned a non card document for ${url}:
        ${JSON.stringify(json, null, 2)}`,
      );
    }
    return await this.createFromSerialized(
      json.data,
      json,
      typeof url === 'string' ? new URL(url) : url,
    );
  }

  async serializeCard(
    card: Card,
    opts?: SerializeOpts,
  ): Promise<LooseSingleCardDocument> {
    await this.apiModule.loaded;
    return this.api.serializeCard(card, opts);
  }

  async saveModel(card: Card): Promise<Card> {
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
    let result = (await this.api.updateFromSerialized(card, json)) as Card;
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

  async copyCard(source: Card, destinationRealm: URL): Promise<Card> {
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
    )) as Card;
    if (this.subscriber) {
      this.subscriber(json);
    }
    return result;
  }

  async search(query: Query, realmURL: URL): Promise<Card[]> {
    let json = await this.fetchJSON(`${realmURL}_search?${stringify(query)}`);
    if (!isCardCollectionDocument(json)) {
      throw new Error(
        `The realm search response was not a card collection document:
        ${JSON.stringify(json, null, 2)}`,
      );
    }
    // TODO the fact that the loader cannot handle a concurrent form of this is
    // indicative of a loader issue. Need to work with Ed around this as I think
    // there is probably missing state in our loader's state machine.
    let results: Card[] = [];
    for (let doc of json.data) {
      results.push(await this.createFromSerialized(doc, json, new URL(doc.id)));
    }
    return results;
  }

  async getFields(
    card: CardBase,
  ): Promise<{ [fieldName: string]: Field<typeof CardBase> }> {
    await this.apiModule.loaded;
    return this.api.getFields(card, { includeComputeds: true });
  }

  async isPrimitive(card: typeof CardBase): Promise<boolean> {
    await this.apiModule.loaded;
    return this.api.primitive in card;
  }

  isCard(maybeCard: any): maybeCard is Card {
    return this.api.isCard(maybeCard);
  }

  isIndexCard(maybeIndexCard: any): maybeIndexCard is Card {
    if (!(maybeIndexCard instanceof this.api.Card)) {
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

  async getRealmInfo(card: Card): Promise<RealmInfo | undefined> {
    await this.apiModule.loaded;
    return card[this.api.realmInfo];
  }

  async getRealmURL(card: Card): Promise<URL | undefined> {
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
    card: Card,
    subscriber: (fieldName: string, value: any) => void,
  ) {
    this.api.unsubscribeFromChanges(card, subscriber);
  }

  // also not async to reflect the fact the unsubscribe is not async. Callers
  // needs to await this.ready
  subscribeToCard(
    card: Card,
    subscriber: (fieldName: string, value: any) => void,
  ) {
    this.api.subscribeToChanges(card, subscriber);
  }
}
