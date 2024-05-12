import { FieldDef, field, contains } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import {
  BoxelSelect,
  FieldContainer,
  CardContainer,
} from '@cardstack/boxel-ui/components';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';

interface Salutation {
  name: string;
}

class View extends Component<typeof UserName> {
  get isValidValue() {
    let { salutation, firstName, lastName } = this.args.model;

    if (!salutation || salutation === 'Select' || salutation === 'None')
      return false;
    if (!firstName) return false;
    if (!lastName) return false;
    return true;
  }

  <template>
    {{#if this.isValidValue}}
      <@fields.fullName />
    {{else}}
      No User Found
    {{/if}}
  </template>
}

class Edit extends Component<typeof UserName> {
  @tracked selectedSalutationType = {
    name: this.args.model.salutation || 'Select',
  };

  @tracked placeholder = this.args.model.salutation || 'Select';

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
          @placeholder={{this.placeholder}}
          @selected={{this.selectedSalutationType}}
          @onChange={{this.updateSalutationType}}
          @options={{this.salutationType}}
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
        padding: 2rem 1rem;
        display: grid;
        gap: var(--boxel-sp-sm);
        grid-template-columns: 1fr;
        background-color: #eeeeee50;
      }
      .select {
        padding: var(--boxel-sp-xs);
        background-color: white;
      }

      @media (min-width: 768px) {
        .card-container {
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        }
      }
    </style>
  </template>
}

export class UserName extends FieldDef {
  static displayName = 'User Name';
  @field title = contains(StringField, {
    description: `Title`,
  });
  @field salutation = contains(StringField, {
    description: `User's Salutation`,
  });
  @field firstName = contains(StringField, {
    description: `User's First Name`,
  });
  @field lastName = contains(StringField, {
    description: `User's Last Name`,
  });

  @field fullName = contains(StringField, {
    description: `User's Full Name`,
    computeVia: function (this: UserName) {
      return [this.salutation, this.firstName, this.lastName]
        .filter(Boolean)
        .join(' ');
    },
  });

  static atom = View;
  static embedded = View;
  static edit = Edit;
}
