import { FieldDef, contains, field, Component } from './card-api';
import StringField from './string';

export class EmailAddress extends FieldDef {
  static displayName = 'EmailAddress';
  @field value = contains(StringField);
  // put some validation logic here

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <address>
        <@fields.value />
      </address>
    </template>
  };
}
