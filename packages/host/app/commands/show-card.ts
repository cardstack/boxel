import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type OperatorModeStateService from '../services/operator-mode-state-service';

export default class ShowCardCommand extends HostBaseCommand<
  typeof BaseCommandModule.CardIdCard
> {
  @service declare private operatorModeStateService: OperatorModeStateService;

  description =
    'Show a card in the UI. The cardId mush be a fully qualified URL.';

  static actionVerb = 'Show Card';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CardIdCard } = commandModule;
    return CardIdCard;
  }

  protected async run(input: BaseCommandModule.CardIdCard): Promise<undefined> {
    if (this.operatorModeStateService.state?.submode != 'interact') {
      // switch to interact mode
      this.operatorModeStateService.updateSubmode('interact');
    }
    let newStackIndex = Math.min(
      this.operatorModeStateService.numberOfStacks(),
      1,
    );
    let newStackItem = await this.operatorModeStateService.createStackItem(
      input.cardId,
      newStackIndex,
    );
    this.operatorModeStateService.addItemToStack(newStackItem);
  }
}
