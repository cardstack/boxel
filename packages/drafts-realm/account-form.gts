import {
  contains,
  field,
  CardDef,
  linksTo,
  Component,
  BaseDefComponent,
} from 'https://cardstack.com/base/card-api';

import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';
import { MatrixUser } from './matrix-user';
import { CrmAccount } from './crm/account';
import { Contact } from './crm/contact';
import { Address } from './address';
import {
  BoxelSelect,
  Button,
  CardContainer,
  FieldContainer,
  GridContainer,
  IconButton,
  Modal,
} from '@cardstack/boxel-ui/components';

export class Company extends CardDef {
  static displayName = 'Company';
  @field name = contains(StringField);
  @field regstrationNumber = contains(StringField);
  @field address = contains(Address);
  @field contactPerson = contains(Contact);

  @field title = contains(StringField, {
    computeVia: function (this: Company) {
      return `${this.name} Company`;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <h3><@fields.name /></h3>
    </template>
  };
}

class Embedded extends Component<typeof AccountForm> {
  <template>
    <div class='container'>
      <section>
        <div class='field-input-group'>
          <FieldContainer @tag='label' @label='Owner' @vertical={{true}}>
            <@fields.owner />
          </FieldContainer>
          <FieldContainer @tag='label' @label='Account Name' @vertical={{true}}>
            <@fields.accountName />
          </FieldContainer>
          <FieldContainer
            @tag='label'
            @label='Account Alias'
            @vertical={{true}}
          >
            <@fields.accountAlias />
          </FieldContainer>
          <FieldContainer
            @tag='label'
            @label='Contact Information'
            @vertical={{true}}
          >
            <@fields.contactInformation />
          </FieldContainer>
          <FieldContainer
            @tag='label'
            @label='Billing Address'
            @vertical={{true}}
          >
            <@fields.billingAddress />
          </FieldContainer>
          <FieldContainer
            @tag='label'
            @label='Shipping Address'
            @vertical={{true}}
          >
            <@fields.shippingAddress />
          </FieldContainer>
          <FieldContainer
            @tag='label'
            @label='Number of Employees'
            @vertical={{true}}
          >
            <@fields.numberOfEmployees />
          </FieldContainer>
          <FieldContainer
            @tag='label'
            @label='Parent Account'
            @vertical={{true}}
          >
            <@fields.parentAccount />
          </FieldContainer>
          <FieldContainer @tag='label' @label='Company' @vertical={{true}}>
            <@fields.company />
          </FieldContainer>
          <FieldContainer @tag='label' @label='Title' @vertical={{true}}>
            <@fields.title />
          </FieldContainer>

        </div>
      </section>
    </div>

    <style>
      .container {
        display: grid;
        gap: var(--boxel-sp-lg);
        overflow: hidden;
      }
      section {
        overflow: hidden;
      }
      .field-group-title {
        font-size: var(--boxel-font-size);
        font-weight: 800;
        margin-bottom: var(--boxel-sp-xs);
      }
      .field-input-group {
        display: flex;
        flex-direction: column;
        justify-content: space-evenly;
        gap: var(--boxel-sp);
      }
    </style>
  </template>
}

export class AccountForm extends CardDef {
  static displayName = 'Account Form';
  @field owner = linksTo(MatrixUser);
  @field accountName = contains(StringField);
  @field accountAlias = contains(StringField);
  @field description = contains(StringField);
  @field contactInformation = contains(Contact);
  @field billingAddress = contains(Address);
  @field shippingAddress = contains(Address, {
    computeVia: function (this: AccountForm) {
      return this.billingAddress;
    },
  });
  @field numberOfEmployees = contains(NumberField);
  @field parentAccount = linksTo(() => CrmAccount);
  @field company = linksTo(Company);
  @field title = contains(StringField, {
    computeVia: function (this: AccountForm) {
      return this.accountName;
    },
  });

  static embedded = Embedded;
}
