import {
  contains,
  field,
  CardDef,
  Component,
  FieldDef,
  StringField,
  serialize,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import { Person } from './person';

// this field explodes when serialized (saved)
export class BoomField extends FieldDef {
  @field title = contains(StringField);
  static [serialize](_boom: any) {
    throw new Error('Boom!');
  }
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.title />
    </template>
  };
}

export class BoomPet extends CardDef {
  static displayName = 'Boom Pet';
  @field boom = contains(BoomField);
  @field person = linksTo(Person);
}
