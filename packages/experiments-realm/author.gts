import StringCard from 'https://cardstack.com/base/string';
import { Base64ImageField } from 'https://cardstack.com/base/base64-image';
import MarkdownField from 'https://cardstack.com/base/markdown';
import {
  Component,
  CardDef,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import { CardContentContainer } from '@cardstack/boxel-ui/components';

import SquareUser from '@cardstack/boxel-icons/square-user';
import Email from '@cardstack/boxel-icons/mail';
import Linkedin from '@cardstack/boxel-icons/linkedin';
import XIcon from '@cardstack/boxel-icons/brand-x';

import { setBackgroundImage } from './components/layout';
import { ContactLinkField } from './fields/contact-link';

class AuthorContactLink extends ContactLinkField {
  static values = [
    {
      type: 'social',
      label: 'X',
      icon: XIcon,
      cta: 'Follow',
    },
    {
      type: 'social',
      label: 'LinkedIn',
      icon: Linkedin,
      cta: 'Connect',
    },
    {
      type: 'email',
      label: 'Email',
      icon: Email,
      cta: 'Contact',
    },
  ];
}

export class Author extends CardDef {
  static displayName = 'Author Bio';
  static icon = SquareUser;
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);
  @field title = contains(StringCard, {
    computeVia: function (this: Author) {
      return [this.firstName, this.lastName].filter(Boolean).join(' ');
    },
  });
  @field description = contains(StringCard, {
    computeVia: function (this: Author) {
      return this.body;
    },
  });
  @field photo = contains(Base64ImageField);
  @field body = contains(MarkdownField);
  @field contactLinks = containsMany(AuthorContactLink);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContentContainer>
        <h3><@fields.title /></h3>
        <p><@fields.body /></p>
        <div class='links'>
          <@fields.contactLinks @format='atom' />
        </div>
      </CardContentContainer>
      <style scoped>
        .links {
          display: flex;
          gap: var(--boxel-sp-xxxs);
          flex-wrap: wrap;
        }
        .links :deep(div) {
          display: contents;
        }
        .links :deep(.pill) {
          border: none;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      {{#if @model.title}}
        {{#if @model.thumbnailURL}}
          <span
            class='author-thumbnail'
            style={{setBackgroundImage @model.thumbnailURL}}
          />
        {{else}}
          <@model.constructor.icon class='author-icon' width='20' height='20' />
        {{/if}}
        <@fields.title />
      {{/if}}
      <style scoped>
        .author-thumbnail,
        .author-icon {
          display: inline-block;
          margin-right: var(--boxel-sp-6xs);
          vertical-align: text-bottom;
          flex-shrink: 0;
        }
        .author-thumbnail {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          overflow: hidden;
          background-position: center;
          background-repeat: no-repeat;
          background-size: cover;
        }
      </style>
    </template>
  };
}
