import { FieldDef, field, contains } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import {
  BoxelSelect,
  FieldContainer,
  CardContainer,
} from '@cardstack/boxel-ui/components';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';

interface Salutation {
  name: string;
}

class View extends Component<typeof UserName> {
  get isValidVal() {
    let { salutation, firstName, lastName } = this.args.model;

    if (!salutation || salutation === 'Select' || salutation === 'None')
      return false;
    if (!firstName) return false;
    if (!lastName) return false;
    return true;
  }

  <template>
    {{#if this.isValidVal}}
      <@fields.fullName />
    {{else}}
      No User Found
    {{/if}}
  </template>
}

class Edit extends Component<typeof UserName> {
  get selectedSalutationCategory() {
    return {
      name:
        this.args.model.salutation ||
        this.salutationCategory[0].name ||
        'Select',
    };
  }

  @tracked salutationCategory = [
    { name: 'None' },
    { name: 'Mr.' },
    { name: 'Ms.' },
    { name: 'Mrs.' },
    { name: 'Dr.' },
    { name: 'Prof.' },
    { name: 'Mx.' },
  ] as Array<Salutation>;

  @action updateSalutationCategory(type: { name: string }) {
    this.args.model.salutation = type.name;
  }

  <template>
    <CardContainer @displayBoundaries={{true}} class='container'>
      <FieldContainer @tag='label' @label='Salutation' @vertical={{true}}>
        <BoxelSelect
          @selected={{this.selectedSalutationCategory}}
          @onChange={{this.updateSalutationCategory}}
          @options={{this.salutationCategory}}
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
      .container {
        padding: 2rem 1rem;
        display: grid;
        gap: var(--boxel-sp-sm);
        background-color: #eeeeee50;
      }
      .select {
        padding: var(--boxel-sp-xs);
        background-color: white;
      }
    </style>
  </template>
}

export class UserName extends FieldDef {
  static displayName = 'User Name';
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
