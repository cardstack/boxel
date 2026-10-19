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
    let { model, mode } = await checkActiveLLMInput(
      this.matrixService,
      input.roomId,
      input,
    );
    if (model) {
      await this.matrixService.sendActiveLLMEvent(input.roomId, model);
    }
    if (mode) {
      await this.matrixService.sendLLMModeEvent(input.roomId, mode);
    }
    return undefined;
  }
}

// Checks a model and a mode before any of them is sent, so that a refused
// call changes nothing. `roomId` is undefined for a room that does not exist
// yet. Returns the model trimmed.
export async function checkActiveLLMInput(
  matrixService: MatrixService,
  roomId: string | undefined,
  input: { model?: string; mode?: string },
): Promise<{ model?: string; mode?: 'act' | 'ask' }> {
  // The room reads any value other than 'act' as Ask. A model that mixes
  // this up with the submode (GPT-5.4 Mini sent 'code') would switch the
  // room out of Act mode and then wait on its own patches for approval.
  let mode = input.mode || undefined;
  if (mode !== undefined && mode !== 'act' && mode !== 'ask') {
    throw new Error(
      `mode must be "act" or "ask", got "${mode}". To open code mode, use switch-submode instead.`,
    );
  }
  // Only the models the room's model picker offers, so no caller can put the
  // room on a model the user could not pick by hand.
  let model = input.model?.trim() || undefined;
  if (model) {
    let known = await matrixService.pickableModelIds(roomId);
    if (!known.includes(model)) {
      throw new Error(
        `Unknown model: ${model}. Models this room can use: ${known.join(', ')}`,
      );
    }
  }
  return { model, mode };
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { SetActiveLLMTool as SetActiveLLMCommand };
