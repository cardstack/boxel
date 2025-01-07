import { on } from '@ember/modifier';

import CreateAIAssistantRoomCommand from '@cardstack/boxel-host/commands/create-ai-assistant-room';
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

export class WeatherLocationInput extends CardDef {
  @field location = contains(StringField);
}

export class WeatherReport extends CardDef {
  @field temperature = contains(StringField);
  @field conditions = contains(StringField);
}

class GetWeatherCommand extends Command<WeatherLocationInput, WeatherReport> {
  inputType = WeatherLocationInput;

  async getInputType(): Promise<new (args: any) => WeatherLocationInput> {
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

      let getWeatherCommand = new GetWeatherCommand(commandContext);

      let createAIAssistantRoomCommand = new CreateAIAssistantRoomCommand(
        commandContext,
      );
      let { roomId } = await createAIAssistantRoomCommand.execute({
        name: 'Weather Assistant',
      });

      let sendMessageCommand = new SendAiAssistantMessageCommand(
        commandContext,
      );

      await sendMessageCommand.execute({
        roomId,
        prompt: `What is the weather in ${this.args.model.location}?`,
        commands: [{ command: getWeatherCommand, autoExecute: true }],
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
