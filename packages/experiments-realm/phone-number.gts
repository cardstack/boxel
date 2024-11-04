import NumberField from 'https://cardstack.com/base/number';
import {
  Component,
  FieldDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';

export class PhoneField extends FieldDef {
  static displayName = 'Phone';
  @field country = contains(NumberField);
  @field area = contains(NumberField);
  @field number = contains(NumberField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      (+<@fields.country />) <@fields.area />-<@fields.number />
    </template>
  };
}
