import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type AiAssistantPanelService from '../services/ai-assistant-panel-service';
import type MatrixService from '../services/matrix-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';

export default class OpenAiAssistantRoomCommand extends HostBaseCommand<
  typeof BaseCommandModule.OpenAiAssistantRoomInput
> {
  @service declare private aiAssistantPanelService: AiAssistantPanelService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private matrixService: MatrixService;

  static actionVerb = 'Open';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { OpenAiAssistantRoomInput } = commandModule;
    return OpenAiAssistantRoomInput;
  }

  requireInputFields = ['roomId'];

  protected async run(
    input: BaseCommandModule.OpenAiAssistantRoomInput,
  ): Promise<undefined> {
    if (input.roomId) {
      this.operatorModeStateService.openAiAssistant();
      this.matrixService.currentRoomId = input.roomId;
    } else {
      await this.aiAssistantPanelService.openPanel();
    }
  }
}
