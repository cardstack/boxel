import { service } from '@ember/service';

import type { Format, StoreReadType } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type OperatorModeStateService from '../services/operator-mode-state-service';

export default class OpenInInteractModeCommand extends HostBaseCommand<
  typeof BaseCommandModule.ShowCardInput
> {
  @service declare private operatorModeStateService: OperatorModeStateService;

  description =
    'Show a card in interact submode, with no other stacks open. The cardId must be a fully qualified URL.';

  static actionVerb = 'Open Card';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { ShowCardInput } = commandModule;
    return ShowCardInput;
  }

  requireInputFields = ['cardId'];

  protected async run(
    input: BaseCommandModule.ShowCardInput,
  ): Promise<undefined> {
    let { operatorModeStateService } = this;
    let format = (input.format ?? 'isolated') as Format;
    let readType =
      input.readType === 'file-meta'
        ? ('file-meta' as StoreReadType)
        : undefined;
    operatorModeStateService.openCardInInteractMode(
      input.cardId,
      format,
      readType,
    );
  }
}
