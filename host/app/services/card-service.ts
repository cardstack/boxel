import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import LoaderService from './loader-service';
import LocalRealm from '../services/local-realm';
import {
  isSingleCardDocument,
  LooseSingleCardDocument,
} from '@cardstack/runtime-common';
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
    return await this.api.createFromSerialized(json.data, this.localRealm.url, {
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
    return await this.api.createFromSerialized(json.data, this.localRealm.url, {
      loader: this.loaderService.loader,
    });
  }

  async createNewInstance(doc: LooseSingleCardDocument): Promise<Card> {
    if (!this.api) {
      this.api = await this.loadAPI();
    }
    return await this.api.createFromSerialized(doc.data, this.localRealm.url, {
      loader: this.loaderService.loader,
    });
  }
}
