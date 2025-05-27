import { service } from '@ember/service';

import { identifyCard, internalKeyFor } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type OperatorModeStateService from '../services/operator-mode-state-service';
import type PlaygroundPanelService from '../services/playground-panel-service';
import type StoreService from '../services/store';

export default class ShowCardCommand extends HostBaseCommand<
  typeof BaseCommandModule.CardIdInput
> {
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private playgroundPanelService: PlaygroundPanelService;
  @service declare private store: StoreService;

  description =
    'Show a card in the UI. The cardId mush be a fully qualified URL.';

  static actionVerb = 'Show Card';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CardIdInput } = commandModule;
    return CardIdInput;
  }

  protected async run(
    input: BaseCommandModule.CardIdInput,
  ): Promise<undefined> {
    let { operatorModeStateService, store } = this;
    if (operatorModeStateService.state?.submode === 'interact') {
      let newStackIndex = Math.min(
        operatorModeStateService.numberOfStacks(),
        1,
      );
      let newStackItem = await operatorModeStateService.createStackItem(
        input.cardId,
        newStackIndex,
      );
      operatorModeStateService.addItemToStack(newStackItem);
    } else if (operatorModeStateService.state?.submode === 'code') {
      let cardInstance = store.peek(input.cardId);
      let cardDefRef = identifyCard(cardInstance.constructor);
      if (
        operatorModeStateService.codePathString?.startsWith(
          cardDefRef.module,
        ) ||
        operatorModeStateService.state.codeSelection !== cardDefRef.name
      ) {
        operatorModeStateService.updateCodePath(new URL(cardDefRef.module));
      }
      this.playgroundPanelService.persistSelections(
        internalKeyFor(cardDefRef),
        input.cardId,
      );
    } else {
      console.error(
        'Unknown submode:',
        this.operatorModeStateService.state?.submode,
      );
    }
  }
}
