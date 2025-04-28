import {
  contains,
  field,
  CardDef,
  Component,
  FieldDef,
  StringField,
  serialize,
} from 'https://cardstack.com/base/card-api';

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
}

export class BoomPerson extends CardDef {
  static displayName = 'Boom Person';
  @field firstName = contains(StringField);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      Hello
      <@fields.firstName />!
      {{!-- {{this.causeError}} --}}
    </template>
    // causeError = () => fn();
  };
}

export class WorkingCard extends CardDef {
  static displayName = 'Working Card';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <p>I am not broken!</p>
    </template>
  };
}

export class FailingField extends FieldDef {
  static displayName = 'Failing Field';
  @field title = contains(StringField);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <p>This will fail.</p> {{this.boom}}
    </template>
    boom = () => {
      throw new Error('boom!');
    };
  };
}
