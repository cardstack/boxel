import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import CreateAiAssistantRoomCommand from './create-ai-assistant-room';
import OpenAiAssistantRoomCommand from './open-ai-assistant-room';
import SendAiAssistantMessageCommand from './send-ai-assistant-message';

import type MatrixService from '../services/matrix-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';

export default class AskAiCommand extends HostBaseCommand<
  typeof BaseCommandModule.AskAiInput,
  typeof BaseCommandModule.AskAiOutput
> {
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;

  static actionVerb = 'Ask';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { AskAiInput } = commandModule;
    return AskAiInput;
  }

  protected async run(
    input: BaseCommandModule.AskAiInput,
  ): Promise<BaseCommandModule.AskAiOutput> {
    let createRoomCommand = new CreateAiAssistantRoomCommand(
      this.commandContext,
    );
    let openRoomCommand = new OpenAiAssistantRoomCommand(this.commandContext);
    let sendMessageCommand = new SendAiAssistantMessageCommand(
      this.commandContext,
    );

    let [skills, openCards] = await Promise.all([
      this.matrixService.loadDefaultSkills('code') || Promise.resolve([]),
      this.operatorModeStateService.getOpenCards.perform() ||
        Promise.resolve([]),
    ]);
    let { roomId } = await createRoomCommand.execute({
      name: 'AI App Generator Assistant',
      enabledSkills: skills,
      llmMode: input.llmMode,
    });
    sendMessageCommand.execute({
      roomId,
      prompt: input.prompt,
      attachedCards: openCards,
      openCardIds: openCards?.map((c: any) => c.id),
      realmUrl: this.operatorModeStateService.realmURL,
    });

    await openRoomCommand.execute({ roomId });

    // Import AskAiOutput from the base command module
    const commandModule = await this.loadCommandModule();
    return new commandModule.AskAiOutput({
      response:
        'AI assistant room created and opened successfully. You can now interact with the AI assistant.',
    });
  }
}
