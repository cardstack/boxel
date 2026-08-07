import {
  CardDef,
  Component,
  field,
  contains,
  StringField,
  type BaseDefComponent,
} from '@cardstack/base/card-api';
import UrlField from '@cardstack/base/url';
import EmailField from '@cardstack/base/email';
import UserIcon from '@cardstack/boxel-icons/user';

import { initialsOf } from './utils/index';

export class PersonBase extends CardDef {
  static displayName = 'Person';
  static icon = UserIcon;

  @field name = contains(StringField);
  @field email = contains(EmailField);
  @field phone = contains(StringField);
  @field photoUrl = contains(UrlField);

  @field initials = contains(StringField, {
    computeVia: function (this: PersonBase) {
      return initialsOf(this.name);
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: PersonBase) {
      return this.name?.trim() || 'Unnamed Person';
    },
  });

  // `BaseDefComponent` keeps subclass overrides assignable to this base.
  static embedded: BaseDefComponent = class Embedded extends Component<
    typeof this
  > {
    <template>
      <div
        class='person-row'
      >
        {{#if @model.photoUrl}}
          <img class='person-avatar' src={{@model.photoUrl}} alt='' />
        {{else}}
          <span class='person-avatar person-initials'>{{@model.initials}}</span>
        {{/if}}
        <span class='person-main'>
          <span class='person-name'>{{@model.title}}</span>
          {{#if @model.email}}
            <span class='person-sub'>{{@model.email}}</span>
          {{/if}}
        </span>
      </div>
      <style scoped>
        .person-row {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--boxel-border-radius);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
          transition: box-shadow 0.15s ease-out;
        }
        .person-avatar {
          width: 2.375rem;
          height: 2.375rem;
          border-radius: 50%;
          flex: none;
          object-fit: cover;
        }
        .person-initials {
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-serif, serif);
          font-weight: 600;
          font-size: var(--boxel-font-size-sm);
          line-height: 1;
          color: var(--primary-foreground, var(--boxel-light));
          background: var(--primary, var(--boxel-highlight));
        }
        .person-main {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .person-name {
          font-size: var(--boxel-font-size-sm);
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .person-sub {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      </style>
    </template>
  };
}
