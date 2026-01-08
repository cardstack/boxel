import {
  Component,
  FieldDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import UrlField from 'https://cardstack.com/base/url';

import { sanitizeHtml } from '@cardstack/boxel-ui/helpers';

export class NavLinkField extends FieldDef {
  static displayName = 'Nav Link';

  @field linkText = contains(StringField);
  @field linkUrl = contains(UrlField);
  @field title = contains(StringField, {
    computeVia: function (this: NavLinkField) {
      return this.linkText;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <a
        class='nav-link'
        href={{if @model.linkUrl (sanitizeHtml @model.linkUrl) '#'}}
      >
        <@fields.linkText />
      </a>
    </template>
  };

  static fitted = this.embedded;
}
