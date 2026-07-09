import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type MatrixService from '../services/matrix-service';

export default class SetActiveLLMTool extends HostBaseTool<
  typeof BaseCommandModule.SetActiveLLMInput,
  undefined
> {
  @service declare private matrixService: MatrixService;

  static actionVerb = 'Set';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { SetActiveLLMInput } = commandModule;
    return SetActiveLLMInput;
  }

  requireInputFields = ['roomId'];

  protected async run(
    input: BaseCommandModule.SetActiveLLMInput,
  ): Promise<undefined> {
    if (input.model) {
      await this.matrixService.sendActiveLLMEvent(input.roomId, input.model);
    }
    if (input.mode) {
      await this.matrixService.sendLLMModeEvent(
        input.roomId,
        input.mode as 'act' | 'ask',
      );
    }
    return undefined;
  }
}
