import { CardDef, Component, contains, field } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { instance, operation } from '@cardstack/base/operations';

// A card whose forecast comes from an outside weather service, sent with the
// invoking user's own key for it (a `userKey` slot). An operation that
// carries a credential slot is refused "Binding not approved", and the
// refusal names the slot as one for the invoking user's own key, which is
// what tells the assistant the user's key is needed.
export class WeatherStation extends CardDef {
  static displayName = 'Weather Station';

  @field city = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: WeatherStation) {
      return this.city ? `Weather in ${this.city}` : 'Weather Station';
    },
  });

  @operation static forecast = {
    base: 'callApi',
    label: "Get the city's forecast",
    url: 'https://api.weather.example.com/v1/forecast/{city}',
    path: { city: instance('city') },
    headers: { authorization: 'Bearer {{userKey}}' },
  };

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='weather-station'>
        <h1>Weather in <@fields.city /></h1>
        <p>
          The forecast comes from the weather service, with your own key for it.
          Run the card's
          <code>forecast</code>
          operation to fetch it.
        </p>
      </article>
      <style scoped>
        .weather-station {
          padding: var(--boxel-sp-lg);
        }
      </style>
    </template>
  };
}
