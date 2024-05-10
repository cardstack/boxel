import TextAreaField from 'https://cardstack.com/base/text-area';
import {
  CardDef,
  FieldDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import {
  BoxelSelect,
  FieldContainer,
  Label,
  Message,
  CardContainer,
} from '@cardstack/boxel-ui/components';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';

interface Salutation {
  name: string;
}

export class UserName extends CardDef {
  static displayName = 'User Name';
  @field salutation = contains(StringField);
  @field firstName = contains(StringField);
  @field lastName = contains(StringField);

  @field fullName = contains(StringField, {
    computeVia: function (this: UserName) {
      return [this.salutation, this.firstName, this.lastName]
        .filter(Boolean)
        .join(' ');
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.fullName />
    </template>
  };

  static edit = class Edit extends Component<typeof this> {
    @tracked selectedSalutationType: Salutation | null = null;

    @tracked salutationType = [
      { name: 'None' },
      { name: 'Mr.' },
      { name: 'Ms.' },
      { name: 'Mrs.' },
      { name: 'Dr.' },
      { name: 'Prof.' },
      { name: 'Mx.' },
    ] as Array<Salutation>;

    @action updateSalutationType(type: { name: string }) {
      this.selectedSalutationType = type;
      this.args.model.salutation = type.name;
    }

    <template>
      <CardContainer @displayBoundaries={{true}} class='card-container'>
        <FieldContainer @tag='label' @label='Salutation' @vertical={{true}}>
          <BoxelSelect
            @placeholder={{'Select'}}
            @selected={{this.selectedSalutationType}}
            @onChange={{this.updateSalutationType}}
            @options={{this.salutationType}}
            @dropdownClass='boxel-select-usage'
            class='select'
            as |item|
          >
            <div>{{item.name}}</div>
          </BoxelSelect>
        </FieldContainer>
        <FieldContainer
          @tag='label'
          @label='First Name'
          @vertical={{true}}
        ><@fields.firstName /></FieldContainer>
        <FieldContainer
          @tag='label'
          @label='Last Name'
          @vertical={{true}}
        ><@fields.lastName /></FieldContainer>
      </CardContainer>

      <style>
        .card-container {
          padding: var(--boxel-sp-sm);
          display: grid;
          gap: var(--boxel-sp-sm);
          grid-template-columns: 1fr;
        }
        .select {
          padding: var(--boxel-sp-xs);
        }

        @media (min-width: 768px) {
          .card-container {
            grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
          }
        }
      </style>
    </template>
  };

  /*
  static isolated = class Isolated extends Component<typeof this> {
    <template></template>
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template></template>
  }

  static atom = class Atom extends Component<typeof this> {
    <template></template>
  }

  static edit = class Edit extends Component<typeof this> {
    <template></template>
  }
  * /
}









































































































































































  */
}
