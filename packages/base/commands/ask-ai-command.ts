import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { Command } from '@cardstack/runtime-common';
import CreateAiAssistantRoomCommand from '@cardstack/boxel-host/commands/create-ai-assistant-room';
import OpenAiAssistantRoomCommand from '@cardstack/boxel-host/commands/open-ai-assistant-room';
import AddSkillsToRoomCommand from '@cardstack/boxel-host/commands/add-skills-to-room';
import SendAiAssistantMessageCommand from '@cardstack/boxel-host/commands/send-ai-assistant-message';

export class AskAiInput extends CardDef {
  @field prompt = contains(StringField);
}

export default class AskAiCommand extends Command<
  typeof AskAiInput,
  typeof CardDef
> {
  static actionVerb = 'Ask';
  inputType = AskAiInput;

  protected async run(input: AskAiInput): Promise<CardDef> {
    let createRoomCommand = new CreateAiAssistantRoomCommand(
      this.commandContext,
    );
    let openRoomCommand = new OpenAiAssistantRoomCommand(this.commandContext);
    let addSkillsCommand = new AddSkillsToRoomCommand(this.commandContext);
    let sendMessageCommand = new SendAiAssistantMessageCommand(
      this.commandContext,
    );

    let [{ roomId }, skills, openCards] = await Promise.all([
      createRoomCommand.execute({ name: 'AI App Generator Assistant' }),
      this.commandContext.matrixService?.loadDefaultSkills('interact') ||
        Promise.resolve([]),
      this.commandContext.operatorModeStateService?.getOpenCards.perform() ||
        Promise.resolve([]),
    ]);

    await Promise.all([
      addSkillsCommand.execute({ roomId, skills }),
      sendMessageCommand.execute({
        roomId,
        prompt: input.prompt,
        attachedCards: openCards,
        openCardIds: openCards?.map((c) => c.id),
        realmUrl: this.commandContext.operatorModeStateService?.realmURL?.href,
      }),
    ]);

    await openRoomCommand.execute({ roomId });

    return new CardDef();
  }

  async getInputType() {
    return AskAiInput;
  }
}
