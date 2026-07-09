import { service } from '@ember/service';

import { isCardInstance, realmURL } from '@cardstack/runtime-common';

import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import CopyCardToRealmTool from './copy-card';

import type CardService from '../services/card-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmService from '../services/realm';
import type StoreService from '../services/store';

export default class CopyCardToStackTool extends HostBaseTool<
  typeof BaseToolModule.CopyCardToStackInput,
  typeof BaseToolModule.CopyCardResult
> {
  @service declare private cardService: CardService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;
  @service declare private store: StoreService;

  description = 'Copy a card to a stack';
  static actionVerb = 'Copy';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { CopyCardToStackInput } = commandModule;
    return CopyCardToStackInput;
  }

  requireInputFields = ['sourceCard', 'targetStackIndex'];

  protected async run(
    input: BaseToolModule.CopyCardToStackInput,
  ): Promise<BaseToolModule.CopyCardResult> {
    let realmToCopyTo = await this.determineTargetRealm(input.targetStackIndex);
    if (!realmToCopyTo) {
      throw new Error('Cannot determine target realm to copy card to');
    }
    let copyCardToRealmCommand = new CopyCardToRealmTool(this.commandContext);
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

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { CopyCardToStackTool as CopyCardToStackCommand };
