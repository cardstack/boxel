import { service } from '@ember/service';

import { Command, baseRealm } from '@cardstack/runtime-common';

import { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import type OperatorModeStateService from '../services/operator-mode-state-service';
import type LoaderService from '../services/loader-service';

export default class ShowCardCommand extends Command<
  BaseCommandModule.SwitchSubmodeInput,
  undefined
> {
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare loaderService: LoaderService;

  description = 'Show a card in the UI';

  async getInputType() {
    let commandModule = await this.loaderService.loader.import<
      typeof BaseCommandModule
    >(`${baseRealm.url}command`);
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
