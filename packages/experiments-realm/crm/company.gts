import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import { WebsiteField } from '../website';
import { Address } from '../address';
import { EntityDisplay } from '../components/entity-display';

import {
  Component,
  CardDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import BuildingIcon from '@cardstack/boxel-icons/building';

class ViewCompanyTemplate extends Component<typeof Company> {
  <template>
    <div class='company-group'>
      <EntityDisplay @underline={{true}}>
        <:title>
          {{@model.name}}
        </:title>
        <:icon>
          <BuildingIcon />
        </:icon>
      </EntityDisplay>
    </div>
  </template>
}

export class Company extends CardDef {
  static displayName = 'Company';
  @field name = contains(StringField);
  @field industry = contains(StringField);
  @field headquartersAddress = contains(Address);
  @field phone = contains(NumberField);
  @field website = contains(WebsiteField);
  @field stockSymbol = contains(StringField);

  @field title = contains(StringField, {
    computeVia: function (this: Company) {
      return this.name;
    },
  });

  static embedded = ViewCompanyTemplate;
  static atom = ViewCompanyTemplate;
}
