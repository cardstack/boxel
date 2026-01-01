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

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <a
        class='footer-link'
        href={{if @model.linkUrl.length (sanitizeHtml @model.linkUrl) '#'}}
      >
        {{@model.linkText}}
      </a>

      <style scoped>
        .footer-link {
          display: block;
          padding: 0.5rem 1rem;
          font-size: 0.75rem;
          color: var(--foreground, var(--boxel-slate));
          text-decoration: none;
          border-bottom: 1px solid var(--border, var(--boxel-border-color));
        }
        .footer-link:hover {
          color: var(--cardstack-purple, var(--secondary));
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <a
        class='footer-inline-link'
        href={{if @model.linkUrl.length (sanitizeHtml @model.linkUrl) '#'}}
      >
        {{@model.linkText}}
      </a>

      <style scoped>
        .footer-inline-link {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          font-size: 0.75rem;
          color: var(--muted-foreground, var(--boxel-500));
          text-decoration: none;
          letter-spacing: 0.05em;
        }
        .footer-inline-link:hover {
          color: var(--foreground, var(--boxel-slate));
        }
      </style>
    </template>
  };
}
