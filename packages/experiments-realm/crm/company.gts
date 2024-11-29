import StringField from 'https://cardstack.com/base/string';

import {
  Component,
  CardDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import { Address } from '../address';
import BuildingIcon from '@cardstack/boxel-icons/building';

class ViewCompanyCardTemplate extends Component<typeof Company> {
  <template>
    {{#if @model.name}}
      <div class='row'>
        <BuildingIcon class='icon' />
        <span class='building-name'>{{@model.name}}</span>
      </div>
    {{/if}}

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
    </style>
  </template>
}

export class Company extends CardDef {
  static displayName = 'Company';
  //Company Data - name etc
  @field name = contains(StringField);
  @field logoUrl = contains(StringField);
  @field website = contains(StringField);
  @field location = contains(Address);

  @field title = contains(StringField, {
    computeVia: function (this: Company) {
      return this.name;
    },
  });

  static embedded = ViewCompanyCardTemplate;
  static atom = ViewCompanyCardTemplate;
}
