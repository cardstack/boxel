import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';

import CreateAiAssistantRoomTool from './create-ai-assistant-room';
import OpenAiAssistantRoomTool from './open-ai-assistant-room';
import SendAiAssistantMessageTool from './send-ai-assistant-message';

import type MatrixService from '../services/matrix-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type * as BaseToolModule from '@cardstack/base/command';

export default class AskAiTool extends HostBaseTool<
  typeof BaseToolModule.AskAiInput,
  typeof BaseToolModule.AskAiOutput
> {
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;

  static actionVerb = 'Ask';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { AskAiInput } = commandModule;
    return AskAiInput;
  }

  protected async run(
    input: BaseToolModule.AskAiInput,
  ): Promise<BaseToolModule.AskAiOutput> {
    let createRoomCommand = new CreateAiAssistantRoomTool(this.toolContext);
    let openRoomCommand = new OpenAiAssistantRoomTool(this.toolContext);
    let sendMessageCommand = new SendAiAssistantMessageTool(this.toolContext);

    let [skillIds, openCards] = await Promise.all([
      this.matrixService.loadDefaultSkills('code') || Promise.resolve([]),
      this.operatorModeStateService.getOpenCards.perform() ||
        Promise.resolve([]),
    ]);
    let { roomId } = await createRoomCommand.execute({
      name: 'AI App Generator Assistant',
      enabledSkillIds: skillIds,
      llmMode: input.llmMode,
    });
    await sendMessageCommand.execute({
      roomId,
      prompt: input.prompt,
      attachedCards: openCards,
      openCardIds: openCards?.map((c: any) => c.id),
      realmIdentifier: this.operatorModeStateService.realmURL,
    });

    await openRoomCommand.execute({ roomId });

    let commandModule = await this.loadToolModule();
    return new commandModule.AskAiOutput({
      response:
        'AI assistant room created and opened successfully. You can now interact with the AI assistant.',
    });
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { AskAiTool as AskAiCommand };
