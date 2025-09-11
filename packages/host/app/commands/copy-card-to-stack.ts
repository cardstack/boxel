import { service } from '@ember/service';

import { isCardInstance, realmURL } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import CopyCardToRealmCommand from './copy-card';

import type CardService from '../services/card-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmService from '../services/realm';
import type StoreService from '../services/store';

export default class CopyCardToStackCommand extends HostBaseCommand<
  typeof BaseCommandModule.CopyCardToStackInput,
  typeof BaseCommandModule.CopyCardResult
> {
  @service declare private cardService: CardService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;
  @service declare private store: StoreService;

  description = 'Copy a card to a stack';
  static actionVerb = 'Copy';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CopyCardToStackInput } = commandModule;
    return CopyCardToStackInput;
  }

  requireInputFields = ['sourceCard', 'targetStackIndex'];

  protected async run(
    input: BaseCommandModule.CopyCardToStackInput,
  ): Promise<BaseCommandModule.CopyCardResult> {
    let realmToCopyTo = await this.determineTargetRealm(input.targetStackIndex);
    if (!realmToCopyTo) {
      throw new Error('Cannot determine target realm to copy card to');
    }
    let copyCardToRealmCommand = new CopyCardToRealmCommand(
      this.commandContext,
    );
    return await copyCardToRealmCommand.execute({
      sourceCard: input.sourceCard,
      targetRealm: realmToCopyTo,
    });
  }

  private async determineTargetRealm(targetStackIndex: number) {
    let item =
      this.operatorModeStateService.topMostStackItems()[targetStackIndex];
    if (!item) {
      throw new Error('Cannot find topmost card in target stack');
    }
    if (!item.id) {
      throw new Error('Topmost item in target stack has no id');
    }
    let topCard = await this.store.get(item.id);
    if (isCardInstance(topCard)) {
      let url = topCard[realmURL];
      if (url) {
        return url.href;
      }
    }
    return;
  }
}
