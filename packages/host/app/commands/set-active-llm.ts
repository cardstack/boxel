import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type MatrixService from '../services/matrix-service';

export class SetActiveLLMCommand extends HostBaseCommand<
  typeof BaseCommandModule.SetActiveLLMInput,
  undefined
> {
  @service private declare matrixService: MatrixService;

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { SetActiveLLMInput } = commandModule;
    return SetActiveLLMInput;
  }

  protected async run(
    input: BaseCommandModule.SetActiveLLMInput,
  ): Promise<undefined> {
    await this.matrixService.sendActiveLLMEvent(input.roomId, input.model);
    return undefined;
  }
}

export default SetActiveLLMCommand;
