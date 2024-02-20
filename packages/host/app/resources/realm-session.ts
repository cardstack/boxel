import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-resources';

import { type JWTPayload } from '@cardstack/runtime-common';

import type CardService from '@cardstack/host/services/card-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type SessionService from '@cardstack/host/services/session';

import type { CardDef } from 'https://cardstack.com/base/card-api';

interface Args {
  named: {
    realmURL?: URL;
    card?: CardDef;
  };
}

export class RealmSessionResource extends Resource<Args> {
  @tracked loaded: Promise<void> | undefined;
  @tracked realmURL: Promise<URL> | undefined;

  @tracked private token: JWTPayload | undefined;
  @service private declare matrixService: MatrixService;
  @service private declare cardService: CardService;
  @service private declare session: SessionService;
  private rawToken: string | undefined;

  modify(_positional: never[], named: Args['named']) {
    let { realmURL, card } = named;
    if (!realmURL && !card) {
      throw new Error(
        `must provide either a realm URL or a card in order to get RealmSessionResource`,
      );
    }
    this.token = undefined;
    if (realmURL) {
      this.realmURL = Promise.resolve(realmURL);
      this.loaded = this.getSession.perform();
    } else if (card) {
      this.loaded = this.getTokenForRealmOfCard.perform(card);
    }
  }

  get canRead() {
    return this.token?.permissions?.includes('read');
  }

  get canWrite() {
    return this.token?.permissions?.includes('write');
  }

  get rawRealmToken() {
    return this.rawToken;
  }

  private getSession = restartableTask(async () => {
    let { rawToken, token } = (await this.session.loadSession(this)) ?? {};
    if (rawToken && token) {
      this.token = token;
      this.rawToken = rawToken;
    }
  });

  private getTokenForRealmOfCard = restartableTask(async (card: CardDef) => {
    this.realmURL = this.cardService.getRealmURL(card);
    await this.realmURL;
    await this.getSession.perform();
  });
}

export function getRealmSession(
  parent: object,
  {
    realmURL,
    card,
  }: {
    // a realm resource can either be loaded by RealmURL directly, or by the
    // realm URL associated with the provided card
    realmURL?: () => URL;
    card?: () => CardDef;
  },
) {
  return RealmSessionResource.from(parent, () => ({
    realmURL: realmURL?.(),
    card: card?.(),
  })) as RealmSessionResource;
}
