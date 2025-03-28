import {
  Component,
  CardDef,
  field,
  contains,
  StringField,
  FieldDef,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import { on } from '@ember/modifier';

export class TestField extends FieldDef {
  static displayName = 'TestField';
  @field firstName = contains(StringField);

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div data-test-baseclass>
        BaseClass
        <@fields.firstName />
      </div>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div data-test-baseclass>
        Embedded BaseClass
        <@fields.firstName />
      </div>
    </template>
  };
}
export class SubTestField extends TestField {
  static displayName = 'SubTestField';

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div data-test-subclass>
        SubClass
        <@fields.firstName />
      </div>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div data-test-subclass>
        Embedded SubClass
        <@fields.firstName />
      </div>
    </template>
  };

  static edit = class Edit extends Component<typeof this> {
    <template>
      <div data-test-edit>
        Edit
        <@fields.firstName />
      </div>
    </template>
  };
}

export class CardWithSpecialFields extends CardDef {
  static displayName = 'CardWithSpecialFields';
  @field specialField = contains(TestField);

  static fitted = class Fitted extends Component<typeof this> {
    setSubclass = () => {
      this.args.model.specialField = new SubTestField({});
    };
    <template>
      <div data-test-card-with-special-fields>
        <@fields.specialField />
        <button {{on 'click' this.setSubclass}} data-test-set-subclass>Set
          Subclass From Inside</button>
      </div>
    </template>
  };
}

export class PolymorphicFieldExample extends CardDef {
  static displayName = 'PolymorphicFieldExample';
  @field specialField = contains(TestField);
  @field cardsWithSpecialFields = linksToMany(() => CardWithSpecialFields);

  static isolated = class Isolated extends Component<typeof this> {
    setSubclass = () => {
      this.args.model.specialField = new SubTestField({});
    };
    <template>
      <button {{on 'click' this.setSubclass}} data-test-set-subclass>Set
        Subclass From Outside</button>
      <@fields.specialField />
      <@fields.cardsWithSpecialFields />
    </template>
  };
}
