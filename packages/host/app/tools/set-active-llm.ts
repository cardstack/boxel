import { service } from '@ember/service';

import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type MatrixService from '../services/matrix-service';

export default class SetActiveLLMTool extends HostBaseTool<
  typeof BaseToolModule.SetActiveLLMInput,
  undefined
> {
  @service declare private matrixService: MatrixService;

  static actionVerb = 'Set';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { SetActiveLLMInput } = commandModule;
    return SetActiveLLMInput;
  }

  requireInputFields = ['roomId'];

  protected async run(
    input: BaseToolModule.SetActiveLLMInput,
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

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { SetActiveLLMTool as SetActiveLLMCommand };
