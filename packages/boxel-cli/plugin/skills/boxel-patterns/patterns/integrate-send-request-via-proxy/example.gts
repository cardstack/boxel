import { Command } from '@cardstack/runtime-common';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import SendRequestViaProxyCommand from '@cardstack/boxel-host/tools/send-request-via-proxy';

// 🧩 PATTERN: Arbitrary HTTP through SendRequestViaProxyCommand.
//
// The host handles credentials per URL host. Cards never see API keys.

class WeatherFetchInput extends CardDef {
  @field city = contains(StringField);
}

class WeatherResult extends CardDef {
  @field summary = contains(StringField);
  @field temperatureC = contains(StringField);
}

export default class WeatherFetchCommand extends Command<
  typeof WeatherFetchInput,
  typeof WeatherResult
> {
  static actionVerb = 'Fetch weather';

  async getInputType() {
    return WeatherFetchInput;
  }

  protected async run(input: WeatherFetchInput): Promise<WeatherResult> {
    if (!input.city) throw new Error('city is required');

    const proxy = new SendRequestViaProxyCommand(this.commandContext);

    // 1) Build the URL. The realm matches the host (api.weatherapi.com)
    //    and injects the configured API key automatically — we don't
    //    set an Authorization header ourselves.
    const url = `https://api.weatherapi.com/v1/current.json?q=${encodeURIComponent(input.city)}`;

    // 2) Execute the proxied request.
    const response = await proxy.execute({
      url,
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (response.status >= 400) {
      throw new Error(
        `Weather API failed: ${response.status} ${response.body.slice(0, 200)}`,
      );
    }

    // 3) Body is a string — parse it.
    const data = JSON.parse(response.body);

    return new WeatherResult({
      summary: data.current?.condition?.text ?? 'Unknown',
      temperatureC: String(data.current?.temp_c ?? ''),
    });
  }
}

// === Usage from a component ===========================================
//
//   import { restartableTask } from 'ember-concurrency';
//
//   class CityWeatherWidget extends Component<typeof CityCard> {
//     fetchTask = restartableTask(async () => {
//       const { commandContext } = this.args.context!;
//       const cmd = new WeatherFetchCommand(commandContext);
//       const result = await cmd.execute({ city: this.args.model.name });
//       this.summary = result.summary;
//     });
//   }
