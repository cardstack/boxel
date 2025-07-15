// Expected output for mixed content
import StringField from 'https://cardstack.com/base/string';
import EmailField from 'https://cardstack.com/base/email';
import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';

export class MyCard extends CardDef {
  @field name = contains(StringField);
  @field email = contains(EmailField);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div>
        <h1>{{@model.name}}</h1>
        <p>{{@model.email}}</p>
      </div>
    </template>
  };
}
