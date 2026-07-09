import { service } from '@ember/service';

import type { Format } from '@cardstack/runtime-common';

import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type OperatorModeStateService from '../services/operator-mode-state-service';

export default class OpenInInteractModeTool extends HostBaseTool<
  typeof BaseToolModule.ShowCardInput
> {
  @service declare private operatorModeStateService: OperatorModeStateService;

  description =
    'Show a card in interact submode, with no other stacks open. The cardId must be a fully qualified URL.';

  static actionVerb = 'Open Card';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { ShowCardInput } = commandModule;
    return ShowCardInput;
  }

  requireInputFields = ['cardId'];

  protected async run(input: BaseToolModule.ShowCardInput): Promise<undefined> {
    let { operatorModeStateService } = this;
    let format = (input.format ?? 'isolated') as Format;
    operatorModeStateService.openCardInInteractMode(input.cardId, format);
  }
}
