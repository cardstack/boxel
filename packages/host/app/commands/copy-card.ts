import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type CardService from '../services/card-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmService from '../services/realm';

export default class CopyCardCommand extends HostBaseCommand<
  BaseCommandModule.CopyCardInput,
  BaseCommandModule.CopyCardResult
> {
  @service private declare cardService: CardService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare realm: RealmService;

  description = 'Copy a card to a realm';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CopyCardInput } = commandModule;
    return CopyCardInput;
  }

  protected async run(
    input: BaseCommandModule.CopyCardInput,
  ): Promise<BaseCommandModule.CopyCardResult> {
    const realmUrl = await this.determineTargetRealmUrl(input);
    const newCard = await this.cardService.copyCard(
      input.sourceCard,
      new URL(realmUrl),
    );
    let commandModule = await this.loadCommandModule();
    const { CopyCardResult } = commandModule;
    return new CopyCardResult({ newCard });
  }

  private async determineTargetRealmUrl({
    targetStackIndex,
    targetRealmUrl,
  }: BaseCommandModule.CopyCardInput) {
    if (targetRealmUrl !== undefined && targetStackIndex !== undefined) {
      console.warn(
        'Both targetStackIndex and targetRealmUrl are set; only one should be set; using targetRealmUrl',
      );
    }
    let realmUrl = targetRealmUrl;
    if (realmUrl) {
      return realmUrl;
    }
    if (targetStackIndex !== undefined) {
      // use existing card in stack to determine realm url,
      let topCard =
        this.operatorModeStateService.topMostStackItems()[targetStackIndex]
          ?.card;
      if (topCard) {
        let url = await this.cardService.getRealmURL(topCard);
        // open card might be from a realm in which we don't have write permissions
        if (url && this.realm.canWrite(url.href)) {
          return url.href;
        }
      }
    }
    if (!this.realm.defaultWritableRealm) {
      throw new Error('Could not find a writable realm');
    }
    return this.realm.defaultWritableRealm.path;
  }
}
