import { CardDef, contains, field } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import {
  operation,
  params,
  type OperationDeclaration,
} from '@cardstack/base/operations';

// A weather service that answers a city's forecast for one day, with the
// invoking user's own key for the service. The call reads and changes
// nothing at the service.
export class WeatherService extends CardDef {
  static displayName = 'Weather Service';
  @field cardTitle = contains(StringField, {
    computeVia: function () {
      return 'Weather service';
    },
  });

  @operation static forecast = {
    base: 'callApi',
    label: "Get a city's forecast for one day, with your weather key",
    params: { city: StringField, date: StringField },
    url: 'https://api.weather.example.com/v1/forecast/{city}',
    path: { city: params('city') },
    query: { date: params('date') },
    headers: { authorization: 'Bearer {{userKey}}' },
  } satisfies OperationDeclaration;
}
