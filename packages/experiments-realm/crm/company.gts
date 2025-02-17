import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import { WebsiteField } from '../website';
import { Address } from '../address';
import EntityDisplayWithIcon from '../components/entity-icon-display';

import {
  Component,
  CardDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import BuildingIcon from '@cardstack/boxel-icons/building';

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
          <BuildingIcon />
        </:icon>
      </EntityDisplayWithIcon>
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

  static edit = CompanyEditTemplate;
  static embedded = ViewCompanyTemplate;
  static atom = ViewCompanyTemplate;
}
