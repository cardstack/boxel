import { service } from '@ember/service';

import { isCardInstance } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmService from '../services/realm';
import type StoreService from '../services/store';

export default class SetInteractHomeCommand extends HostBaseCommand<
  typeof BaseCommandModule.CardIdCard,
  undefined
> {
  @service declare private realm: RealmService;
  @service declare private store: StoreService;
  @service declare private operatorModeStateService: OperatorModeStateService;

  static actionVerb = 'Set';
  description = "Sets the current realm's interact home site config card";

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

    let normalizedCardId = cardURL.href.replace(/\.json$/, '');
    await this.realm.setInteractHome(realmHref, normalizedCardId);
    await this.operatorModeStateService.applyInteractHome(realmHref, {
      sourceCardId: normalizedCardId,
    });

    return undefined;
  }
}
