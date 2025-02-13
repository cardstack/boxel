import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import { WebsiteField } from '../website';
import { Address } from '../address';
import EntityDisplayWithIcon from '../components/entity-icon-display';
import { CrmApp } from '../crm-app';

import {
  Component,
  CardDef,
  field,
  contains,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import BuildingIcon from '@cardstack/boxel-icons/building';

class ViewCompanyTemplate extends Component<typeof Company> {
  <template>
    <div class='company-group'>
      <EntityDisplayWithIcon @title={{@model.name}} @underline={{true}}>
        <:icon>
          <BuildingIcon />
        </:icon>
      </EntityDisplayWithIcon>
    </div>
  </template>
}

export class Company extends CardDef {
  static displayName = 'Company';
  @field crmApp = linksTo(() => CrmApp);
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
