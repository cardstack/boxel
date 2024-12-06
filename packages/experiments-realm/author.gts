import { FeaturedImageField } from './fields/featured-image';
import MarkdownField from 'https://cardstack.com/base/markdown';
import TextAreaField from 'https://cardstack.com/base/text-area';
import {
  Component,
  CardDef,
  field,
  contains,
  containsMany,
  StringField,
} from 'https://cardstack.com/base/card-api';

import SquareUser from '@cardstack/boxel-icons/square-user';
import Email from '@cardstack/boxel-icons/mail';
import Linkedin from '@cardstack/boxel-icons/linkedin';
import XIcon from '@cardstack/boxel-icons/brand-x';

import { setBackgroundImage } from './components/layout';
import { ContactLinkField } from './fields/contact-link';
import { EmailField } from './email';

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
  @field firstName = contains(StringField);
  @field lastName = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: Author) {
      return [this.firstName, this.lastName].filter(Boolean).join(' ');
    },
    description: 'Full name of author',
  });
  @field bio = contains(MarkdownField, {
    description: 'Default author bio for embedded and isolated views.',
  });
  @field extendedBio = contains(MarkdownField, {
    description: 'Full bio for isolated view',
  });
  @field shortBio = contains(TextAreaField, {
    description: 'Shorter bio for display on fitted view',
  });
  @field quote = contains(TextAreaField);
  @field contactLinks = containsMany(AuthorContactLink);
  @field email = contains(EmailField);
  @field featuredImage = contains(FeaturedImageField);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='author-bio'>
        <header>
          <h1 class='title'><@fields.title /></h1>
          <p class='description'><@fields.description /></p>
          <blockquote class='quote'>
            <p><@fields.quote /></p>
          </blockquote>
          <@fields.featuredImage class='featured-image' />
          <div class='links'>
            <@fields.contactLinks @format='atom' />
          </div>
        </header>
        <div class='summary'>
          <@fields.bio />
        </div>
        <section class='extended-bio'>
          <@fields.extendedBio />
        </section>
      </article>
      <style scoped>
        .author-bio {
          --font-small: 0.8125em;
          width: 80%;
          margin-right: auto;
          margin-left: auto;
          padding: 3em 1em;
          font-size: 1rem;
        }
        .author-bio > * + * {
          margin-top: 2em;
        }
        .links {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xxxs);
        }
        .links {
          display: flex;
          gap: var(--boxel-sp-xxxs);
          flex-wrap: wrap;
        }
        .links :deep(div) {
          display: contents;
        }
        header {
          display: grid;
          grid-template:
            'title img' max-content
            'desc img' max-content
            'quote img' 1fr
            'links img' max-content / 1fr max-content;
          gap: var(--boxel-sp-6xs) var(--boxel-sp);
        }
        .title {
          grid-area: title;
        }
        .description {
          grid-area: desc;
        }
        .quote {
          grid-area: quote;
        }
        .links {
          grid-area: links;
        }
        .featured-image {
          grid-area: img;
        }

        h1 {
          font-size: 1.625em;
          line-height: 1.25;
          letter-spacing: normal;
          margin-top: var(--boxel-sp-xl);
          margin-bottom: 0;
        }
        .description {
          margin: 0;
          font-size: var(--font-small);
          font-weight: 500;
        }
        .links :deep(.pill) {
          border: none;
        }
        .featured-image :deep(.image) {
          border-radius: 50%;
          border: 1px solid var(--boxel-400);
        }
        blockquote {
          margin-right: auto;
          margin-left: auto;
          margin-bottom: auto;
          padding: 0;
          border-left: 1px solid black;
        }
        blockquote p {
          font-size: 0.88em;
          font-style: italic;
          margin-inline-start: var(--boxel-sp-xl);
          margin-inline-end: var(--boxel-sp-xl);
        }
        .summary {
          background-color: #efefef;
          border-radius: var(--boxel-border-radius-lg);
        }
        .summary > :deep(.markdown-content) {
          width: 90%;
          padding: var(--boxel-sp-lg);
          margin: 0 auto;
        }
        .summary :deep(p) {
          margin: 0;
          font-size: var(--font-small);
        }
        .summary :deep(p + p) {
          margin-top: 1em;
        }
        .extended-bio {
          margin-top: 3em;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <article>
        <header>
          <h3><@fields.title /></h3>
          <h4><@fields.description /></h4>
        </header>
        <p><@fields.bio /></p>
        <div class='author-bio-links'>
          <@fields.contactLinks @format='embedded' />
        </div>
      </article>
      <style scoped>
        .author-bio-links > :deep(.embedded-format) {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs);
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
