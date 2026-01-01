import {
  Component,
  FieldDef,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { NavLinkField } from './nav-link-field';

export class FooterColumnField extends FieldDef {
  static displayName = 'Footer Column';

  @field columnTitle = contains(StringField);
  @field links = containsMany(NavLinkField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='footer-column'>
        {{#if @model.columnTitle}}
          <div class='footer-column-title'>{{@model.columnTitle}}</div>
        {{/if}}

        {{#if @model.links.length}}
          <@fields.links class='footer-column-links' />
        {{/if}}
      </div>

      <style scoped>
        .footer-column {
          border-left: 1px solid var(--border, var(--boxel-border-color));
          background: var(--card, var(--boxel-light));
        }
        .footer-column-title {
          padding: 0.6rem 1rem;
          border-bottom: 1px solid var(--border, var(--boxel-border-color));
          font-size: 0.65rem;
          letter-spacing: 0.08em;
          color: var(--muted-foreground, var(--boxel-500));
          text-transform: uppercase;
        }
        .footer-column-links :deep(.footer-link:last-child) {
          border-bottom: none;
        }
      </style>
    </template>
  };

  static fitted = this.embedded;
}
