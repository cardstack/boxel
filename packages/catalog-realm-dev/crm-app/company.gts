import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import WebsiteField from 'https://cardstack.com/base/website';
import AddressField from 'https://cardstack.com/base/address';
import {
  Component,
  CardDef,
  field,
  contains,
  linksTo,
} from 'https://cardstack.com/base/card-api';

import { CrmApp } from './crm-app';
import {
  EntityDisplayWithIcon,
  FieldContainer,
} from '@cardstack/boxel-ui/components';
import CompanyIcon from '@cardstack/boxel-icons/building';

class CompanyEditTemplate extends Component<typeof Company> {
  <template>
    <div class='company-form'>
      <FieldContainer @label='Name'>
        <@fields.name />
      </FieldContainer>
      <FieldContainer @label='Industry'>
        <@fields.industry />
      </FieldContainer>
      <FieldContainer @label='Headquarters Address'>
        <@fields.headquartersAddress />
      </FieldContainer>
      <FieldContainer @label='Phone Number'>
        <@fields.phone />
      </FieldContainer>
      <FieldContainer @label='Website'>
        <@fields.website />
      </FieldContainer>
      <FieldContainer @label='Stock Symbol'>
        <@fields.stockSymbol />
      </FieldContainer>
      <FieldContainer @label='CRM App'>
        <@fields.crmApp />
      </FieldContainer>
    </div>
    <style scoped>
      .company-form {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-xl);
      }
    </style>
  </template>
}

class ViewCompanyTemplate extends Component<typeof Company> {
  <template>
    <div class='company-group'>
      <EntityDisplayWithIcon @title={{@model.name}} @underline={{true}}>
        <:icon>
          <@model.constructor.icon />
        </:icon>
      </EntityDisplayWithIcon>
    </div>
  </template>
}

export class Company extends CardDef {
  static displayName = 'Company';
  static icon = CompanyIcon;
  @field crmApp = linksTo(() => CrmApp);
  @field name = contains(StringField);
  @field industry = contains(StringField);
  @field headquartersAddress = contains(AddressField);
  @field phone = contains(NumberField);
  @field website = contains(WebsiteField);
  @field stockSymbol = contains(StringField);

  @field title = contains(StringField, {
    computeVia: function (this: Company) {
      return this.name;
    },
  });

  static edit = CompanyEditTemplate;
  static embedded = ViewCompanyTemplate;
  static atom = ViewCompanyTemplate;
}
