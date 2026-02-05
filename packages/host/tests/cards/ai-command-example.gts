import { on } from '@ember/modifier';

import CreateAiAssistantRoomCommand from '@cardstack/boxel-host/commands/create-ai-assistant-room';
import SendAiAssistantMessageCommand from '@cardstack/boxel-host/commands/send-ai-assistant-message';

import { Button } from '@cardstack/boxel-ui/components';
import { CardContainer } from '@cardstack/boxel-ui/components';

import { Command } from '@cardstack/runtime-common';

import {
  CardDef,
  Component,
  StringField,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import { Skill } from 'https://cardstack.com/base/skill';

export class WeatherLocationInput extends CardDef {
  @field location = contains(StringField);
}

export class WeatherReport extends CardDef {
  @field temperature = contains(StringField);
  @field conditions = contains(StringField);
}

export class GetWeatherCommand extends Command<
  typeof WeatherLocationInput,
  typeof WeatherReport
> {
  static actionVerb = 'Retrieve';
  inputType = WeatherLocationInput;

  async getInputType() {
    return WeatherLocationInput;
  }

  protected async run(_input: WeatherLocationInput): Promise<WeatherReport> {
    return new WeatherReport({
      temperature: '25 C',
      conditions: 'Sunny',
    });
  }
}

export class AiCommandExample extends CardDef {
  static displayName = 'AI Command Example';

  @field location = contains(StringField);

  static isolated = class Isolated extends Component<typeof AiCommandExample> {
    getWeather = async () => {
      let commandContext = this.args.context?.commandContext;
      if (!commandContext) {
        throw new Error('No command context found');
      }

      // let getWeatherCommand = new GetWeatherCommand(commandContext);

      let createAIAssistantRoomCommand = new CreateAiAssistantRoomCommand(
        commandContext,
      );
      let weatherSkill = new Skill({
        name: 'Weather Skill',
        cardDescription: 'A skill to get weather information',
        instructions:
          'Use the command to ask for the weather in a specific location',
        commands: [
          {
            codeRef: {
              module: import.meta.url,
              name: 'GetWeatherCommand',
            },
            requiresApproval: false,
          },
        ],
      });
      let { roomId } = await createAIAssistantRoomCommand.execute({
        name: 'Weather Assistant',
        enabledSkills: [weatherSkill],
      });

      let sendMessageCommand = new SendAiAssistantMessageCommand(
        commandContext,
      );

      await sendMessageCommand.execute({
        roomId,
        prompt: `What is the weather in ${this.args.model.location}?`,
      });
    };

    <template>
      <CardContainer>
        <Button data-test-get-weather {{on 'click' this.getWeather}}>
          Get Weather
        </Button>
      </CardContainer>
    </template>
  };
}
