import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';

import type MatrixService from '../services/matrix-service';
import type * as BaseToolModule from '@cardstack/base/command';

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
    // The room reads any value other than 'act' as Ask. A model that mixes
    // this up with the submode (GPT-5.4 Mini sent 'code') would switch the
    // room out of Act mode and then wait on its own patches for approval.
    // Validate before either event is sent so a rejected call cannot partially
    // change the active model.
    if (input.mode && input.mode !== 'act' && input.mode !== 'ask') {
      throw new Error(
        `mode must be "act" or "ask", got "${input.mode}". To open code mode, use switch-submode instead.`,
      );
    }
    // Only the models the room's model picker offers, so no caller can put
    // the room on a model the user could not pick by hand.
    if (input.model) {
      let known = this.matrixService.pickableModelIds(input.roomId);
      if (!known.includes(input.model)) {
        throw new Error(
          `Unknown model: ${input.model}. Models this room can use: ${known.join(', ')}`,
        );
      }
    }
    if (input.model) {
      await this.matrixService.sendActiveLLMEvent(input.roomId, input.model);
    }
    if (input.mode === 'act' || input.mode === 'ask') {
      await this.matrixService.sendLLMModeEvent(input.roomId, input.mode);
    }
    return undefined;
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { SetActiveLLMTool as SetActiveLLMCommand };
