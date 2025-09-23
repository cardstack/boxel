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
        prompt:
          'Please edit the following card with an avatar based upon params of https://getavataaars.com/. The params supported are: topType, accessoriesType, hairColor, facialHairType, clotheType, eyeType, eyebrowType, mouthType and skinColor.',
      });

      if (result.roomId) {
        let setActiveLLMCommand = new SetActiveLLMCommand(this.commandContext);
        await setActiveLLMCommand.execute({
          roomId: result.roomId,
          mode: 'act',
        });
      }
    } catch (error: any) {
      throw new Error(`❌ Failed to suggest avatar: ${error.message}`);
    }
  }
}
