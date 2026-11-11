import { CardDef, Component, contains, field } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { instance, operation } from '@cardstack/base/operations';

// A card whose forecast comes from an outside weather service, sent with a
// key someone shared into the workspace (an `apiKey` slot). The evaluation
// that seeds it has another user share their key and approve `forecast` for
// the realm's automations only, so an invocation from the AI
// assistant is refused "Interactive use not approved", and only the user who
// shared the key can allow it.
export class TeamWeather extends CardDef {
  static displayName = 'Team Weather';

  @field city = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: TeamWeather) {
      return this.city ? `Team weather in ${this.city}` : 'Team Weather';
    },
  });

  @operation static forecast = {
    base: 'callApi',
    label: "Get the office's forecast",
    url: 'https://api.weather.example.com/v1/forecast/{city}',
    path: { city: instance('city') },
    headers: { authorization: 'Bearer {{apiKey}}' },
  };

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='team-weather'>
        <h1>Team weather in <@fields.city /></h1>
        <p>
          The forecast comes from the weather service, with the key shared into
          this workspace. Run the card's
          <code>forecast</code>
          operation to fetch it.
        </p>
      </article>
      <style scoped>
        .team-weather {
          padding: var(--boxel-sp-lg);
        }
      </style>
    </template>
  };
}
