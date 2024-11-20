import { service } from '@ember/service';

import { Command, baseRealm } from '@cardstack/runtime-common';

import { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import { Submodes } from '../components/submode-switcher';

import type LoaderService from '../services/loader-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';

export default class SwitchSubmodeCommand extends Command<
  BaseCommandModule.SwitchSubmodeInput,
  undefined
> {
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare loaderService: LoaderService;

  description =
    'Navigate the UI to another submode. Possible values for submode are "interact" and "code".';

  async getInputType() {
    let commandModule = await this.loaderService.loader.import<
      typeof BaseCommandModule
    >(`${baseRealm.url}command`);
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
        this.operatorModeStateService.updateCodePath(
          this.lastCardInRightMostStack
            ? new URL(this.lastCardInRightMostStack.id + '.json')
            : null,
        );
        break;
      default:
        throw new Error(`invalid submode specified: ${input.submode}`);
    }

    this.operatorModeStateService.updateSubmode(input.submode);
  }
}
