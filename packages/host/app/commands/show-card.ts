import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type OperatorModeStateService from '../services/operator-mode-state-service';

export default class ShowCardCommand extends HostBaseCommand<
  BaseCommandModule.ShowCardInput,
  undefined
> {
  @service private declare operatorModeStateService: OperatorModeStateService;

  description = 'Show a card in the UI';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { ShowCardInput } = commandModule;
    return ShowCardInput;
  }

  protected async run(
    input: BaseCommandModule.ShowCardInput,
  ): Promise<undefined> {
    if (this.operatorModeStateService.state?.submode != 'interact') {
      // switch to interact mode
      this.operatorModeStateService.updateSubmode('interact');
    }
    let newStackIndex = Math.min(
      this.operatorModeStateService.numberOfStacks(),
      1,
    );
    let newStackItem = await this.operatorModeStateService.createStackItem(
      input.cardToShow,
      newStackIndex,
    );
    this.operatorModeStateService.addItemToStack(newStackItem);
  }
}
