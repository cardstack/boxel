import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import MatrixService from '../services/matrix-service';
import OperatorModeStateService from '../services/operator-mode-state-service';

export class OpenAiAssistantRoomCommand extends HostBaseCommand<
  typeof BaseCommandModule.OpenAiAssistantRoomInput
> {
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare matrixService: MatrixService;

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { OpenAiAssistantRoomInput } = commandModule;
    return OpenAiAssistantRoomInput;
  }

  protected async run(
    input: BaseCommandModule.OpenAiAssistantRoomInput,
  ): Promise<undefined> {
    this.operatorModeStateService.aiAssistantOpen = true;
    this.matrixService.currentRoomId = input.roomId;
  }
}

export default OpenAiAssistantRoomCommand;
