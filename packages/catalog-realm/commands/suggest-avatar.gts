import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import UseAiAssistantCommand from '@cardstack/boxel-host/commands/ai-assistant';
import SetActiveLLMCommand from '@cardstack/boxel-host/commands/set-active-llm';
import { Command } from '@cardstack/runtime-common';

class SuggestAvatarInput extends CardDef {
  @field name = contains(StringField, {
    description: 'Name to use for the avatar suggestion room',
  });
}

export class SuggestAvatar extends Command<
  typeof SuggestAvatarInput,
  undefined
> {
  static actionVerb = 'Generate';
  static displayName = 'Suggest Avatar';

  async getInputType() {
    return SuggestAvatarInput;
  }

  protected async run(input: SuggestAvatarInput): Promise<undefined> {
    let { name } = input;

    try {
      let useAiAssistantCommand = new UseAiAssistantCommand(
        this.commandContext,
      );
      let result = await useAiAssistantCommand.execute({
        roomName: `Avatar Suggestions: ${name || 'Unnamed Avatar'}`,
        openRoom: true,
        prompt: `Please suggest two example avatar prompts: one describing a visual style and one referencing a celebrity's look. Then ask if these examples are helpful or if different suggestions are needed.`,
      });

      if (result.roomId) {
        let setActiveLLMCommand = new SetActiveLLMCommand(this.commandContext);
        await setActiveLLMCommand.execute({
          roomId: result.roomId,
          mode: 'ask',
        });
      }
    } catch (error: any) {
      throw new Error(`❌ Failed to suggest avatar: ${error.message}`);
    }
  }
}
