import { CardDef, field, contains, Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class SampleCommandCard extends CardDef {
  static displayName = 'Sample Command Card';
  @field title = contains(StringField);

  static isolated = class Isolated extends Component<typeof SampleCommandCard> {
    <template>
      <h1><@fields.title /></h1>
      <button type='button'>Create Card</button>
    </template>
  };
}
