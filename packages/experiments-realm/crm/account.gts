import {
  contains,
  field,
  CardDef,
  linksTo,
  linksToMany,
  FieldDef,
} from 'https://cardstack.com/base/card-api';

import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';
import TextArea from 'https://cardstack.com/base/text-area';
import { Address } from '../address';

class CrmUser extends CardDef {}
export class Contact extends CardDef {}
class Company extends CardDef {}

export class CrmAccount extends CardDef {
  static displayName = 'Crm Account';
  @field user = linksTo(CrmUser);
  @field accountName = contains(StringField);
  @field details = contains(TextArea, {
    description: '',
  }); // card desicription to truncate or ai summarised the field description
  @field contact = linksToMany(() => Contact);
  @field numberOfEmployees = contains(NumberField); //charges based upon number of employees
  @field parentAccount = linksTo(() => CrmAccount);
  @field company = linksTo(Company);

  @field billingAddress = contains(Address);
  @field shippingAddress = contains(Address, {
    computeVia: function (this: CrmAccount) {
      return this.billingAddress;
    },
  });
  @field title = contains(StringField, {
    computeVia: function (this: CrmAccount) {
      return this.accountName;
    },
  });
}

// class LeadStatus extends StringField {
//   statuses = ['converted', 'met'];
//   @field value = contains(StringField);
// }
