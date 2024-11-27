import {
  contains,
  field,
  CardDef,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api';

import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';
import { Address } from '../address';
import { Contact } from './contact';
import { MatrixUser } from '../matrix-user';
import { GridContainer } from '@cardstack/boxel-ui/components';

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

export class CrmAccount extends CardDef {
  static displayName = 'Crm Account';
  @field owner = linksTo(MatrixUser);
  @field accountName = contains(StringField);
  @field accountAlias = contains(StringField);
  @field description = contains(StringField);
  @field contactInformation = contains(Contact);
  @field billingAddress = contains(Address);
  @field shippingAddress = contains(Address, {
    computeVia: function (this: CrmAccount) {
      return this.billingAddress;
    },
  });
  @field numberOfEmployees = contains(NumberField);
  @field parentAccount = linksTo(() => CrmAccount);
  @field company = linksTo(Company);
  @field title = contains(StringField, {
    computeVia: function (this: CrmAccount) {
      return this.accountName;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <GridContainer>
        <h3><@fields.accountName /></h3>
      </GridContainer>
    </template>
  };
}
