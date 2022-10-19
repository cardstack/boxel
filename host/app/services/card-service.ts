import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { stringify } from 'qs';
import LoaderService from './loader-service';
import LocalRealm from '../services/local-realm';
import {
  LooseSingleCardDocument,
  isSingleCardDocument,
  isCardCollectionDocument,
} from '@cardstack/runtime-common';
import type { ResolvedURL } from '@cardstack/runtime-common/loader';
import type { Query } from '@cardstack/runtime-common/query';
import type { Card } from 'https://cardstack.com/base/card-api';

type CardAPI = typeof import('https://cardstack.com/base/card-api');

export default class CardService extends Service {
  @service declare loaderService: LoaderService;
  @service declare localRealm: LocalRealm;
  @tracked api: CardAPI | undefined;

  private async loadAPI() {
    return await this.loaderService.loader.import<CardAPI>(
      'https://cardstack.com/base/card-api'
    );
  }

  async loadCard(url: string | undefined): Promise<Card | undefined> {
    if (!url) {
      return;
    }
    let response = await this.loaderService.loader.fetch(url, {
      headers: {
        Accept: 'application/vnd.api+json',
      },
    });
    let json = await response.json();
    if (!isSingleCardDocument(json)) {
      throw new Error(
        `bug: server returned a non card document to us for ${url}`
      );
    }
    if (!this.api) {
      this.api = await this.loadAPI();
    }
    return await this.api.createFromSerialized(json, this.localRealm.url, {
      loader: this.loaderService.loader,
    });
  }

  async saveCard(card: Card): Promise<Card> {
    let method = card.id ? 'PATCH' : 'POST';
    let url = card.id ?? this.localRealm.url;
    if (!this.api) {
      this.api = await this.loadAPI();
    }
    let cardJSON = this.api.serializeCard(card, { includeComputeds: true });
    let response = await this.loaderService.loader.fetch(url, {
      method,
      headers: {
        Accept: 'application/vnd.api+json',
      },
      body: JSON.stringify(cardJSON, null, 2),
    });

    if (!response.ok) {
      throw new Error(
        `could not save file, status: ${response.status} - ${
          response.statusText
        }. ${await response.text()}`
      );
    }
    let json = await response.json();
    return await this.api.createFromSerialized(json, this.localRealm.url, {
      loader: this.loaderService.loader,
    });
  }

  async createNewInstance(doc: LooseSingleCardDocument): Promise<Card> {
    if (!this.api) {
      this.api = await this.loadAPI();
    }
    return await this.api.createFromSerialized(doc, this.localRealm.url, {
      loader: this.loaderService.loader,
    });
  }

  async search(query: Query, realmURL: string | ResolvedURL): Promise<Card[]> {
    let response = await this.loaderService.loader.fetch(
      `${realmURL}_search?${stringify(query)}`,
      {
        headers: { Accept: 'application/vnd.api+json' },
      }
    );
    if (!response.ok) {
      throw new Error(
        `Could not load card for query ${stringify(query)}: ${
          response.status
        } - ${await response.text()}`
      );
    }
    let json = await response.json();
    if (!isCardCollectionDocument(json)) {
      throw new Error(
        `The realm search response was not a card collection document: ${JSON.stringify(
          json,
          null,
          2
        )}`
      );
    }
    if (!this.api) {
      this.api = await this.loadAPI();
    }
    return await Promise.all(
      json.data.map(async (doc) => {
        return await this.api!.createFromSerialized(
          { data: doc },
          this.localRealm.url,
          {
            loader: this.loaderService.loader,
          }
        );
      })
    );
  }
}
