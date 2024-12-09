import { FeaturedImageField } from './fields/featured-image';
import MarkdownField from 'https://cardstack.com/base/markdown';
import TextAreaField from 'https://cardstack.com/base/text-area';
import {
  Component,
  CardDef,
  field,
  contains,
  containsMany,
  linksTo,
  StringField,
} from 'https://cardstack.com/base/card-api';

import SquareUser from '@cardstack/boxel-icons/square-user';
import Email from '@cardstack/boxel-icons/mail';
import Linkedin from '@cardstack/boxel-icons/linkedin';
import XIcon from '@cardstack/boxel-icons/brand-x';

import { setBackgroundImage } from './components/layout';
import { ContactLinkField } from './fields/contact-link';
import { BlogApp } from './blog-app';
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
  static displayName = 'Author';
  static icon = SquareUser;
  @field firstName = contains(StringField);
  @field lastName = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: Author) {
      let fullName = [this.firstName, this.lastName].filter(Boolean).join(' ');
      return fullName.length ? fullName : `Untitled Author`;
    },
    description: 'Full name of author',
  });
  @field bio = contains(TextAreaField);
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
  @field blog = linksTo(BlogApp, { isUsed: true });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='author-bio'>
        <header>
          <h1 class='title'>
            <@fields.title />
          </h1>
          <p class='description'><@fields.description /></p>
          {{#if @model.featuredImage.imageUrl}}
            <@fields.featuredImage class='featured-image' />
          {{else if @model.thumbnailURL.length}}
            <div
              class='thumbnail-image'
              style={{setBackgroundImage @model.thumbnailURL}}
            />
          {{/if}}
          <div class='links'>
            <@fields.contactLinks @format='atom' />
          </div>
        </header>
        {{#if @model.bio}}
          <div class='summary'>
            <@fields.bio />
          </div>
        {{/if}}
        {{#if @model.extendedBio}}
          <section class='extended-bio'>
            <@fields.extendedBio />
          </section>
        {{/if}}
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
          margin-top: 1em;
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
        .thumbnail-image {
          width: 300px;
          height: 300px;
          background-position: center;
          background-size: cover;
          background-repeat: no-repeat;
          border-radius: 50%;
          border: 1px solid var(--boxel-400);
        }
        blockquote {
          margin: auto;
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
      <article class='author-embedded'>
        <div
          class='thumbnail-image'
          style={{setBackgroundImage @model.thumbnailURL}}
        />
        <header>
          <h3><@fields.title /></h3>
          <p class='desc'><@fields.description /></p>
        </header>
        {{#if @model.bio}}
          <p class='bio'><@fields.bio /></p>
        {{/if}}
        <div class='author-bio-links'>
          <@fields.contactLinks @format='embedded' />
        </div>
      </article>
      <style scoped>
        .author-embedded {
          height: 100%;
          display: grid;
          grid-template-columns: max-content 1fr;
          gap: var(--boxel-sp) var(--boxel-sp-lg);
          padding: var(--boxel-sp);
        }
        h3,
        p {
          margin: 0;
        }
        header {
          align-self: center;
        }
        h3 {
          font: 600 var(--boxel-font);
          letter-spacing: var(--boxel-lsp-sm);
        }
        .desc {
          font: 500 var(--boxel-font-sm);
          letter-spacing: var(--boxel-lsp-sm);
        }
        .thumbnail-image {
          width: 60px;
          height: 60px;
          background-position: center;
          background-size: cover;
          background-repeat: no-repeat;
          border-radius: 50%;
          border: 1px solid var(--boxel-400);
        }
        .bio {
          display: -webkit-box;
          -webkit-line-clamp: 5;
          -webkit-box-orient: vertical;
          text-overflow: ellipsis;
          font: var(--boxel-font-sm);
          letter-spacing: var(--boxel-lsp-sm);
        }
        .author-bio-links {
        }
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
