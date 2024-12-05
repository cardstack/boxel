import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import { UrlField } from '../url';
import { Address } from '../address';

import {
  Component,
  CardDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import BuildingIcon from '@cardstack/boxel-icons/building';

class ViewCompanyTemplate extends Component<typeof Company> {
  <template>
    <div class='row'>
      <BuildingIcon class='icon' />

      {{#if @model.name}}
        <span class='building-name'>{{@model.name}}</span>
      {{else}}
        <span class='no-building'>No Company Assigned</span>
      {{/if}}
    </div>

    <style scoped>
      .icon {
        width: var(--boxel-icon-xs);
        height: var(--boxel-icon-xs);
        flex-shrink: 0;
      }
      .row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
      }
      .row > span {
        -webkit-line-clamp: 1;
        text-wrap: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
      }
      .building-name {
        font-size: var(--boxel-font-xs);
        font-weight: 300;
        text-decoration: underline;
      }
      .no-building {
        font-size: var(--boxel-font-xs);
        font-weight: 300;
      }
    </style>
  </template>
}

export class Company extends CardDef {
  static displayName = 'Company';
  @field name = contains(StringField);
  @field industry = contains(StringField);
  @field headquartersAddress = contains(Address);
  @field phone = contains(NumberField);
  @field website = contains(UrlField);
  @field stockSymbol = contains(StringField);

  @field title = contains(StringField, {
    computeVia: function (this: Company) {
      return this.name;
    },
  });

  static embedded = ViewCompanyTemplate;
  static atom = ViewCompanyTemplate;
}
