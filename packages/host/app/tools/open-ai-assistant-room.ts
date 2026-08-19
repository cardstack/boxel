import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';

import type AiAssistantPanelService from '../services/ai-assistant-panel-service';
import type MatrixService from '../services/matrix-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type * as BaseToolModule from '@cardstack/base/command';

export default class OpenAiAssistantRoomTool extends HostBaseTool<
  typeof BaseToolModule.OpenAiAssistantRoomInput
> {
  @service declare private aiAssistantPanelService: AiAssistantPanelService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private matrixService: MatrixService;

  static actionVerb = 'Open';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { OpenAiAssistantRoomInput } = commandModule;
    return OpenAiAssistantRoomInput;
  }

  requireInputFields = ['roomId'];

  protected async run(
    input: BaseToolModule.OpenAiAssistantRoomInput,
  ): Promise<undefined> {
    if (input.roomId) {
      this.operatorModeStateService.openAiAssistant();
      this.matrixService.currentRoomId = input.roomId;
    } else {
      await this.aiAssistantPanelService.openPanel();
    }
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { OpenAiAssistantRoomTool as OpenAiAssistantRoomCommand };
