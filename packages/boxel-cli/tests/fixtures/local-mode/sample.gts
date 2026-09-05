import { CardDef, Component, field, contains } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

// One field and one probe element is the whole point: rendering any card at
// all is what the accompanying test asserts, so nothing here should be
// interesting enough to fail on its own.
export class Sample extends CardDef {
  static displayName = 'Sample';

  @field nickname = contains(StringField);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div data-sample-probe>{{@model.nickname}}</div>
    </template>
  };
}
