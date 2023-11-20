import Service, { service } from '@ember/service';

import { task } from 'ember-concurrency';

import { stringify } from 'qs';

import {
  SupportedMimeType,
  type LooseCardResource,
  isSingleCardDocument,
  isCardCollectionDocument,
  RealmPaths,
  type CardDocument,
  type SingleCardDocument,
  type LooseSingleCardDocument,
  type RealmInfo,
  type Loader,
} from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common/query';

import ENV from '@cardstack/host/config/environment';

import type MessageService from '@cardstack/host/services/message-service';

import type {
  BaseDef,
  CardDef,
  FieldDef,
  Field,
  SerializeOpts,
} from 'https://cardstack.com/base/card-api';

import type * as CardAPI from 'https://cardstack.com/base/card-api';

import { trackCard } from '../resources/card-resource';

import type LoaderService from './loader-service';

export type CardSaveSubscriber = (content: SingleCardDocument | string) => void;

const { ownRealmURL, otherRealmURLs } = ENV;

export default class CardService extends Service {
  @service private declare loaderService: LoaderService;
  @service private declare messageService: MessageService;
  private subscriber: CardSaveSubscriber | undefined;

  private getAPI = task(async (loader?: Loader) => {
    loader = loader ?? this.loaderService.loader;
    let api = await loader.import<typeof CardAPI>(
      'https://cardstack.com/base/card-api',
    );
    return api;
  });

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

  async fetchJSON(
    url: string | URL,
    args?: RequestInit,
    loader?: Loader,
  ): Promise<CardDocument | undefined> {
    loader = loader ?? this.loaderService.loader;
    let response = await loader.fetch(url, {
      headers: { Accept: SupportedMimeType.CardJson },
      ...args,
    });
    if (!response.ok) {
      let err = new Error(
        `status: ${response.status} -
        ${response.statusText}. ${await response.text()}`,
      );
      (err as any).status = response.status;
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
    relativeTo: URL | undefined,
    loader?: Loader,
  ): Promise<CardDef> {
    loader = loader ?? this.loaderService.loader;
    let api = await this.getAPI.perform(loader);
    let card = await api.createFromSerialized(
      resource,
      doc,
      relativeTo,
      loader,
    );
    // it's important that we absorb the field async here so that glimmer won't
    // encounter NotReady errors, since we don't have the luxury of the indexer
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
    loader?: Loader,
  ): Promise<LooseSingleCardDocument> {
    let api = await this.getAPI.perform(loader);
    let serialized = api.serializeCard(card, opts);
    delete serialized.included;
    return serialized;
  }

  // we return undefined if the card changed locally while the save was in-flight
  async saveModel<T extends object>(
    owner: T,
    card: CardDef,
    loader?: Loader,
  ): Promise<CardDef | undefined> {
    let cardChanged = false;
    function onCardChange() {
      cardChanged = true;
    }
    loader = loader ?? this.loaderService.loader;
    let api = await this.getAPI.perform(loader);
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
      let maybeRealmUrl = await this.getRealmURL(card);
      let json = await this.saveCardDocument(doc, maybeRealmUrl);
      let realmURL = new URL(json.data.meta.realmURL!);
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
      if (isNew && result) {
        result = trackCard(owner, result, realmURL);
      }
      if (this.subscriber) {
        this.subscriber(json);
      }
      return result;
    } catch (err) {
      // TODO for CS-6268 we'll need to show a visual indicator that the auto
      // save has failed. Until that ticket is implemented, the only indication
      // of a failed auto-save will be from the console.
      console.error(`Failed to save ${card.id}: `, err);
      return;
    } finally {
      api.unsubscribeFromChanges(card, onCardChange);
    }
  }

  async saveSource(url: URL, content: string, loader?: Loader) {
    loader = loader ?? this.loaderService.loader;
    let response = await loader.fetch(url, {
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
    this.subscriber?.(content);
    return response;
  }

  // we return undefined if the card changed locally while the save was in-flight
  async patchCard(
    card: CardDef,
    doc: LooseSingleCardDocument,
    loader?: Loader,
  ): Promise<CardDef | undefined> {
    let api = await this.getAPI.perform(loader);
    let updatedCard = await api.updateFromSerialized<typeof CardDef>(card, doc);
    // TODO setting `this` as an owner until we can have a better solution here...
    // (currently only used by the AI bot to patch cards from chat)
    return await this.saveModel(this, updatedCard);
  }

  private async saveCardDocument(
    doc: LooseSingleCardDocument,
    realmUrl?: URL,
  ): Promise<SingleCardDocument> {
    let isSaved = !!doc.data.id;
    let json = await this.fetchJSON(
      doc.data.id ?? realmUrl ?? this.defaultURL,
      {
        method: isSaved ? 'PATCH' : 'POST',
        body: JSON.stringify(doc, null, 2),
      },
    );
    if (!isSingleCardDocument(json)) {
      throw new Error(
        `bug: arg is not a card document:
        ${JSON.stringify(json, null, 2)}`,
      );
    }
    return json;
  }

  async copyCard(
    source: CardDef,
    destinationRealm: URL,
    loader?: Loader,
  ): Promise<CardDef> {
    loader = loader ?? this.loaderService.loader;
    let api = await this.getAPI.perform(loader);
    let serialized = await this.serializeCard(source, {
      maybeRelativeURL: null, // forces URL's to be absolute.
    });
    delete serialized.data.id;
    let json = await this.saveCardDocument(serialized, destinationRealm);
    let result = (await api.createFromSerialized(
      json.data,
      json,
      new URL(json.data.id),
      loader,
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
    let collectionDoc = json;
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
  }

  async getFields(
    cardOrField: BaseDef,
    loader?: Loader,
  ): Promise<{ [fieldName: string]: Field<typeof BaseDef> }> {
    let api = await this.getAPI.perform(loader);
    return api.getFields(cardOrField, { includeComputeds: true });
  }

  async isPrimitive(card: typeof FieldDef, loader?: Loader): Promise<boolean> {
    let api = await this.getAPI.perform(loader);
    return api.primitive in card;
  }

  async getRealmInfo(
    card: CardDef,
    loader?: Loader,
  ): Promise<RealmInfo | undefined> {
    let api = await this.getAPI.perform(loader);
    return card[api.realmInfo];
  }

  async getRealmURL(card: CardDef, loader?: Loader): Promise<URL | undefined> {
    let api = await this.getAPI.perform(loader);
    return card[api.realmURL];
  }

  async cardsSettled(loader?: Loader) {
    let api = await this.getAPI.perform(loader);
    await api.flushLogs();
  }

  getRealmURLFor(url: URL) {
    let realmURLS = new Set([ownRealmURL, ...otherRealmURLs]);
    for (let realmURL of realmURLS) {
      let path = new RealmPaths(realmURL);
      if (path.inRealm(url)) {
        return new URL(realmURL);
      }
    }
    return undefined;
  }

  async getRealmInfoByRealmURL(
    realmURL: URL,
    loader?: Loader,
  ): Promise<RealmInfo> {
    loader = loader ?? this.loaderService.loader;
    let response = await loader.fetch(`${realmURL}_info`, {
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
