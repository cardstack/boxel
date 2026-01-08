import {
  Component,
  FieldDef,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { NavLinkField } from './nav-link-field';

export class NavLinkColumnField extends FieldDef {
  static displayName = 'Footer Column';

  @field columnTitle = contains(StringField);
  @field links = containsMany(NavLinkField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='nav-link-column'>
        {{#if @model.columnTitle}}
          <div class='nav-link-column-title'><@fields.columnTitle /></div>
        {{/if}}

        {{#if @model.links.length}}
          <@fields.links class='nav-link-column-links' />
        {{/if}}
      </div>
    </template>
  };

  static fitted = this.embedded;
}
