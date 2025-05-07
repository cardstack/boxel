import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import { Submodes } from '../components/submode-switcher';

import HostBaseCommand from '../lib/host-base-command';

import type OperatorModeStateService from '../services/operator-mode-state-service';
import type StoreService from '../services/store';

export default class SwitchSubmodeCommand extends HostBaseCommand<
  typeof BaseCommandModule.SwitchSubmodeInput
> {
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private store: StoreService;

  description =
    'Navigate the UI to another submode. Possible values for submode are "interact" and "code".';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { SwitchSubmodeInput } = commandModule;
    return SwitchSubmodeInput;
  }

  private get allStackItems() {
    return this.operatorModeStateService.state?.stacks.flat() ?? [];
  }

  private get lastCardInRightMostStack() {
    if (this.allStackItems.length <= 0) {
      return null;
    }

    return this.store.peek(this.allStackItems[this.allStackItems.length - 1].id)
      ?.id;
  }

  protected async run(
    input: BaseCommandModule.SwitchSubmodeInput,
  ): Promise<undefined> {
    switch (input.submode) {
      case Submodes.Interact:
        this.operatorModeStateService.updateCodePath(null);
        break;
      case Submodes.Code:
        if (input.codePath) {
          this.operatorModeStateService.updateCodePath(new URL(input.codePath));
        } else {
          this.operatorModeStateService.updateCodePath(
            this.lastCardInRightMostStack
              ? new URL(this.lastCardInRightMostStack + '.json')
              : null,
          );
        }
        break;
      default:
        throw new Error(`invalid submode specified: ${input.submode}`);
    }

    this.operatorModeStateService.updateSubmode(input.submode);
  }
}
