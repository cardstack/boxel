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
import EmailField from 'https://cardstack.com/base/email';

import Email from '@cardstack/boxel-icons/mail';
import Linkedin from '@cardstack/boxel-icons/linkedin';
import XIcon from '@cardstack/boxel-icons/brand-x';
import UserIcon from '@cardstack/boxel-icons/user';
import UserRoundPen from '@cardstack/boxel-icons/user-round-pen';

import { cn, not } from '@cardstack/boxel-ui/helpers';

import { setBackgroundImage } from '../components/layout';
import { FeaturedImageField } from '../fields/featured-image';
import { ContactLinkField } from '../fields/contact-link';
import { BlogApp } from './blog-app';

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
  static icon = UserRoundPen;
  @field firstName = contains(StringField);
  @field lastName = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: Author) {
      let fullName = [this.firstName, this.lastName].filter(Boolean).join(' ');
      return fullName.length ? fullName : 'Untitled Author';
    },
    description: 'Full name of author',
  });
  @field bio = contains(TextAreaField, {
    description: 'Default author bio for embedded and isolated views.',
  });
  @field fullBio = contains(MarkdownField, {
    description: 'Full bio for isolated view',
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
          <div class='title-group'>
            <h1><@fields.title /></h1>
            <p class='description'><@fields.description /></p>
            {{#if @model.quote}}
              <blockquote class='quote'>
                <p><@fields.quote /></p>
              </blockquote>
            {{/if}}
          </div>
          {{#if @model.featuredImage.imageUrl}}
            <@fields.featuredImage class='featured-image' />
          {{/if}}
        </header>
        <div class='links'>
          <@fields.contactLinks @format='atom' />
        </div>
        {{#if @model.bio}}
          <p class='summary'><@fields.bio /></p>
        {{/if}}
        {{#if @model.fullBio}}
          <@fields.fullBio />
        {{/if}}
      </article>
      <style scoped>
        @import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400..700;1,400..700&family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap');
        .author-bio {
          --markdown-font-family: 'Lora', serif;
          --markdown-heading-font-family: 'Playfair Display', serif;
          --font-small: 0.8125em;
          width: 80%;
          margin-right: auto;
          margin-left: auto;
          padding: 3em 1em;
          font-size: 1rem;
          font-family: 'Lora', serif;
          text-wrap: pretty;
        }
        h1,
        h2,
        h3,
        h4,
        h5,
        h6 {
          font-family: 'Playfair Display', serif;
        }
        .author-bio > * + * {
          margin-top: var(--boxel-sp-xl);
        }
        header {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-6xs) var(--boxel-sp);
        }
        header > * {
          flex: 1;
        }
        .title-group {
          min-width: 195px;
        }
        .featured-image :deep(figure) {
          display: flex;
          flex-direction: column;
          flex-wrap: wrap;
          text-align: right;
          gap: var(--boxel-sp-xs);
        }
        .featured-image :deep(figcaption) {
          margin-left: auto;
        }
        .featured-image :deep(.image) {
          margin-left: auto;
          width: 30vw;
          height: 30vw;
          min-width: 193px;
          min-height: 193px;
          max-width: 300px;
          max-height: 300px;
          border-radius: 50%;
          border: 1px solid var(--boxel-400);
          object-fit: cover;
          object-position: center;
        }
        h1 {
          font-size: 1.625em;
          line-height: 1.25;
          letter-spacing: normal;
          margin-top: 1vw;
          margin-bottom: 0;
        }
        .description {
          margin-top: var(--boxel-sp-xs);
          margin-bottom: 0;
          font-size: var(--font-small);
          font-weight: 500;
        }
        blockquote {
          margin: var(--boxel-sp) 0;
          padding: 0;
        }
        blockquote p {
          font-size: 0.88em;
          font-style: italic;
          margin-inline-start: 0;
          margin-inline-end: var(--boxel-sp-xl);
          padding: 1em 0 1em var(--boxel-sp-xl);
          border-left: 1px solid black;
        }
        .links {
          display: flex;
          gap: var(--boxel-sp-xxxs);
          flex-wrap: wrap;
          margin-top: var(--boxel-sp-xs);
        }
        .links :deep(div) {
          display: contents;
        }
        .links :deep(.pill) {
          border: none;
        }
        .summary {
          padding: var(--boxel-sp-xl) var(--boxel-sp-xxl);
          background-color: var(--boxel-200);
          border-radius: var(--boxel-border-radius-lg);
          font-size: var(--font-small);
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
          role={{if @model.thumbnailURL 'img'}}
          alt={{if @model.thumbnailURL @model.title}}
        >
          {{#unless @model.thumbnailURL}}
            <UserIcon width='30' height='30' />
          {{/unless}}
        </div>
        <header>
          <h3><@fields.title /></h3>
          <p class='desc'><@fields.description /></p>
        </header>
        <p class='bio'><@fields.bio /></p>
        <div class='author-bio-links'>
          <@fields.contactLinks @format='embedded' />
        </div>
      </article>
      <style scoped>
        .author-embedded {
          --background-color: var(--author-background-color, #efefef);
          background-color: var(--background-color);
          height: 100%;
          display: grid;
          grid-template-columns: max-content 1fr;
          grid-template-rows: max-content;
          gap: var(--boxel-sp) var(--boxel-sp-lg);
          padding: var(--boxel-sp-lg);
          text-wrap: pretty;
        }
        h3,
        p {
          margin: 0;
        }
        header {
          align-self: center;
        }
        header,
        .bio,
        .author-bio-links {
          grid-column: 2;
        }
        .thumbnail-image {
          grid-column: 1;
          width: 60px;
          height: 60px;
          display: flex;
          align-items: center;
          justify-content: center;
          background-position: center;
          background-size: cover;
          background-repeat: no-repeat;
          border-radius: 50%;
          border: 1px solid var(--boxel-400);
          color: var(--boxel-400);
        }
        h3 {
          font: 600 var(--boxel-font);
          letter-spacing: var(--boxel-lsp-sm);
        }
        .desc {
          font: 500 var(--boxel-font-sm);
          letter-spacing: var(--boxel-lsp-sm);
        }
        .bio {
          margin-bottom: 1em;
          font: var(--boxel-font-sm);
          letter-spacing: var(--boxel-lsp-sm);
        }
        .author-bio-links {
          align-self: end;
        }
        .author-bio-links > :deep(.embedded-format) {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs);
        }
        .author-bio-links :deep(.pill) {
          --pill-background-color: var(--background-color);
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='author-atom'>
        {{#if @model.thumbnailURL}}
          <span
            class='author-thumbnail'
            style={{setBackgroundImage @model.thumbnailURL}}
            role='img'
            alt={{@model.title}}
          />
        {{else}}
          <UserIcon class='author-icon' width='20' height='20' />
        {{/if}}
        <span class='author-title'>
          <@fields.title />
        </span>
      </span>
      <style scoped>
        .author-atom {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xxs);
          font: 600 var(--boxel-font-sm);
          letter-spacing: var(--boxel-lsp-xs);
        }
        .author-thumbnail,
        .author-icon {
          flex-shrink: 0;
        }
        .author-thumbnail {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          border: 1px solid var(--boxel-400);
          overflow: hidden;
          background-position: center;
          background-repeat: no-repeat;
          background-size: cover;
        }
        .author-title {
          text-wrap: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class FittedTemplate extends Component<typeof this> {
    <template>
      <article class='author-fitted'>
        <div
          class={{cn 'author-thumbnail' is-icon=(not @model.thumbnailURL)}}
          style={{setBackgroundImage @model.thumbnailURL}}
          role={{if @model.thumbnailURL 'img'}}
          alt={{if @model.thumbnailURL @model.title}}
        >
          {{#unless @model.thumbnailURL}}
            <UserIcon width='24' height='24' />
          {{/unless}}
        </div>
        <header class='title-group'>
          <h3 class='title'><@fields.title /></h3>
          <p class='description'><@fields.description /></p>
        </header>
        <p class='bio'><@fields.bio /></p>
        <div class='links'><@fields.contactLinks @format='atom' /></div>
      </article>
      <style scoped>
        .author-fitted {
          --link-icon-size: var(--author-link-icon-size, 15px);
          --thumbnail-size: var(--author-thumbnail-size, 60px);
          --gap-size: var(--author-gap-size, var(--boxel-sp-xxs));
          width: 100%;
          height: 100%;
          min-width: 100px;
          min-height: 29px;
          gap: var(--gap-size);
          overflow: hidden;
          padding: var(--boxel-sp-xs);
        }
        .author-thumbnail {
          grid-area: img;
          width: var(--thumbnail-size);
          height: var(--thumbnail-size);
          display: flex;
          align-items: center;
          justify-content: center;
          background-position: center;
          background-size: cover;
          background-repeat: no-repeat;
          border-radius: 50%;
          border: 1px solid var(--boxel-400);
          color: var(--boxel-400);
        }
        .title-group {
          grid-area: header;
          overflow: hidden;
        }
        .title {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
          margin: 0;
          font: 600 var(--boxel-font);
          letter-spacing: var(--boxel-lsp-sm);
          line-height: 1.25;
        }
        .description {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
          margin-top: var(--boxel-sp-4xs);
          margin-bottom: 0;
          font: 500 var(--boxel-font-xs);
          letter-spacing: var(--boxel-lsp-sm);
          line-height: 1.25;
        }
        .bio {
          grid-area: bio;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 3;
          overflow: hidden;
          margin: 0;
          font: var(--boxel-font-xs);
          letter-spacing: var(--boxel-lsp-sm);
          line-height: 1.25;
        }
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
        .links :deep(svg) {
          width: var(--link-icon-size);
          height: var(--link-icon-size);
        }

        @container fitted-card ((aspect-ratio <= 1.0) and (226px <= height)) {
          .author-fitted {
            display: grid;
            grid-template:
              'img' max-content
              'header' max-content
              'bio' max-content
              'links' 1fr / 1fr;
          }
          .links {
            align-self: end;
          }
        }

        /* Aspect ratio < 1.0 (Vertical card) */
        @container fitted-card (aspect-ratio <= 1.0) and (224px <= height < 226px) {
          .author-fitted {
            display: grid;
            grid-template:
              'img' max-content
              'header' max-content
              'links' 1fr / 1fr;
          }
          .bio {
            display: none;
          }
          .links {
            align-self: end;
          }
        }

        @container fitted-card (aspect-ratio <= 1.0) and (180px <= height < 224px) {
          .author-fitted {
            --thumbnail-size: 40px;
            display: grid;
            grid-template:
              'img' max-content
              'header' max-content
              'links' 1fr / 1fr;
          }
          .title {
            font-size: var(--boxel-font-size-sm);
          }
          .bio {
            display: none;
          }
          .links {
            align-self: end;
          }
        }

        @container fitted-card (aspect-ratio <= 1.0) and (148px <= height < 180px) {
          .author-fitted {
            --thumbnail-size: 40px;
            display: grid;
            grid-template:
              'img' max-content
              'header' max-content
              'links' 1fr / 1fr;
          }
          .title {
            font-size: var(--boxel-font-size-sm);
          }
          .description,
          .bio {
            display: none;
          }
          .links {
            align-self: end;
          }
        }

        @container fitted-card (aspect-ratio <= 1.0) and (128px <= height < 148px) {
          .author-fitted {
            --thumbnail-size: 40px;
            display: grid;
            grid-template:
              'img' max-content
              'header' max-content
              'links' 1fr / 1fr;
          }
          .title {
            font-size: var(--boxel-font-size-xs);
          }
          .description,
          .bio {
            display: none;
          }
          .links {
            align-self: end;
          }
        }

        @container fitted-card (aspect-ratio <= 1.0) and (118px <= height < 128px) {
          .author-fitted {
            --thumbnail-size: 40px;
            --link-icon-size: 13px;
            --gap-size: var(--boxel-sp-4xs);
            display: grid;
            grid-template:
              'img' max-content
              'header' 1fr
              'links' max-content / 1fr;
          }
          .title {
            font-size: var(--boxel-font-size-xs);
          }
          .description,
          .bio {
            display: none;
          }
        }

        @container fitted-card (aspect-ratio <= 1.0) and (92px <= height < 118px) {
          .author-fitted {
            --thumbnail-size: 40px;
            --link-icon-size: 13px;
            --gap-size: var(--boxel-sp-4xs);
            display: grid;
            grid-template:
              'img' max-content
              'header' 1fr
              'links' max-content / 1fr;
          }
          .title {
            font-size: var(--boxel-font-size-xs);
          }
          .description,
          .bio {
            display: none;
          }
        }

        @container fitted-card (aspect-ratio <= 1.0) and (height < 92px) {
          .author-fitted {
            --thumbnail-size: 20px;
            --gap-size: var(--boxel-sp-4xs);
            display: grid;
            grid-template:
              'img' max-content
              'header' 1fr / 1fr;
          }
          .title {
            font-size: var(--boxel-font-size-xs);
          }
          .description,
          .bio,
          .links {
            display: none;
          }
        }

        @container fitted-card ((aspect-ratio <= 1.0) and (400px <= height)) {
          .author-fitted {
            --gap-size: var(--boxel-sp-xs);
            display: grid;
            grid-template:
              'img' max-content
              'header' max-content
              'bio' max-content
              'links' 1fr / 1fr;
          }
          .title {
            -webkit-line-clamp: 4;
            font-size: var(--boxel-font-size-sm);
          }
          .bio {
            -webkit-line-clamp: 10;
          }
          .links {
            align-self: end;
          }
        }

        /* 1.0 < Aspect ratio (Horizontal card) */
        @container fitted-card ((1.0 < aspect-ratio) and (151px <= height)) {
          .author-fitted {
            --gap-size: var(--boxel-sp-xxs) var(--boxel-sp-sm);
            display: grid;
            grid-template:
              'img header' minmax(var(--thumbnail-size), max-content)
              'img links' 1fr / max-content 1fr;
          }
          .title-group {
            align-self: center;
          }
          .title {
            font-size: var(--boxel-font-size-sm);
          }
          .description {
            -webkit-line-clamp: 4;
          }
          .bio {
            display: none;
          }
          .links {
            align-self: end;
          }
        }

        @container fitted-card ((1.0 < aspect-ratio) and (115px <= height <= 150px)) {
          .author-fitted {
            --gap-size: var(--boxel-sp-xxs) var(--boxel-sp-sm);
            --thumbnail-size: 50px;
            display: grid;
            grid-template:
              'img header' minmax(var(--thumbnail-size), max-content)
              'img links' 1fr / max-content 1fr;
          }
          .title-group {
            align-self: center;
          }
          .title {
            font-size: var(--boxel-font-size-sm);
          }
          .bio {
            display: none;
          }
          .links {
            align-self: end;
          }
        }

        @container fitted-card ((1.0 < aspect-ratio) and (78px <= height <= 114px)) {
          .author-fitted {
            --gap-size: var(--boxel-sp-xxxs) var(--boxel-sp-xs);
            --thumbnail-size: 20px;
            --link-icon-size: 15px;
            display: grid;
            grid-template:
              'img header' minmax(var(--thumbnail-size), max-content)
              'img links' 1fr / max-content 1fr;
          }
          .title-group {
            align-self: center;
          }
          .title {
            font-size: var(--boxel-font-size-sm);
          }
          .bio,
          .description {
            display: none;
          }
          .links {
            align-self: end;
          }
        }

        @container fitted-card ((1.0 < aspect-ratio) and (500px <= width) and (56px <= height <= 77px)) {
          .author-fitted {
            --gap-size: var(--boxel-sp-xs);
            --thumbnail-size: 34px;
            display: grid;
            grid-template: 'img header' 1fr / max-content 1fr;
            padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
            align-items: center;
          }
          .title {
            font: 600 var(--boxel-font-sm);
          }
          .bio,
          .links {
            display: none;
          }
        }

        @container fitted-card ((1.0 < aspect-ratio) and (width <= 499px) and (height <= 77px)) {
          .author-fitted {
            --gap-size: var(--boxel-sp-xxs);
            --thumbnail-size: 40px;
            display: grid;
            grid-template: 'img header' 1fr / max-content 1fr;
            align-items: center;
            padding: var(--boxel-sp-xxxs);
          }
          .title {
            font-size: var(--boxel-font-size-sm);
          }
          .bio,
          .description,
          .links {
            display: none;
          }
        }

        @container fitted-card ((1.0 < aspect-ratio) and (height <= 55px)) {
          .author-fitted {
            --gap-size: var(--boxel-sp-xs);
            --thumbnail-size: 20px;
            display: grid;
            grid-template: 'img header' 1fr / max-content 1fr;
            align-items: center;
            padding: var(--boxel-sp-xxxs);
          }
          .author-thumbnail.is-icon {
            border: none;
          }
          .title-group {
            overflow: hidden;
          }
          .title {
            display: block;
            white-space: nowrap;
            text-overflow: ellipsis;
            font-size: var(--boxel-font-size-xs);
            line-height: 1.1;
          }
          .description {
            display: block;
            white-space: nowrap;
            text-overflow: ellipsis;
          }
          .bio,
          .links {
            display: none;
          }
        }

        @container fitted-card ((1.0 < aspect-ratio) and (width <= 100px) and (height <= 55px)) {
          .author-fitted {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: var(--boxel-sp-xxxs);
          }
          .author-thumbnail,
          .description,
          .bio,
          .links {
            display: none;
          }
          .title-group {
            overflow: hidden;
          }
          .title {
            display: block;
            white-space: nowrap;
            text-overflow: ellipsis;
            font-size: var(--boxel-font-size-xs);
            line-height: 1.1;
          }
        }
      </style>
    </template>
  };
}
