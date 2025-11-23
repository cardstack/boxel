import { service } from '@ember/service';

import {
  RealmPaths,
  isCardInstance,
  type LooseCardResource,
} from '@cardstack/runtime-common';
import type { AtomicOperationType } from '@cardstack/runtime-common/atomic-document';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type CardService from '../services/card-service';
import type RealmService from '../services/realm';
import type StoreService from '../services/store';

export default class SetSiteConfigCommand extends HostBaseCommand<
  typeof BaseCommandModule.CardIdCard,
  undefined
> {
  @service declare private cardService: CardService;
  @service declare private realm: RealmService;
  @service declare private store: StoreService;

  static actionVerb = 'Set';
  description = "Sets the current realm's site config card";

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CardIdCard } = commandModule;
    return CardIdCard;
  }

  requireInputFields = ['cardId'];

  protected async run(input: BaseCommandModule.CardIdCard): Promise<undefined> {
    let cardId = input.cardId;
    if (!cardId) {
      throw new Error('cardId is required');
    }

    let cardURL: URL;
    try {
      cardURL = new URL(cardId);
    } catch (_error) {
      throw new Error(`Invalid card id: ${cardId}`);
    }

    let realmURL = this.realm.realmOfURL(cardURL);
    if (!realmURL) {
      throw new Error(`Could not determine realm for ${cardId}`);
    }

    let realmHref = realmURL.href;
    if (!this.realm.canWrite(realmHref)) {
      throw new Error(`Do not have write permissions to ${realmHref}`);
    }

    let siteConfigInstance = await this.store.get(cardId);
    if (!siteConfigInstance || !isCardInstance(siteConfigInstance)) {
      throw new Error(`Could not load site config card: ${cardId}`);
    }

    let serialized = await this.cardService.serializeCard(siteConfigInstance, {
      useAbsoluteURL: true,
      withIncluded: true,
    });

    delete serialized.data.id;
    delete serialized.data.lid;
    let resource = serialized.data as LooseCardResource;

    let realmPaths = new RealmPaths(realmURL);
    let siteConfigURL = realmPaths.fileURL('site.json');
    let operationType: AtomicOperationType = 'add';

    try {
      await this.cardService.fetchJSON(siteConfigURL.href);
      operationType = 'update';
    } catch (error: any) {
      if (error?.status && error.status !== 404) {
        throw error;
      }
    }

    await this.cardService.executeAtomicOperations(
      [
        {
          op: operationType,
          href: siteConfigURL.href,
          data: resource,
        },
      ],
      realmURL,
    );

    return undefined;
  }
}
