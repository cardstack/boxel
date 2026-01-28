import DatetimeField from 'https://cardstack.com/base/datetime';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import NumberField from 'https://cardstack.com/base/number';
import {
  CardDef,
  field,
  contains,
  linksTo,
  Component,
  getCardMeta,
  linksToMany,
} from 'https://cardstack.com/base/card-api';

import CalendarCog from '@cardstack/boxel-icons/calendar-cog';
import BlogIcon from '@cardstack/boxel-icons/notebook';

import { setBackgroundImage } from '../components/layout';

import { Author } from './author';
import { formatDatetime, BlogApp as BlogAppCard } from './blog-app';
import { BlogCategory, categoryStyle } from './blog-category';
import { User } from './user';
import { markdownToHtml } from '@cardstack/runtime-common';
import FeaturedImageField from '../fields/featured-image';

class EmbeddedTemplate extends Component<typeof BlogPost> {
  <template>
    <article class='embedded-blog-post'>
      <div class='thumbnail' style={{setBackgroundImage @model.cardThumbnailURL}} />
      {{#if @model.categories.length}}
        <div class='categories'>
          {{#each @model.categories as |category|}}
            <div class='category' style={{categoryStyle category}}>
              {{category.shortName}}
            </div>
          {{/each}}
        </div>
      {{/if}}
      <h3 class='title'><@fields.cardTitle /></h3>
      <p class='description'>{{@model.cardDescription}}</p>
      <span class='byline'>
        {{@model.formattedAuthors}}
      </span>
      {{#if @model.datePublishedIsoTimestamp}}
        <time class='date' timestamp={{@model.datePublishedIsoTimestamp}}>
          {{@model.formattedDatePublished}}
        </time>
      {{/if}}
    </article>
    <style scoped>
      .embedded-blog-post {
        width: 100%;
        height: 100%;
        display: grid;
        grid-template:
          'img categories categories' max-content
          'img title title' max-content
          'img desc desc' max-content
          'img byline date' 1fr / 40% 1fr max-content;
        gap: var(--boxel-sp-xs);
        padding-right: var(--boxel-sp-xl);
        overflow: hidden;
      }
      .thumbnail {
        grid-area: img;
        background-color: var(--boxel-200);
        background-position: center;
        background-size: cover;
        background-repeat: no-repeat;
        margin-right: var(--boxel-sp-lg);
      }
      .title {
        grid-area: title;
        margin: var(--boxel-sp-xxs) 0 0;
        font-size: var(--boxel-font-size-lg);
        line-height: calc(30 / 22);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .description {
        grid-area: desc;
        margin: 0;
        font-size: var(--boxel-font-size);
        line-height: calc(22 / 16);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .byline {
        grid-area: byline;
        align-self: end;
        width: auto;
        height: auto;
        text-wrap: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
      }
      .date {
        grid-area: date;
        align-self: end;
        justify-self: end;
      }
      .byline,
      .date {
        margin-bottom: var(--boxel-sp-xs);
        font: 500 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
        text-wrap: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
      }

      .categories {
        margin-top: var(--boxel-sp);
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxxs);
      }

      .category {
        display: inline-block;
        padding: 3px var(--boxel-sp-xxxs);
        border-radius: var(--boxel-border-radius-sm);
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-sm);
      }
    </style>
  </template>
}

class FittedTemplate extends Component<typeof BlogPost> {
  <template>
    <article class='fitted-blog-post'>
      <div class='thumbnail' style={{setBackgroundImage @model.cardThumbnailURL}} />
      <div class='categories'>
        {{#each @model.categories as |category|}}
          <div class='category' style={{categoryStyle category}}>
            {{category.shortName}}
          </div>
        {{/each}}
      </div>
      <div class='content'>
        <h3 class='title'><@fields.cardTitle /></h3>
        <p class='description'>{{@model.cardDescription}}</p>
        {{#if @model.formattedAuthors}}
          <span class='byline'>{{@model.formattedAuthors}}</span>
        {{/if}}
        {{#if @model.datePublishedIsoTimestamp}}
          <time class='date' timestamp={{@model.datePublishedIsoTimestamp}}>
            {{@model.formattedDatePublished}}
          </time>
        {{/if}}
      </div>
    </article>
    <style scoped>
      .fitted-blog-post {
        width: 100%;
        height: 100%;
        min-width: 100px;
        min-height: 29px;
        display: grid;
        overflow: hidden;
      }
      .thumbnail {
        grid-area: img;
        background-color: var(--boxel-200);
        background-position: center;
        background-size: cover;
        background-repeat: no-repeat;
      }
      .content {
        grid-area: content;
        gap: var(--boxel-sp-4xs);
        padding: var(--boxel-sp-xs);
        overflow: hidden;
      }
      .title {
        grid-area: title;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
        margin: 0;

        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-sm);
        line-height: 1.3;
      }
      .description {
        grid-area: desc;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
        overflow: hidden;
        margin: 0;
        font: var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-sm);
      }
      .byline {
        grid-area: byline;
        display: inline-block;
        text-wrap: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
      }
      .date {
        grid-area: date;
        text-wrap: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
      }
      .byline,
      .date {
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-sm);
      }

      .categories {
        margin-top: -27px;
        height: 20px;
        margin-left: 7px;
        display: none;
        overflow: hidden;
      }

      .category {
        height: 20px;
        padding: 3px 4px;
        border-radius: var(--boxel-border-radius-sm);
        display: inline-block;
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-sm);
        margin-right: var(--boxel-sp-xxxs);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      @container fitted-card ((aspect-ratio <= 1.0) and (226px <= height)) {
        .fitted-blog-post {
          grid-template:
            'img' 42%
            'categories' max-content
            'content' 1fr / 1fr;
        }
        .categories {
          display: flex;
        }
        .content {
          display: grid;
          grid-template:
            'title title' max-content
            'desc desc' max-content
            'byline date' 1fr / 1fr max-content;
        }
        .byline,
        .date {
          align-self: end;
        }
        .date {
          justify-self: end;
        }
      }

      /* Aspect ratio < 1.0 (Vertical card) */
      @container fitted-card (aspect-ratio <= 1.0) and (224px <= height < 226px) {
        .fitted-blog-post {
          grid-template:
            'img' 92px
            'categories' max-content
            'content' 1fr / 1fr;
        }
        .categories {
          display: flex;
        }

        .content {
          display: grid;
          grid-template:
            'title' max-content
            'byline' max-content
            'date' 1fr / 1fr;
        }
        .description {
          display: none;
        }
        .date {
          align-self: end;
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and (180px <= height < 224px) {
        .fitted-blog-post {
          grid-template:
            'img' 92px
            'categories' max-content
            'content' 1fr / 1fr;
        }
        .categories {
          display: flex;
        }
        .content {
          display: grid;
          grid-template:
            'title' max-content
            'date' 1fr / 1fr;
        }
        .title {
          -webkit-line-clamp: 3;
        }
        .description,
        .byline {
          display: none;
        }
        .date {
          align-self: end;
        }
      }

      @container fitted-card ((aspect-ratio <= 1.0) and (height < 180px) ) {
        .title {
          font-size: var(--boxel-font-size-xs);
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and (148px <= height < 180px) {
        .fitted-blog-post {
          grid-template:
            'img' 80px
            'content' 1fr / 1fr;
        }
        .content {
          display: grid;
          grid-template:
            'title' max-content
            'date' 1fr / 1fr;
        }
        .title {
          -webkit-line-clamp: 2;
        }
        .description,
        .byline {
          display: none;
        }
        .date {
          align-self: end;
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and (128px <= height < 148px) {
        .fitted-blog-post {
          grid-template:
            'img' 68px
            'categories' max-content
            'content' 1fr / 1fr;
        }
        .content {
          display: block;
        }
        .title {
          -webkit-line-clamp: 3;
        }
        .description,
        .byline,
        .date {
          display: none;
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and (118px <= height < 128px) {
        .fitted-blog-post {
          grid-template:
            'img' 57px
            'content' 1fr / 1fr;
        }
        .title {
          -webkit-line-clamp: 3;
        }
        .description,
        .byline,
        .date {
          display: none;
        }
      }

      @container fitted-card ((aspect-ratio <= 1.0) and (400px <= height) and (226px < width)) {
        .title {
          font-size: var(--boxel-font-size);
        }
      }

      @container fitted-card ((aspect-ratio <= 1.0) and (400px <= height)) {
        .fitted-blog-post {
          grid-template:
            'img' 55%
            'categories' max-content
            'content' 1fr / 1fr;
        }
        .categories {
          display: flex;
        }
        .content {
          display: grid;
          grid-template:
            'title' max-content
            'byline' max-content
            'desc' max-content
            'date' 1fr / 1fr;
        }
        .description {
          -webkit-line-clamp: 5;
          margin-top: var(--boxel-sp-xxxs);
        }
        .date {
          align-self: end;
        }
      }

      /* 1.0 < Aspect ratio (Horizontal card) */
      @container fitted-card ((1.0 < aspect-ratio) and (180px <= height)) {
        .fitted-blog-post {
          grid-template: 'img content' 1fr / 40% 1fr;
        }
        .content {
          display: grid;
          grid-template:
            'title' max-content
            'desc' max-content
            'byline' 1fr
            'date' max-content / 1fr;
          gap: var(--boxel-sp-5xs);
        }
        .title {
          -webkit-line-clamp: 2;
        }
        .description {
          -webkit-line-clamp: 3;
          margin-top: var(--boxel-sp-xxxs);
        }
        .byline {
          align-self: end;
        }
      }

      @container fitted-card ((1.0 < aspect-ratio) and (151px <= height < 180px)) {
        .fitted-blog-post {
          grid-template: 'img content' 1fr / 34% 1fr;
        }
        .content {
          display: grid;
          grid-template:
            'title' max-content
            'byline' max-content
            'date' 1fr / 1fr;
        }
        .title {
          -webkit-line-clamp: 2;
        }
        .description {
          display: none;
        }
        .date {
          align-self: end;
        }
      }

      @container fitted-card ((1.0 < aspect-ratio) and (115px <= height <= 150px)) {
        .fitted-blog-post {
          grid-template: 'img content' 1fr / 26% 1fr;
        }
        .content {
          display: grid;
          grid-template:
            'title' max-content
            'byline' 1fr
            'date' max-content / 1fr;
          gap: var(--boxel-sp-5xs);
        }
        .title {
          -webkit-line-clamp: 2;
        }
        .description {
          display: none;
        }
        .byline {
          align-self: end;
          margin-top: var(--boxel-sp-xxxs);
        }
      }

      @container fitted-card ((1.0 < aspect-ratio) and (78px <= height <= 114px)) {
        .fitted-blog-post {
          grid-template: 'img content' 1fr / 35% 1fr;
        }
        .title {
          -webkit-line-clamp: 3;
          font-size: var(--boxel-font-size-xs);
        }
        .description,
        .byline,
        .date {
          display: none;
        }
      }

      @container fitted-card ((1.0 < aspect-ratio) and (500px <= width) and (58px <= height <= 77px)) {
        .fitted-blog-post {
          grid-template: 'img content' 1fr / max-content 1fr;
          align-items: center;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xxs);
        }
        .thumbnail {
          width: 45px;
          height: 45px;
          border-radius: 5px;
        }
        .content {
          padding: 0;
        }
        .title {
          -webkit-line-clamp: 1;
          text-wrap: nowrap;
        }
        .description,
        .byline,
        .date {
          display: none;
        }
      }

      @container fitted-card ((1.0 < aspect-ratio) and (226px <= width <= 499px) and (58px <= height <= 77px)) {
        .fitted-blog-post {
          grid-template: 'img content' 1fr / max-content 1fr;
          align-items: center;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xxs);
        }
        .thumbnail {
          width: 45px;
          height: 45px;
          border-radius: 5px;
        }
        .content {
          padding: 0;
        }
        .title {
          -webkit-line-clamp: 2;
        }
        .description,
        .byline,
        .date {
          display: none;
        }
      }

      @container fitted-card ((1.0 < aspect-ratio) and (width <= 225px) and (58px <= height <= 77px)) {
        .fitted-blog-post {
          grid-template: 'content' 1fr / 1fr;
          align-items: center;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xxs);
        }
        .thumbnail,
        .description,
        .byline,
        .date {
          display: none;
        }
        .content {
          padding: 0;
        }
        .title {
          -webkit-line-clamp: 2;
          font-size: var(--boxel-font-size-xs);
        }
      }

      @container fitted-card ((1.0 < aspect-ratio) and (height <= 57px)) {
        .fitted-blog-post {
          grid-template: 'content' 1fr / 1fr;
          align-items: center;
          padding: var(--boxel-sp-xxxs);
        }
        .thumbnail,
        .description,
        .byline,
        .date {
          display: none;
        }
        .content {
          padding: 0;
        }
        .title {
          -webkit-line-clamp: 2;
          font-size: 600 var(--boxel-font-size-xs);
        }
      }
    </style>
  </template>
}

class Status extends StringField {
  static displayName = 'Status';
  static icon = CalendarCog;
}

export class BlogPost extends CardDef {
  static displayName = 'Blog Post';
  static icon = BlogIcon;
  @field headline = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: BlogPost) {
      return this.headline?.length
        ? this.headline
        : `Untitled ${this.constructor.displayName}`;
    },
  });
  @field slug = contains(StringField);
  @field body = contains(MarkdownField);
  @field authors = linksToMany(Author);
  @field publishDate = contains(DatetimeField);
  @field status = contains(Status, {
    computeVia: function (this: BlogPost) {
      if (!this.publishDate) {
        return 'Draft';
      }
      if (Date.now() >= Date.parse(String(this.publishDate))) {
        return 'Published';
      }
      return 'Scheduled';
    },
  });
  @field blog = linksTo(BlogAppCard, { isUsed: true });
  @field featuredImage = contains(FeaturedImageField);
  @field categories = linksToMany(BlogCategory);
  @field lastUpdated = contains(DatetimeField, {
    computeVia: function (this: BlogPost) {
      let lastModified = getCardMeta(this, 'lastModified');
      return lastModified ? new Date(lastModified * 1000) : undefined;
    },
  });
  @field wordCount = contains(NumberField, {
    computeVia: function (this: BlogPost) {
      if (!this.body) {
        return 0;
      }
      const plainText = markdownToHtml(this.body).replace(
        /<\/?[^>]+(>|$)/g,
        '',
      );
      return plainText.trim().split(/\s+/).length;
    },
  });
  @field editors = linksToMany(User);

  get formattedDatePublished() {
    if (this.status === 'Published' && this.publishDate) {
      return formatDatetime(this.publishDate, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    }
    return undefined;
  }

  get datePublishedIsoTimestamp() {
    if (this.status === 'Published' && this.publishDate) {
      return this.publishDate.toISOString();
    }
    return undefined;
  }

  get formattedLastUpdated() {
    return this.lastUpdated
      ? formatDatetime(this.lastUpdated, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : undefined;
  }

  get lastUpdatedIsoTimestamp() {
    return this.lastUpdated ? this.lastUpdated.toISOString() : undefined;
  }

  get formattedAuthors() {
    const authors = this.authors ?? [];
    if (authors.length === 0) return undefined;

    const titles = authors.map((author) => author.cardTitle);

    if (titles.length === 2) {
      return `${titles[0]} and ${titles[1]}`;
    }

    return titles.length > 2
      ? `${titles.slice(0, -1).join(', ')}, and ${titles.at(-1)}`
      : titles[0];
  }

  static embedded = EmbeddedTemplate;
  static fitted = FittedTemplate;
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article>
        <header class='article-header'>
          {{#if @model.blog}}
            <@fields.blog class='blog' @displayContainer={{false}} />
          {{/if}}
          {{#if @model.featuredImage.imageUrl}}
            <@fields.featuredImage class='featured-image' />
          {{/if}}
          {{#if @model.categories.length}}
            <div class='categories'>
              {{#each @model.categories as |category|}}
                <div class='category' style={{categoryStyle category}}>
                  {{category.shortName}}
                </div>
              {{/each}}
            </div>
          {{/if}}
          <h1><@fields.cardTitle /></h1>
          {{#if @model.cardDescription}}
            <p class='description'>
              <@fields.cardDescription />
            </p>
          {{/if}}
          <ul class='info'>
            {{#if @model.authors.length}}
              <li class='byline'>
                {{#each @fields.authors as |AuthorComponent|}}
                  <AuthorComponent
                    class='author'
                    @format='atom'
                    @displayContainer={{false}}
                  />
                {{/each}}
              </li>
            {{/if}}
            {{#if @model.datePublishedIsoTimestamp}}
              <li class='pub-date'>
                Published on
                <time timestamp={{@model.datePublishedIsoTimestamp}}>
                  {{@model.formattedDatePublished}}
                </time>
              </li>
            {{/if}}
            {{#if @model.lastUpdatedIsoTimestamp}}
              <li class='last-updated-date'>
                Last Updated on
                <time timestamp={{@model.lastUpdatedIsoTimestamp}}>
                  {{@model.formattedLastUpdated}}
                </time>
              </li>
            {{/if}}
          </ul>
        </header>
        <@fields.body />
        {{#if @model.authors.length}}
          <@fields.authors class='author-embedded-bio' @format='embedded' />
        {{/if}}
      </article>
      <style scoped>
        @import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400..700;1,400..700&family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap');
        article {
          --markdown-font-size: 1rem;
          --markdown-font-family: var(--blog-post-font-family, 'Lora', serif);
          --markdown-heading-font-family: var(
            --blog-post-heading-font-family,
            'Playfair Display',
            serif
          );
          height: max-content;
          min-height: 100%;
          padding: var(--boxel-sp-sm) var(--boxel-sp-xl) var(--boxel-sp-lg);
          background-color: #fcf9f2;
          font-family: var(--blog-post-font-family, 'Lora', serif);
        }
        h1,
        h2,
        h3,
        h4,
        h5,
        h6 {
          font-family: var(
            --blog-post-heading-font-family,
            'Playfair Display',
            serif
          );
        }
        h1 {
          font-size: 2.5rem;
          font-weight: 600;
          line-height: 1.25;
          letter-spacing: normal;
          margin-bottom: var(--boxel-sp-lg);
          margin-top: var(--boxel-sp-xl);
        }
        .article-header {
          margin-bottom: var(--boxel-sp-lg);
        }
        .featured-image :deep(.image) {
          border-radius: var(--boxel-border-radius-xl);
          overflow: hidden;
        }
        .blog {
          height: 65px;
          background-color: inherit;
        }
        .blog + .featured-image {
          margin-top: var(--boxel-sp-sm);
        }
        .description {
          font-size: 1.25rem;
          font-style: italic;
        }
        .info {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          flex-wrap: wrap;
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .info > li + li {
          border-left: 1px solid black;
          padding-left: var(--boxel-sp-xs);
        }
        .byline {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xs) var(--boxel-sp);
          flex-wrap: wrap;
        }
        .author {
          display: contents; /* workaround for removing block-levelness of atom format */
        }
        .author-embedded-bio {
          margin-top: var(--boxel-sp-xl);
        }
        .categories {
          margin-top: var(--boxel-sp);
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xxs);
        }
        .featured-image + .categories {
          margin-top: var(--boxel-sp-xl);
        }
        .category {
          display: inline-block;
          padding: 3px var(--boxel-sp-xxxs);
          border-radius: var(--boxel-border-radius-sm);
          font: 500 var(--boxel-font-xs);
          letter-spacing: var(--boxel-lsp-sm);
        }
      </style>
    </template>
  };
}
