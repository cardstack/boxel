import { service } from '@ember/service';

import { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import { Submodes } from '../components/submode-switcher';

import HostBaseCommand from '../lib/host-base-command';

import type OperatorModeStateService from '../services/operator-mode-state-service';

export default class SwitchSubmodeCommand extends HostBaseCommand<
  BaseCommandModule.SwitchSubmodeInput,
  undefined
> {
  @service private declare operatorModeStateService: OperatorModeStateService;

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

  private get lastCardInRightMostStack(): CardDef | null {
    if (this.allStackItems.length <= 0) {
      return null;
    }

    return this.allStackItems[this.allStackItems.length - 1].card;
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
              ? new URL(this.lastCardInRightMostStack.id + '.json')
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
